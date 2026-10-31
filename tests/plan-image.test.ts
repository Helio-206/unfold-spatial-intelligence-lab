import { describe, expect, it } from 'vitest';
import { decodePlanImage } from '../src/plan-image';

function pngHeader(width: number, height: number): Blob {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return new Blob([bytes.buffer], { type: 'image/png' });
}

describe('plan image input', () => {
  it('rejects unsupported MIME types and invalid image signatures before decoding', async () => {
    await expect(decodePlanImage(new Blob(['not an image'], { type: 'image/gif' }))).rejects.toThrow('Formato de planta não suportado');
    await expect(decodePlanImage(new Blob(['bad header'], { type: 'image/png' }))).rejects.toThrow('Cabeçalho de imagem inválido');
  });

  it('checks raster dimensions in the header before allocating decoded pixel buffers', async () => {
    await expect(decodePlanImage(pngHeader(5000, 4000))).rejects.toThrow('Dimensões da imagem excedem');
  });
});
