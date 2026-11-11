import { describe, it, expect } from 'vitest';
import { peekImageSize } from '../src/living/reality/intake-panel';
import { buildModel, MODEL_TRIANGLE_BUDGET } from '../src/living/reality/model';
import { assessReconstruction } from '../src/living/reality/assessment';
import { planFromModel } from '../src/living/reality/plan';
import { evidenceSha256 } from '../src/living/reality/evidence';
import { evidenceFromRenders, solid, ORBIT6 } from './helpers/reality-fixtures';

describe('limites de entrada', () => {
  it('lê as dimensões do cabeçalho de PNG, JPEG e WebP sem descodificar (anti-bomba de descompressão)', () => {
    const png = new Uint8Array(33); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); png.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8); png.set([0, 0, 0x4e, 0x20], 16); png.set([0, 0, 0x27, 0x10], 20); // 20000 x 10000
    expect(peekImageSize(png)).toEqual({ width: 20000, height: 10000 });
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x0b, 0xb8, 0x0f, 0xa0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // 3000 x 4000
    expect(peekImageSize(jpg)).toEqual({ width: 4000, height: 3000 });
    const webp = new Uint8Array(40); webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58], 0); webp.set([0x63, 0x01, 0], 24); webp.set([0xc7, 0x00, 0], 27); // 356 x 200
    expect(peekImageSize(webp)).toEqual({ width: 356, height: 200 });
    expect(peekImageSize(new Uint8Array(40))).toBeNull(); // formato desconhecido: recusado a montante
  });
});

describe('degradação progressiva e declarada', () => {
  it('um orçamento apertado reduz a grelha, mantém a evidência e declara-o; sem aperto nada muda', () => {
    const ev = evidenceFromRenders(solid(), ORBIT6, { cells: 64 });
    const full = buildModel(ev), full_tris = full.parts.reduce((n, p) => n + p.indices.length / 3, 0);
    expect(full.degraded).toBeNull(); expect(full_tris).toBeLessThan(MODEL_TRIANGLE_BUDGET);
    const small = buildModel(ev, { maxTriangles: Math.floor(full_tris / 3) });
    expect(small.degraded).not.toBeNull(); expect(small.degraded!.toCells).toBeLessThan(64);
    expect(small.parts.reduce((n, p) => n + p.indices.length / 3, 0)).toBeLessThan(full_tris);
    expect(small.evidence).toEqual(full.evidence); // a evidência original não foi alterada
    return evidenceSha256(ev).then((sha) => { const a = assessReconstruction(planFromModel(small, sha, 'T'), small, sha); expect(a.statements.join(' ')).toMatch(/Resolução reduzida/); });
  }, 120_000);
});
