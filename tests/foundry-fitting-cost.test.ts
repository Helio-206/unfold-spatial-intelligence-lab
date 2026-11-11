import { describe, it, expect } from 'vitest';
import { compileFoundry } from '../src/living/universal-foundry/foundry';
import { projectedSilhouette } from '../src/living/universal-foundry/fitting';
import { sedan } from '../src/living/universal-foundry/fixtures/plans';

// Causa dos ~112 s do ficheiro de fitting: cada avaliação regenerava texturas PBR
// procedurais que não influenciam a silhueta. O fitting deve medir só geometria.
describe('custo de avaliação do fitting', () => {
  it('modo geometria-apenas não gera texturas e produz a mesma silhueta', () => {
    const full = compileFoundry(sedan(), { overrides: {}, lod: 0 }); full.buildAll();
    const geo = compileFoundry(sedan(), { overrides: {}, lod: 0, geometryOnly: true }); geo.buildAll();
    expect(full.materials!.textures().length).toBeGreaterThan(0);
    expect(geo.materials!.textures().length).toBe(0);
    expect(Buffer.from(projectedSilhouette(geo.root, 0)).equals(Buffer.from(projectedSilhouette(full.root, 0)))).toBe(true);
    full.retire(); geo.retire();
  });
  it('é substancialmente mais barato (razão medida, independente da máquina)', () => {
    const time = (opts: object) => { const t = performance.now(); for (let i = 0; i < 3; i++) { const c = compileFoundry(sedan(), { overrides: {}, lod: 0, ...opts }); c.buildAll(); c.retire(); } return performance.now() - t; };
    time({ geometryOnly: true }); // aquecimento
    const full = time({}), geo = time({ geometryOnly: true });
    expect(geo).toBeLessThan(full * 0.6);
  }, 60_000);
});
