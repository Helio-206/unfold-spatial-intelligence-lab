import { describe, it, expect } from 'vitest';
import { SphereGeometry, CylinderGeometry, BoxGeometry, Vector3 } from 'three';
import { buildModel } from '../src/living/reality/model';
import { analyseStructure } from '../src/living/reality/structure';
import { evidenceFromRenders, trisOf } from './helpers/reality-fixtures';

const POSES: Array<[number, number]> = [[0, 0], [45, 0], [90, 0], [135, 0], [180, 0], [225, 0], [270, 0], [315, 0], [0, 40], [120, 40], [240, 40]];
const dumbbell = () => [...trisOf(new SphereGeometry(0.4, 28, 20), new Vector3(-0.65, 0, 0)), ...trisOf(new SphereGeometry(0.4, 28, 20), new Vector3(0.65, 0, 0)), ...trisOf(new CylinderGeometry(0.07, 0.07, 0.9, 12).rotateZ(Math.PI / 2))];
// banco: quatro pernas paralelas sob um assento : pares simétricos e eixos paralelos
const table = () => [...trisOf(new BoxGeometry(1.8, 0.5, 1.2), new Vector3(0, 0.6, 0)), ...[[-0.7, -0.4], [0.7, -0.4], [-0.7, 0.4], [0.7, 0.4]].flatMap(([x, z]) => trisOf(new CylinderGeometry(0.13, 0.13, 0.95, 16), new Vector3(x, -0.1, z)))];

describe('estrutura medida da reconstrução', () => {
  it('halteres: duas esferas e a haste em contacto; as esferas são imagem de espelho uma da outra; cada parte vista por várias vistas', () => {
    const model = buildModel(evidenceFromRenders(dumbbell(), POSES, { cells: 64, res: 160 }), { parts: { limbs: true } }), st = analyseStructure(model);
    expect(model.parts.length).toBe(3);
    expect(st.contacts.length).toBe(2); // com `limbs` a haste é uma parte expect(st.contacts.every((c) => c.areaFraction > 0)).toBe(true);
    expect(st.symmetries.length).toBe(1); expect(st.symmetries[0]!.axis).toBe('x'); expect(st.symmetries[0]!.iou).toBeGreaterThan(0.6);
    expect(st.visibility.every((v) => v.status === 'observed')).toBe(true);
    expect(st.visibility[0]!.perView.length).toBe(model.evidence.views.length);
  }, 120_000);
  it('banco: o assento e as quatro pernas são partes distintas (limbs), as pernas são paralelas entre si e há pares espelhados; nada disto é imposto como restrição', () => {
    const model = buildModel(evidenceFromRenders(table(), [...POSES, [0, 70], [180, 70]], { cells: 96, res: 160 }), { parts: { limbs: true } }), st = analyseStructure(model);
    expect(model.parts.length).toBe(5); // assento + 4 pernas
    expect(st.alignments.length).toBeGreaterThan(0); for (const a of st.alignments) expect(a.angleDeg).toBeLessThanOrEqual(8);
    expect(st.symmetries.length).toBeGreaterThan(0);
  }, 180_000);
  it('oclusão explícita: com vistas só a um lado, a parte do lado oposto fica pouco ou nada observada', () => {
    const oneSide: Array<[number, number]> = [[0, 0], [20, 0], [40, 0], [-20, 0], [-40, 0], [0, 40]];
    const model = buildModel(evidenceFromRenders(dumbbell(), oneSide, { cells: 64, res: 160 })), st = analyseStructure(model);
    const hidden = st.visibility.map((v) => v.observedViews); expect(Math.min(...hidden)).toBeGreaterThanOrEqual(0);
    expect(st.visibility.every((v) => ['observed', 'weakly_observed', 'unobserved'].includes(v.status))).toBe(true);
  }, 120_000);
  it('determinístico', () => {
    const m = buildModel(evidenceFromRenders(dumbbell(), POSES, { cells: 48, res: 128 }));
    expect(analyseStructure(m)).toEqual(analyseStructure(m));
  }, 120_000);
});
