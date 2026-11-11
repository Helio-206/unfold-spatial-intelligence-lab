import { describe, it, expect } from 'vitest';
import { SphereGeometry, CylinderGeometry, Vector3 } from 'three';
import { buildModel, partGeometry } from '../src/living/reality/model';
import { chamfer, geometryPoints } from '../src/universal-spatial/reconstruction/multiview-metrics';
import { reconstructHull } from '../src/universal-spatial/reconstruction/multiview';
import { viewsOf } from '../src/living/reality/model';
import { evidenceFromRenders, trisOf } from './helpers/reality-fixtures';

// halteres: duas esferas ligadas por um pescoço fino; duas partes verdadeiras
const dumbbell = () => [...trisOf(new SphereGeometry(0.4, 28, 20), new Vector3(-0.65, 0, 0)), ...trisOf(new SphereGeometry(0.4, 28, 20), new Vector3(0.65, 0, 0)), ...trisOf(new CylinderGeometry(0.07, 0.07, 0.9, 12).rotateZ(Math.PI / 2))];
const POSES: Array<[number, number]> = [[0, 0], [45, 0], [90, 0], [135, 0], [180, 0], [225, 0], [270, 0], [315, 0], [0, 40], [120, 40], [240, 40]];

describe('cascas por parte', () => {
  it('cada parte tem a sua própria casca fechada: a malha de uma parte fica na caixa da parte e não duplica o objecto inteiro', () => {
    const model = buildModel(evidenceFromRenders(dumbbell(), POSES, { cells: 64, res: 160 }));
    expect(model.parts.length).toBe(2);
    const total = model.parts.reduce((n, p) => n + p.indices.length / 3, 0);
    for (const p of model.parts) {
      const box = { min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity) };
      for (let i = 0; i < p.positions.length; i += 3) { const v = new Vector3(p.positions[i]!, p.positions[i + 1]!, p.positions[i + 2]!); box.min.min(v); box.max.max(v); }
      const ext = box.max.clone().sub(box.min);
      // a esfera tem ~0.8 de diâmetro (em unidades de evidência); a casca de UMA parte nunca cobre o comprimento total (~2.1)
      expect(ext.x).toBeLessThan(model.frame.half * 2 * 0.62);
      expect(p.indices.length / 3).toBeLessThan(total * 0.75);
    }
  }, 120_000);
  it('a união das cascas reproduz a superfície exterior do casco (sem buracos nem pele duplicada)', () => {
    const ev = evidenceFromRenders(dumbbell(), POSES, { cells: 64, res: 160 }), model = buildModel(ev);
    const hull = reconstructHull(viewsOf(ev), { frame: model.frame, cells: 64 });
    const union = model.parts.flatMap((p) => geometryPoints(partGeometry(p), 2500, 7).map((q) => q.add(new Vector3(...p.origin))));
    const c = chamfer(geometryPoints(hull.geometry, 4000, 7), union);
    expect(c.completeness).toBeLessThan(0.02 * model.diagonal); // toda a superfície exterior do casco está numa casca
    expect(c.accuracy).toBeLessThan(0.08 * model.diagonal); // as cascas acrescentam apenas as faces de interface entre partes (dentro do casco)
  }, 120_000);
});
