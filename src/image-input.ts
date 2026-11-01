import { extname, resolve } from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';

export const MAX_IMAGE_BYTES = 10_000_000;
export const MAX_IMAGE_DATA_URL_LENGTH = Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 128;

export type SupportedImageMime = 'image/jpeg' | 'image/png';

export type ValidatedImage = {
  mimeType: SupportedImageMime;
  byteLength: number;
  dataUrl: string;
};

const MIME_BY_EXTENSION: Record<string, SupportedImageMime> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

function isJpeg(bytes: Buffer): boolean {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2; let inScan = false; let hasFrame = false; let hasScan = false;
  while (offset < bytes.length) {
    let markerStart = offset;
    if (inScan) {
      while (markerStart < bytes.length && bytes[markerStart] !== 0xff) markerStart += 1;
      if (markerStart >= bytes.length) return false;
      let markerOffset = markerStart + 1;
      while (markerOffset < bytes.length && bytes[markerOffset] === 0xff) markerOffset += 1;
      if (markerOffset >= bytes.length) return false;
      if (bytes[markerOffset] === 0x00) { offset = markerOffset + 1; continue; }
      offset = markerStart; inScan = false;
    }
    if (bytes[offset] !== 0xff) return false;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return false;
    const marker = bytes[offset++]!;
    if (marker === 0xd9) return hasFrame && hasScan && offset === bytes.length;
    if (marker === 0xd8 || marker === 0x00) return false;
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) {
      // JPEG restart markers occur inside entropy-coded scan data. Resume the
      // scan after consuming one; treating the following data byte as a marker
      // rejects otherwise valid images that use restart intervals.
      if (marker >= 0xd0 && marker <= 0xd7) inScan = true;
      continue;
    }
    if (offset + 2 > bytes.length) return false;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return false;
    const payload = offset + 2; const end = offset + segmentLength;
    if (frameMarkers.has(marker)) {
      if (segmentLength < 8) return false;
      const height = bytes.readUInt16BE(payload + 1); const width = bytes.readUInt16BE(payload + 3); const components = bytes[payload + 5]!;
      if (width === 0 || height === 0 || width * height > 100_000_000 || components < 1 || components > 4 || segmentLength !== 8 + components * 3) return false;
      hasFrame = true;
    }
    if (marker === 0xda) {
      if (!hasFrame || segmentLength < 6) return false;
      hasScan = true; inScan = true;
    }
    offset = end;
  }
  return false;
}

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes: Buffer, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) crc = CRC32_TABLE[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function isPng(bytes: Buffer): boolean {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(signature)) return false;
  let offset = 8; let chunkCount = 0; let hasHeader = false; let hasData = false;
  while (offset + 12 <= bytes.length && chunkCount < 4096) {
    const length = bytes.readUInt32BE(offset); const dataStart = offset + 8; const dataEnd = dataStart + length; const chunkEnd = dataEnd + 4;
    if (length > MAX_IMAGE_BYTES || chunkEnd > bytes.length) return false;
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes, offset + 4, dataEnd) !== bytes.readUInt32BE(dataEnd)) return false;
    if (chunkCount === 0) {
      if (type !== 'IHDR' || length !== 13) return false;
      const width = bytes.readUInt32BE(dataStart); const height = bytes.readUInt32BE(dataStart + 4);
      if (!width || !height || width > 32_768 || height > 32_768 || width * height > 100_000_000) return false;
      if (![1, 2, 4, 8, 16].includes(bytes[dataStart + 8]!) || ![0, 2, 3, 4, 6].includes(bytes[dataStart + 9]!) || bytes[dataStart + 10] !== 0 || bytes[dataStart + 11] !== 0 || bytes[dataStart + 12]! > 1) return false;
      hasHeader = true;
    } else if (type === 'IHDR') return false;
    if (type === 'IDAT') { if (!hasHeader) return false; hasData = true; }
    offset = chunkEnd; chunkCount += 1;
    if (type === 'IEND') return length === 0 && hasHeader && hasData && offset === bytes.length;
  }
  return false;
}

export function validateImageDataUrl(value: unknown): ValidatedImage {
  if (typeof value !== 'string') throw new Error('imageDataUrl é obrigatório.');
  if (value.length > MAX_IMAGE_DATA_URL_LENGTH) throw new Error('Imagem excede o limite de processamento.');
  const match = /^data:(image\/jpeg|image\/png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new Error('Formato inválido: esperado data URL JPEG ou PNG em base64.');
  const mimeType = match[1] as SupportedImageMime;
  const encoded = match[2]!;
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new Error('Imagem vazia ou superior ao limite de 10 MB.');
  if (mimeType === 'image/jpeg' && !isJpeg(bytes)) throw new Error('Assinatura JPEG inválida.');
  if (mimeType === 'image/png' && !isPng(bytes)) throw new Error('Assinatura PNG inválida.');
  return { mimeType, byteLength: bytes.length, dataUrl: value };
}

export function readImageFileAsDataUrl(filePath: string): ValidatedImage {
  const resolvedPath = resolve(filePath);
  if (!existsSync(resolvedPath)) throw new Error(`Imagem não encontrada: ${resolvedPath}`);
  const extension = extname(resolvedPath).toLowerCase();
  const mimeType = MIME_BY_EXTENSION[extension];
  if (!mimeType) throw new Error('Formato não suportado. Use JPEG ou PNG.');
  const size = statSync(resolvedPath).size;
  if (size === 0 || size > MAX_IMAGE_BYTES) throw new Error('Imagem vazia ou superior ao limite de 10 MB.');
  const bytes = readFileSync(resolvedPath);
  const dataUrl = `data:${mimeType};base64,${bytes.toString('base64')}`;
  return validateImageDataUrl(dataUrl);
}
