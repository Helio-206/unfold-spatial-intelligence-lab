/**
 * The interface accepts WebP; the reconstruction API accepts only JPEG and PNG. WebP is re-encoded to PNG in the browser
 * before it leaves the page, so the person never meets the mismatch. The API and its limits are not relaxed.
 */
export type Transcoder = (dataUrl: string, signal?: AbortSignal) => Promise<string>;

export type PreparedImage = { dataUrl: string; mime: 'image/png' | 'image/jpeg'; transcodedFrom: 'image/webp' | null };

export class TranscodeError extends Error {
  constructor(message: string) { super(message); this.name = 'TranscodeError'; }
}

const mimeOf = (dataUrl: string): string | null => /^data:([a-z]+\/[a-z0-9.+-]+);base64,/i.exec(dataUrl)?.[1]?.toLowerCase() ?? null;

export async function prepareImage(dataUrl: string, transcode: Transcoder, signal?: AbortSignal): Promise<PreparedImage> {
  const mime = mimeOf(dataUrl);
  if (mime === 'image/png' || mime === 'image/jpeg') return { dataUrl, mime, transcodedFrom: null };
  if (mime !== 'image/webp') throw new TranscodeError(`formato não suportado: ${mime ?? 'desconhecido'}`);
  const converted = await transcode(dataUrl, signal);
  if (mimeOf(converted) !== 'image/png') throw new TranscodeError('a conversão de WebP não produziu um PNG');
  return { dataUrl: converted, mime: 'image/png', transcodedFrom: 'image/webp' };
}

/** Browser transcoder: decode with the platform, redraw on a canvas, export PNG. Pixel content is not altered. */
export const canvasTranscoder: Transcoder = async (dataUrl, signal) => {
  const image = new Image();
  image.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new TranscodeError('não foi possível descodificar o WebP'));
    signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
    image.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context || !canvas.width || !canvas.height) throw new TranscodeError('imagem WebP sem dimensões utilizáveis');
  context.drawImage(image, 0, 0);
  return canvas.toDataURL('image/png');
};
