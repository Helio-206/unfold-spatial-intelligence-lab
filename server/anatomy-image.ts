import { validateImageDataUrl } from '../src/image-input';

export type AnatomyImage = ReturnType<typeof validateImageDataUrl> & { width: number; height: number };

export function validateAnatomyImageDataUrl(input: unknown): AnatomyImage {
  const image = validateImageDataUrl(input);
  const bytes = Buffer.from(image.dataUrl.slice(image.dataUrl.indexOf(',') + 1), 'base64');
  let width = 0; let height = 0;
  if (image.mimeType === 'image/png') {
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) throw new Error('JPEG marker inválido.');
      const marker = bytes[offset + 1]!; const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) throw new Error('JPEG truncado.');
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        height = bytes.readUInt16BE(offset + 5); width = bytes.readUInt16BE(offset + 7); break;
      }
      offset += length + 2;
    }
  }
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 64 || height < 64 || width > 4096 || height > 4096 || width * height > 12_000_000) throw new Error('Imagem fora dos limites anatómicos: mínimo 64 px, máximo 4096 px por lado e 12 MP.');
  return { ...image, width, height };
}
