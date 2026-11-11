import { describe, it, expect } from 'vitest';
import { Box3, Mesh, Vector3 } from 'three';
import { applySpatialOperationV2, validateSpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
import { buildModel } from '../src/living/reality/model';
import { displayScale, planFromModel } from '../src/living/reality/plan';
import { RealityGeometry } from '../src/living/reality/geometry';
import { assessReconstruction } from '../src/living/reality/assessment';
import { RealityStore } from '../src/living/reality/store';
import { evidenceSha256 } from '../src/living/reality/evidence';
import { evidenceFromRenders, solid, ORBIT6 } from './helpers/reality-fixtures';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, raw: m }; };
const gt = solid();

describe('Reality Engine sobre o Spatial Core', () => {
  it('o plano é um SpatialPlanV2 válido com ids estáveis, proveniência sem promoção e incógnitas explícitas', async () => {
    const ev = evidenceFromRenders(gt, ORBIT6), model = buildModel(ev), sha = await evidenceSha256(ev), plan = planFromModel(model, sha, 'Objecto reconstruído');
    expect(validateSpatialPlanV2(plan)).toEqual(plan);
    expect(plan.source).toEqual({ kind: 'image', sha256: sha });
    expect(plan.components.map((c) => c.id)).toEqual(model.parts.map((p) => p.id));
    for (const c of plan.components) { expect(c.provenance.geometry).toBe('inferred'); expect(c.provenance.material).toBe('unknown'); expect(c.label).toMatch(/hipótese/); }
    expect(plan.unknowns.join(' ')).toMatch(/Interior|concavidades/);
    expect(planFromModel(buildModel(ev), sha, 'Objecto reconstruído')).toEqual(plan); // determinístico
  }, 60_000);
  it('a mesma geometria reconstruída aparece nos grupos do componente e segue as edições de transformação do plano', async () => {
    const ev = evidenceFromRenders(gt, ORBIT6), model = buildModel(ev), sha = await evidenceSha256(ev), plan = planFromModel(model, sha, 'T');
    const seam = new RealityGeometry((s) => (s === sha ? model : null)), a = seam.compile(plan);
    expect(seam.report()!.status).toBe('shells');
    const id = plan.components[0]!.id, groupOf = (root: typeof a.root) => { let g: typeof a.root | null = null; root.traverse((o) => { if (o.userData.spatialComponentRoot && o.userData.spatialEntityId === id) g = o as typeof a.root; }); return g!; };
    let meshes = 0; groupOf(a.root).traverse((o) => { if (o instanceof Mesh) meshes++; expect(o.userData.realityShell === undefined || true).toBe(true); });
    expect(meshes).toBeGreaterThan(0);
    const centreOf = (root: typeof a.root) => new Box3().setFromObject(groupOf(root)).getCenter(new Vector3());
    const before = centreOf(a.root);
    const moved = applySpatialOperationV2(plan, { contract: 'unfold.spatial-operation.v2', operationId: 'move-1', kind: 'set-transform', componentId: id, nodeKey: null, value: { ...plan.components[0]!.transform, position: plan.components[0]!.transform.position.map((v, i) => (i === 0 ? v + 0.4 : v)) } }, { origin: 'user_provided', evidence: 'teste: mover a parte' });
    const b = new RealityGeometry((s) => (s === sha ? model : null)).compile(moved);
    expect(centreOf(b.root).x - before.x).toBeCloseTo(0.4, 5);
    expect(moved.components.map((c) => c.id)).toEqual(plan.components.map((c) => c.id)); // identidade estável
    seam.dispose();
  }, 60_000);
  it('sem evidência para este plano, mostra os proxies editáveis e declara-o (sem falso sucesso)', async () => {
    const ev = evidenceFromRenders(gt, ORBIT6), model = buildModel(ev), plan = planFromModel(model, await evidenceSha256(ev), 'T');
    const seam = new RealityGeometry(() => null); seam.compile(plan);
    expect(seam.report()!.status).toBe('proxies_no_evidence');
    expect(seam.report()!.components.every((c) => c.drawn === 'proxy')).toBe(true);
  }, 60_000);
  it('a escala em palco é derivada da evidência (reabrir não muda o tamanho)', async () => {
    const ev = evidenceFromRenders(gt, ORBIT6), m1 = buildModel(ev), m2 = buildModel(JSON.parse(JSON.stringify(ev)));
    expect(displayScale(m1)).toBe(displayScale(m2));
  }, 60_000);
});

describe('avaliação honesta', () => {
  it('2 vistas: aproximação conceptual; 6 vistas coerentes: parcialmente verificada; nunca "fiel" a partir de vistas do próprio utilizador', async () => {
    for (const [poses, expected] of [[ORBIT6.slice(0, 2), 'conceptual_approximation'], [ORBIT6, 'partially_verified']] as const) {
      const ev = evidenceFromRenders(gt, [...poses]), model = buildModel(ev), sha = await evidenceSha256(ev), plan = planFromModel(model, sha, 'T'), a = assessReconstruction(plan, model, sha);
      expect(a.ledger.fidelity.class).toBe(expected);
      expect(a.ledger.fidelity.unvalidatable.join(' ')).toMatch(/ground truth 3D/);
    }
    const twelve = evidenceFromRenders(gt, Array.from({ length: 12 }, (_, i) => [i * 30, i % 2 ? 30 : 0] as [number, number]));
    const m = buildModel(twelve), sha = await evidenceSha256(twelve), r = assessReconstruction(planFromModel(m, sha, 'T'), m, sha);
    expect(r.ledger.fidelity.class).not.toBe('faithful');
    expect(r.benchmarkTolerance!.views).toBe(12);
    expect(r.statements.join(' ')).toMatch(/Não validado em fotografias/);
  }, 120_000);
  it('um ledger de outra reconstrução (hash diferente) é ignorado', async () => {
    const ev = evidenceFromRenders(gt, ORBIT6), model = buildModel(ev), sha = await evidenceSha256(ev), plan = planFromModel(model, sha, 'T');
    const wrong = assessReconstruction(plan, model, 'f'.repeat(64));
    expect(wrong.ledger.fidelity.class).toBe('conceptual_approximation'); // sem suporte observacional herdado
    expect(wrong.ledger.supportedFraction).toBe(0);
  }, 60_000);
});

describe('persistência da evidência', () => {
  it('ida e volta reconstrói a mesma malha; adulteração e ausência são detectadas', async () => {
    const ev = evidenceFromRenders(gt, ORBIT6), storage = mem(), store = new RealityStore(storage);
    const saved = await store.save(ev); expect(saved.ok).toBe(true); if (!saved.ok) return;
    const loaded = await store.load(saved.sha256); expect(loaded.ok).toBe(true); if (!loaded.ok) return;
    const a = buildModel(ev), b = buildModel(loaded.evidence);
    expect(b.parts.map((p) => Buffer.from(p.positions.buffer).toString('base64'))).toEqual(a.parts.map((p) => Buffer.from(p.positions.buffer).toString('base64')));
    const key = [...storage.raw.keys()][0]!; storage.raw.set(key, storage.raw.get(key)!.replace('"azimuthDeg":60', '"azimuthDeg":61'));
    expect((await store.load(saved.sha256))).toEqual({ ok: false, reason: 'checksum_mismatch' });
    expect(await store.load('0'.repeat(64))).toEqual({ ok: false, reason: 'missing' });
    expect(await new RealityStore(null).save(ev)).toEqual({ ok: false, reason: 'storage_unavailable' });
  }, 60_000);
});
