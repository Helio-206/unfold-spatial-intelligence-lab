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
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isPng(bytes: Buffer): boolean {
  return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
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
