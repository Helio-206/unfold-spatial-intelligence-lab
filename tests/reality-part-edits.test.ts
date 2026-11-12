import { describe, it, expect } from 'vitest';
import { RealityHost } from '../src/living/reality/host';
import { buildModel } from '../src/living/reality/model';
import { planFromModel } from '../src/living/reality/plan';
import { evidenceSha256, validateRealityEvidence, type RealityEvidence } from '../src/living/reality/evidence';
import { CylinderGeometry, SphereGeometry, Vector3 } from 'three';
import { evidenceFromRenders, trisOf } from './helpers/reality-fixtures';

const gt = [...trisOf(new SphereGeometry(0.34, 28, 20), new Vector3(-0.62, 0, 0)), ...trisOf(new SphereGeometry(0.26, 28, 20), new Vector3(0.62, 0, 0)), ...trisOf(new CylinderGeometry(0.07, 0.07, 0.9, 12).rotateZ(Math.PI / 2))], poses: Array<[number, number]> = [[0, 0], [45, 0], [90, 0], [135, 0], [180, 0], [225, 0], [270, 0], [315, 0], [30, 40], [120, 40], [210, 40], [300, 40]];
const base = (): RealityEvidence => evidenceFromRenders(gt, poses, { cells: 64, res: 128 });
const centre = (m: ReturnType<typeof buildModel>, id: string): [number, number, number] => { const p = m.parts.find((q) => q.id === id)!; return p.origin; };
const withEdits = (e: RealityEvidence, partEdits: RealityEvidence['partEdits']): RealityEvidence => ({ ...e, partEdits });

describe('assisted correction of the part structure (human confirmation kept apart from the automatic structure)', () => {
  const ev = base(), auto = buildModel(ev);
  it('the fixture has several automatic parts to work with', () => { expect(auto.parts.length).toBeGreaterThanOrEqual(2); });
  it('merge: two parts become one, voxels are conserved, and removing the edit restores the automatic structure exactly', () => {
    const a = centre(auto, auto.parts[0]!.id), b = centre(auto, auto.parts[1]!.id), merged = buildModel(withEdits(ev, [{ kind: 'merge', seeds: [a, b], by: 'person' }]));
    expect(merged.parts.length).toBe(auto.parts.length - 1); expect(merged.partEditReports[0]).toMatchObject({ kind: 'merge', applied: true });
    const vox = (m: typeof auto) => m.parts.reduce((s, p) => s + p.voxels, 0); expect(vox(merged)).toBe(vox(auto));
    expect(buildModel(withEdits(ev, [])).parts.map((p) => p.id)).toEqual(auto.parts.map((p) => p.id)); expect(buildModel(ev).solid.labels).toEqual(auto.solid.labels);
  });
  it('split by an axis plane: one part becomes two, voxels conserved; a plane that leaves a sliver is refused and reported, never guessed', () => {
    const big = auto.parts.reduce((a, b) => (b.voxels > a.voxels ? b : a)), c = centre(auto, big.id), s = buildModel(withEdits(ev, [{ kind: 'split', seed: c, axis: 'x', at: c[0], by: 'person' }]));
    expect(s.partEditReports[0]!.applied).toBe(true); expect(s.parts.length).toBe(auto.parts.length + 1); expect(s.parts.reduce((n, p) => n + p.voxels, 0)).toBe(auto.parts.reduce((n, p) => n + p.voxels, 0));
    const sliver = buildModel(withEdits(ev, [{ kind: 'split', seed: c, axis: 'x', at: c[0] + 1e3, by: 'person' }])); expect(sliver.partEditReports[0]).toMatchObject({ applied: false }); expect(sliver.parts.length).toBe(auto.parts.length);
    const nowhere = buildModel(withEdits(ev, [{ kind: 'merge', seeds: [[99, 99, 99], c], by: 'person' }])); expect(nowhere.partEditReports[0]!.applied).toBe(false); expect(nowhere.parts.length).toBe(auto.parts.length);
  });
  it('rename reaches the plan label and says the name came from the person; the plan stays a valid plan with stable ids', async () => {
    const p0 = auto.parts[0]!, e = withEdits(ev, [{ kind: 'rename', seed: centre(auto, p0.id), name: 'Base', by: 'person' }]), m = buildModel(e), plan = planFromModel(m, await evidenceSha256(e), 'T');
    expect(plan.components.find((c) => c.id === p0.id)!.label).toBe('Base (nome dado por si)'); expect(plan.components.map((c) => c.id)).toEqual(m.parts.map((p) => p.id));
  });
  it('invalid edits are refused by the evidence contract', () => {
    expect(() => validateRealityEvidence(withEdits(ev, [{ kind: 'rename', seed: [0, 0, 0], name: '', by: 'person' }]))).toThrow(); expect(() => validateRealityEvidence({ ...ev, partEdits: [{ kind: 'merge', seeds: [[0, 0, 0]], by: 'person' }] } as never)).toThrow();
    expect(() => validateRealityEvidence({ ...ev, partEdits: [{ kind: 'merge', seeds: [[0, 0, 0], [1, 1, 1]], by: 'ai' }] } as never)).toThrow();
  });
  it('through the host an edit is a new VERSION: undo gives the previous structure back, redo the edited one', async () => {
    const host = new RealityHost(null), { sha256, plan } = await host.create(ev, 'T'), n0 = host.entry(sha256)!.model.parts.length;
    const a = centre(auto, auto.parts[0]!.id), b = centre(auto, auto.parts[1]!.id);
    expect(await host.apply(sha256, withEdits(host.entry(sha256)!.record.versions[host.entry(sha256)!.record.current]!.evidence ?? ev, [{ kind: 'merge', seeds: [a, b], by: 'person' }]), 'Fundir partes')).toBe(true);
    expect(host.entry(sha256)!.model.parts.length).toBe(n0 - 1); expect(await host.step(sha256, -1)).toBe(true); expect(host.entry(sha256)!.model.parts.length).toBe(n0); expect(await host.step(sha256, 1)).toBe(true); expect(host.entry(sha256)!.model.parts.length).toBe(n0 - 1);
    void plan;
  }, 120_000);
});
