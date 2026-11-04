import { describe, expect, it } from 'vitest';
import { validateAnatomyImageDataUrl } from '../server/anatomy-image';

function png(width: number, height: number): string {
  const bytes = Buffer.alloc(24); Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(bytes); bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

describe('anatomy image boundaries', () => {
  it('accepts an image inside edge and megapixel limits', () => {
    expect(validateAnatomyImageDataUrl(png(64, 64))).toMatchObject({ width: 64, height: 64, mimeType: 'image/png' });
    expect(validateAnatomyImageDataUrl(png(3456, 3456))).toMatchObject({ width: 3456, height: 3456 });
  });
  it('rejects images below minimum size, above side limits, and above 12 megapixels', () => {
    expect(() => validateAnatomyImageDataUrl(png(63, 64))).toThrow('fora dos limites');
    expect(() => validateAnatomyImageDataUrl(png(4097, 64))).toThrow('fora dos limites');
    expect(() => validateAnatomyImageDataUrl(png(4096, 4096))).toThrow('fora dos limites');
  });
  it('rejects other formats before any Meta call', () => {
    expect(() => validateAnatomyImageDataUrl('data:image/webp;base64,AA==')).toThrow();
  });
});
