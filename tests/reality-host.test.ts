import { describe, it, expect } from 'vitest';
import { RealityHost } from '../src/living/reality/host';
import { evidenceFromRenders, solid, ORBIT6 } from './helpers/reality-fixtures';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, raw: m }; };
const gt = solid();

describe('RealityHost: criar, refinar, desfazer, guardar, reabrir', () => {
  it('percurso completo com ids estáveis e malhas idênticas depois de desfazer/refazer e de reabrir noutra sessão', async () => {
    const storage = mem(), host = new RealityHost(storage);
    const base = evidenceFromRenders(gt, ORBIT6), { sha256, plan, entry } = await host.create(base, 'Objecto');
    const ids = plan.components.map((c) => c.id), posKey = (m: typeof entry.model) => m.parts.map((p) => `${p.id}:${p.positions.length}:${Buffer.from(p.positions.buffer).toString('base64').slice(0, 64)}`).join('|');
    const v1 = posKey(entry.model);
    expect(host.assess(sha256, plan)!.ledger.fidelity.class).toBe('partially_verified'); // 6 vistas coerentes -> concordância held-out acima do limiar
    const four = await new RealityHost(null).create(evidenceFromRenders(gt, ORBIT6.slice(0, 4)), 'Poucas vistas'); // 4 vistas num semicírculo: a concordância held-out falha e o resultado NÃO é dado como validado
    expect(new RealityHost(null).assess(four.sha256, four.plan)).toBeNull();
    const more = evidenceFromRenders(gt, [...ORBIT6, [30, 40], [150, 40]]);
    const p = (await host.preview(sha256, more))!; expect(p.diff.verdict).toBe('informative');
    expect(await host.apply(sha256, more, 'Duas vistas')).toBe(true);
    expect(host.entry(sha256)!.model.parts.map((x) => x.id).filter((id) => ids.includes(id)).length).toBe(p.diff.matched.length);
    const v2 = posKey(host.entry(sha256)!.model); expect(v2).not.toBe(v1);
    expect(await host.persist(sha256)).toBe(true);
    expect(host.canUndo(sha256)).toBe(true); expect(await host.step(sha256, -1)).toBe(true);
    expect(posKey(host.entry(sha256)!.model)).toBe(v1); // desfazer devolve exactamente a malha anterior
    expect(await host.step(sha256, 1)).toBe(true); expect(posKey(host.entry(sha256)!.model)).toBe(v2);
    // outra sessão: reabrir a partir do armazenamento
    const host2 = new RealityHost(storage);
    expect((await host2.open(sha256)).ok).toBe(true);
    expect(posKey(host2.entry(sha256)!.model)).toBe(v2);
    expect(host2.entry(sha256)!.record.versions.length).toBe(2);
    host2.remove(sha256); expect((await new RealityHost(storage).open(sha256))).toEqual({ ok: false, reason: 'missing' });
  }, 240_000);
});

describe('compute inline e Worker dão o mesmo resultado', () => {
  it('um workerCompute simulado (structuredClone) reconstrói a mesma malha e revive os Vector3', async () => {
    const { workerCompute } = await import('../src/living/reality/compute');
    const { replayInline } = await import('../src/living/reality/compute');
    const { refineModel } = await import('../src/living/reality/refine');
    const { newRecord } = await import('../src/living/reality/store');
    // Worker de teste: corre a mesma função e devolve por clone estruturado (como o browser faz)
    class FakeWorker { private l = new Set<(e: MessageEvent) => void>(); addEventListener(t: string, f: (e: MessageEvent) => void) { if (t === 'message') this.l.add(f); } removeEventListener(_t: string, f: (e: MessageEvent) => void) { this.l.delete(f); } terminate() { /* */ }
      postMessage(req: { id: number; op: string; record: never; upTo: number; evidence: never }) { setTimeout(() => { const r = req.op === 'replay' ? { id: req.id, ok: true, model: replayInline(req.record, req.upTo) } : { id: req.id, ok: true, refinement: refineModel(replayInline(req.record, (req.record as { current: number }).current), req.evidence) }; const data = structuredClone(r); for (const f of this.l) f({ data } as MessageEvent); }, 0); } }
    const compute = workerCompute(() => new FakeWorker() as unknown as Worker);
    const rec = await newRecord(evidenceFromRenders(gt, ORBIT6)), a = replayInline(rec, 0), b = await compute.replay(rec, 0);
    expect(b.frame.centre.x).toBe(a.frame.centre.x); expect(typeof b.frame.centre.clone).toBe('function'); expect(typeof b.solid.grid.min.clone).toBe('function');
    expect(b.parts.map((p) => Buffer.from(p.positions.buffer).toString('base64'))).toEqual(a.parts.map((p) => Buffer.from(p.positions.buffer).toString('base64')));
    const ref = await compute.refine(rec, evidenceFromRenders(gt, [...ORBIT6, [30, 40]]));
    expect(ref.diff.verdict).toBe('informative'); expect(typeof ref.model.frame.centre.clone).toBe('function');
    const aborted = new AbortController(); aborted.abort();
    await expect(compute.replay(rec, 0, aborted.signal)).rejects.toThrow(/abort/);
  }, 240_000);
});
