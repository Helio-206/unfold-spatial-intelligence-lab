import type { PixelRaster } from './plan-reconstruction';

export type DecodedPlanImage = PixelRaster & { sha256: string; mimeType: string };

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_DIMENSION_PX = 10_000;
const MAX_PIXELS = 16_000_000;

function dimensionsFromHeader(bytes: Uint8Array, mimeType: string): { width: number; height: number } {
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  if (mimeType === 'image/png' && bytes.length >= 24 && ascii(0, 8) === '\x89PNG\r\n\x1a\n') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (mimeType === 'image/jpeg' && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      while (bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset++]!;
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      const segmentLength = (bytes[offset]! << 8) | bytes[offset + 1]!;
      if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
      if (startOfFrame.has(marker) && segmentLength >= 7) return { height: (bytes[offset + 3]! << 8) | bytes[offset + 4]!, width: (bytes[offset + 5]! << 8) | bytes[offset + 6]! };
      offset += segmentLength;
    }
  }
  if (mimeType === 'image/webp' && bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8X') return { width: 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16), height: 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16) };
    if (chunk === 'VP8L' && bytes[20] === 0x2f) return { width: 1 + bytes[21]! + ((bytes[22]! & 0x3f) << 8), height: 1 + ((bytes[22]! >> 6) & 0x03) + (bytes[23]! << 2) + ((bytes[24]! & 0x0f) << 10) };
    if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return { width: ((bytes[27]! << 8) | bytes[26]!) & 0x3fff, height: ((bytes[29]! << 8) | bytes[28]!) & 0x3fff };
  }
  throw new Error('Cabeçalho de imagem inválido ou sem dimensões verificáveis.');
}

export async function decodePlanImage(file: Blob): Promise<DecodedPlanImage> {
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) throw new Error('A imagem deve ter entre 1 byte e 20 MiB.');
  const mimeType = file.type.toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) throw new Error('Formato de planta não suportado; use JPEG, PNG ou WebP.');
  const header = new Uint8Array(await file.slice(0, Math.min(file.size, 256 * 1024)).arrayBuffer());
  const dimensions = dimensionsFromHeader(header, mimeType);
  if (!dimensions.width || !dimensions.height || dimensions.width > MAX_DIMENSION_PX || dimensions.height > MAX_DIMENSION_PX || dimensions.width * dimensions.height > MAX_PIXELS) throw new Error('Dimensões da imagem excedem os limites do reconstrutor.');
  if (typeof createImageBitmap !== 'function' || !globalThis.crypto?.subtle) throw new Error('Este ambiente não disponibiliza descodificação segura da imagem.');
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = bitmap;
    if (width !== dimensions.width || height !== dimensions.height) throw new Error('Dimensões descodificadas não coincidem com o cabeçalho da imagem.');
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Não foi possível preparar a imagem para análise.');
    context.drawImage(bitmap, 0, 0);
    const rgba = context.getImageData(0, 0, width, height).data;
    const grayscale = new Uint8Array(width * height);
    for (let pixel = 0; pixel < grayscale.length; pixel += 1) {
      const alpha = rgba[pixel * 4 + 3]! / 255;
      const luminance = 0.2126 * rgba[pixel * 4]! + 0.7152 * rgba[pixel * 4 + 1]! + 0.0722 * rgba[pixel * 4 + 2]!;
      grayscale[pixel] = Math.round(luminance * alpha + 255 * (1 - alpha));
    }
    const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const sha256 = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
    return { width, height, grayscale, sha256, mimeType };
  } finally {
    bitmap.close();
  }
}
