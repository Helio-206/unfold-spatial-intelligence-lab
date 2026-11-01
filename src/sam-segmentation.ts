/** Offline request builder for SAM 3.1. It deliberately does not send requests or parse mask tokens. */
export type SamImageSource = {
  dataUrl: string;
  width: number;
  height: number;
  sha256: string;
};

export type SamNormalizedBox = { x: number; y: number; width: number; height: number };
export type SamLocationPrompt = {
  objectId: number;
  box?: SamNormalizedBox;
  points?: Array<{ x: number; y: number; polarity: 'positive' | 'negative' }>;
};
export type SamPrompt =
  | { kind: 'concept'; nounPhrase: string }
  | { kind: 'locations'; objects: SamLocationPrompt[] };

export type SamResponsesRequest = {
  model: 'sam-3.1';
  input: Array<{ type: 'message'; role: 'user'; content: Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string }> }>;
  stream: false;
};

const MAX_IMAGE_PIXELS = 16_000_000;
const MAX_OBJECTS = 20;
const isFiniteNumber = (value: number) => Number.isFinite(value);

function validateImage(source: SamImageSource): void {
  if (!source || !/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(source.dataUrl)
    || !Number.isSafeInteger(source.width) || source.width < 1
    || !Number.isSafeInteger(source.height) || source.height < 1
    || source.width * source.height > MAX_IMAGE_PIXELS
    || !/^[a-f0-9]{64}$/i.test(source.sha256)) {
    throw new Error('SAM_INVALID_IMAGE_SOURCE');
  }
}

function validateBox(box: SamNormalizedBox): void {
  if (![box.x, box.y, box.width, box.height].every(isFiniteNumber)
    || box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0
    || box.x + box.width > 1000 || box.y + box.height > 1000) {
    throw new Error('SAM_PROMPT_OUT_OF_BOUNDS');
  }
}

function normalizedToPixels(value: number, extent: number): number {
  return Math.max(0, Math.min(extent - 1, Math.round(value * extent / 1000)));
}

function buildLocationText(prompt: Extract<SamPrompt, { kind: 'locations' }>, image: SamImageSource): string {
  if (!Array.isArray(prompt.objects) || prompt.objects.length === 0 || prompt.objects.length > MAX_OBJECTS) throw new Error('SAM_INVALID_OBJECTS');
  const ids = new Set<number>();
  const encoded = prompt.objects.map((object) => {
    if (!Number.isSafeInteger(object.objectId) || object.objectId < 0 || object.objectId > 999 || ids.has(object.objectId)) throw new Error('SAM_INVALID_OBJECT_ID');
    ids.add(object.objectId);
    const hasBox = object.box !== undefined;
    const hasPoints = object.points !== undefined;
    if (hasBox === hasPoints) throw new Error('SAM_OBJECT_REQUIRES_BOX_OR_POINTS');
    const prompts: string[] = [];
    if (object.box) {
      validateBox(object.box);
      const x1 = normalizedToPixels(object.box.x, image.width);
      const y1 = normalizedToPixels(object.box.y, image.height);
      const x2 = normalizedToPixels(object.box.x + object.box.width, image.width);
      const y2 = normalizedToPixels(object.box.y + object.box.height, image.height);
      prompts.push(`<|box;x1=${x1};y1=${y1};x2=${Math.max(x1, x2)};y2=${Math.max(y1, y2)};w=${image.width};h=${image.height}|>`);
    } else {
      if (!Array.isArray(object.points) || object.points.length === 0 || object.points.length > 12) throw new Error('SAM_INVALID_POINTS');
      for (const point of object.points) {
        if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y) || point.x < 0 || point.x > 1000 || point.y < 0 || point.y > 1000 || !['positive', 'negative'].includes(point.polarity)) throw new Error('SAM_PROMPT_OUT_OF_BOUNDS');
        const prefix = point.polarity === 'negative' ? '-' : '';
        prompts.push(`${prefix}<|point;x=${normalizedToPixels(point.x, image.width)};y=${normalizedToPixels(point.y, image.height)};w=${image.width};h=${image.height}|>`);
      }
    }
    return `${object.objectId}${prompts.join('')}`;
  });
  return `<0f>${encoded.join(',')}`;
}

/** Builds the documented Responses API envelope. No network, billing, or mask parsing occurs here. */
export function buildSamSegmentationRequest(image: SamImageSource, prompt: SamPrompt): SamResponsesRequest {
  validateImage(image);
  let text: string;
  if (prompt.kind === 'concept') {
    const nounPhrase = prompt.nounPhrase.trim();
    if (!nounPhrase || nounPhrase.length > 80 || /[,;\n]|\band\b/i.test(nounPhrase)) throw new Error('SAM_CONCEPT_MUST_BE_SINGLE_NOUN_PHRASE');
    text = nounPhrase;
  } else {
    text = buildLocationText(prompt, image);
  }
  return {
    model: 'sam-3.1',
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text }, { type: 'input_image', image_url: image.dataUrl }] }],
    stream: false,
  };
}
