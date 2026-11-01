import { describe, expect, it } from 'vitest';
import { buildSamSegmentationRequest } from '../src/sam-segmentation';

const image = { dataUrl: 'data:image/png;base64,aGVsbG8=', width: 1280, height: 720, sha256: 'a'.repeat(64) };

describe('SAM 3.1 request adapter (offline)', () => {
  it('builds a documented single-concept Responses request', () => {
    expect(buildSamSegmentationRequest(image, { kind: 'concept', nounPhrase: 'parede interior' })).toMatchObject({
      model: 'sam-3.1', stream: false,
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'parede interior' }, { type: 'input_image', image_url: image.dataUrl }] }],
    });
  });

  it('converts Muse normalized boxes and points to source pixels with stable object ids', () => {
    const request = buildSamSegmentationRequest(image, { kind: 'locations', objects: [
      { objectId: 3, box: { x: 250, y: 125, width: 500, height: 250 } },
      { objectId: 4, points: [{ x: 500, y: 500, polarity: 'positive' }, { x: 600, y: 550, polarity: 'negative' }] },
    ] });
    expect(request.input[0]!.content[0]).toEqual({ type: 'input_text', text: '<0f>3<|box;x1=320;y1=90;x2=960;y2=270;w=1280;h=720|>,4<|point;x=640;y=360;w=1280;h=720|>-<|point;x=768;y=396;w=1280;h=720|>' });
  });

  it('rejects mixed concept/locations, multiple concepts, invalid source and ambiguous prompts', () => {
    expect(() => buildSamSegmentationRequest(image, { kind: 'concept', nounPhrase: 'walls and doors' })).toThrow('SAM_CONCEPT_MUST_BE_SINGLE_NOUN_PHRASE');
    expect(() => buildSamSegmentationRequest(image, { kind: 'locations', objects: [{ objectId: 1, box: { x: 900, y: 0, width: 200, height: 100 } }] })).toThrow('SAM_PROMPT_OUT_OF_BOUNDS');
    expect(() => buildSamSegmentationRequest(image, { kind: 'locations', objects: [{ objectId: 1, box: { x: 0, y: 0, width: 100, height: 100 }, points: [{ x: 1, y: 1, polarity: 'positive' }] }] })).toThrow('SAM_OBJECT_REQUIRES_BOX_OR_POINTS');
    expect(() => buildSamSegmentationRequest({ ...image, sha256: 'bad' }, { kind: 'concept', nounPhrase: 'janela' })).toThrow('SAM_INVALID_IMAGE_SOURCE');
  });
});
