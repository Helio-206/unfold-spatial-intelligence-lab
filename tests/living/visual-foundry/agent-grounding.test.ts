import { describe, expect, it, vi } from 'vitest';
import { EXCAVATOR_ASSEMBLY_V1 } from '../../../src/living/contracts/fixtures/excavator.assembly.v1';
import { buildComponentRegistry } from '../../../src/living/visual-foundry/component-registry';
import { loadFixturePreview } from '../../../src/living/visual-foundry/poses';
import { askAgent, buildAgentRequest } from '../../../src/living/workspace-design/agent-client';
import { planExtendExperiment } from '../../../src/living/workspace-design/experiments';
import { groundOutcome } from '../../../src/living/workspace-design/grounding';

const registry = buildComponentRegistry(EXCAVATOR_ASSEMBLY_V1);
const req = (q: string, selected: string | null = null) => buildAgentRequest(q, registry, selected, []);
/** fetch double that counts calls; never touches the network. */
const fakeFetch = (status: number, body: unknown) => { const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })); return fn as unknown as typeof fetch & { mock: { calls: unknown[] } }; };

describe('agent request', () => {
  it('uses spatial_agent_request.v1 in mechanical mode with only Select/Inspect/Focus', () => {
    const r = req('O que levanta a lança?', 'boom_cylinder');
    expect(r.schema).toBe('spatial_agent_request.v1');
    expect(r.mode).toBe('mechanical');
    expect(r.capabilities).toEqual(['Select', 'Inspect', 'Focus']);
    expect(r.scene?.selectedId).toBe('boom_cylinder');
    expect(r.scene?.components.every((c) => c.verification.startsWith('fixture/'))).toBe(true);
  });
});

describe('agent client', () => {
  it('fixture mode never calls the network', async () => {
    const f = fakeFetch(200, {});
    const out = await askAgent(req('O que levanta a lança?'), { mode: 'fixture', fetchImpl: f });
    expect(f.mock.calls).toHaveLength(0);
    expect(out.status === 'ok' && out.source).toBe('fixture');
  });

  it('falls back to a labelled fixture when the API key is missing (one call)', async () => {
    const f = fakeFetch(503, { error: { code: 'MODEL_API_KEY_MISSING' } });
    const out = await askAgent(req('O que levanta a lança?'), { fetchImpl: f });
    expect(f.mock.calls).toHaveLength(1);
    expect(out).toMatchObject({ status: 'ok', source: 'fixture', reason: 'MODEL_API_KEY_MISSING' });
  });

  it('does not mask other backend errors with a fixture', async () => {
    const f = fakeFetch(429, { error: { code: 'META_CALL_BUDGET_EXHAUSTED' } });
    const out = await askAgent(req('O que levanta a lança?'), { fetchImpl: f });
    expect(out).toMatchObject({ status: 'error', code: 'META_CALL_BUDGET_EXHAUSTED' });
  });

  it('accepts a valid live answer and grounds it on canonical ids', async () => {
    const f = fakeFetch(200, { result: { schema: 'spatial_agent_result.v1', kind: 'ANSWER', text: 'O cilindro da lança.', basis: 'scene', evidenceIds: ['boom', 'boom_cylinder'], question: null, action: null }, meta: { model: 'muse-spark-x' } });
    const g = groundOutcome(await askAgent(req('o que levanta a lança'), { fetchImpl: f }), registry);
    expect(g.source).toBe('live');
    expect(g.sourceNote).toContain('muse-spark-x');
    expect(g.primary?.id).toBe('boom_cylinder'); // actuator preferred over the part
    expect(g.act).toBe('point');
  });

  it('refuses a live proposal outside the mechanical capabilities (no fabricated action)', async () => {
    const f = fakeFetch(200, { result: { schema: 'spatial_agent_result.v1', kind: 'PROPOSE_ACTION', text: 'Movi a caçamba.', basis: 'scene', evidenceIds: ['bucket'], question: null, action: { kind: 'Move', target: { reference: 'label', label: 'Caçamba', ordinal: null }, value: 1, valueMode: null, unit: 'm', axis: 'X', opening: null } } });
    const g = groundOutcome(await askAgent(req('move a caçamba 1 metro no eixo x'), { fetchImpl: f }), registry);
    expect(g.blocked?.code).toBe('SPATIAL_AGENT_ACTION_NOT_ALLOWED');
    expect(g.act).toBeNull();
    expect(g.text).not.toMatch(/Movi/);
  });

  it('refuses evidence ids that are not canonical components of the scene', async () => {
    const f = fakeFetch(200, { result: { schema: 'spatial_agent_result.v1', kind: 'ANSWER', text: 'x', basis: 'scene', evidenceIds: ['pump_3'], question: null, action: null } });
    const out = await askAgent(req('o que move o braço'), { fetchImpl: f });
    expect(out.status).toBe('error');
  });

  it('network failure falls back to the fixture and says why', async () => {
    const f = vi.fn(async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    const out = await askAgent(req('o que levanta a lança'), { fetchImpl: f });
    expect(out).toMatchObject({ status: 'ok', source: 'fixture', reason: 'BACKEND_UNREACHABLE' });
  });
});

describe('fixture replies pass the product parser and stay grounded', () => {
  const cases: Array<[string, string | null, string | null]> = [
    ['O que levanta a lança?', null, 'boom_cylinder'],
    ['Show me what lifts the boom.', null, 'boom_cylinder'],
    ['O que acciona a caçamba?', null, 'bucket_cylinder'],
    ['foca a caçamba', null, 'bucket'],
    ['mostra o cilindro do braço', null, 'stick_cylinder'],
    ['What happens if I extend this cylinder?', 'boom_cylinder', 'boom_cylinder'],
    ['remove a caçamba', null, null],
    ['qual é a cor do céu', null, null],
  ];
  for (const [q, sel, expected] of cases) {
    it(`"${q}"`, async () => {
      const g = groundOutcome(await askAgent(req(q, sel), { mode: 'fixture' }), registry);
      expect(g.source).toBe('fixture');
      expect(g.sourceNote).toMatch(/^Fixture/);
      expect(g.primary?.id ?? null).toBe(expected);
      expect(g.blocked).toBeNull();
    });
  }

  it('asks which cylinder when nothing is selected, instead of guessing', async () => {
    const g = groundOutcome(await askAgent(req('O que acontece se eu estender este cilindro?'), { mode: 'fixture' }), registry);
    expect(g.clarification).toMatch(/Seleccione/);
    expect(g.primary).toBeNull();
  });

  it('never claims a computed consequence', async () => {
    const g = groundOutcome(await askAgent(req('O que acontece se eu estender este cilindro?', 'boom_cyl_rod'), { mode: 'fixture' }), registry);
    expect(g.text).toMatch(/Não calculo/);
    expect(g.primary?.id).toBe('boom_cylinder');
  });
});

describe('supported experiments', () => {
  const previews = [loadFixturePreview()];
  it('offers a labelled fixture preview for the boom cylinder (from barrel, rod or actuator)', () => {
    for (const id of ['boom_cylinder', 'boom_cyl_barrel', 'boom_cyl_rod']) {
      const p = planExtendExperiment(id, registry, previews);
      expect(p.kind).toBe('preview_fixture');
      expect(p.detail).toMatch(/fixture/);
      expect(p.detail).toMatch(/motor/);
    }
  });
  it('has nothing to show for cylinders without a fixture, and says so', () => {
    const p = planExtendExperiment('stick_cylinder', registry, previews);
    expect(p.kind).toBe('unavailable');
    expect(p.detail).toMatch(/não há nada para mostrar/);
  });
  it('requires a cylinder', () => {
    expect(planExtendExperiment('bucket', registry, previews).kind).toBe('unavailable');
    expect(planExtendExperiment(null, registry, previews).kind).toBe('unavailable');
  });
});
