import { describe, it, expect } from 'vitest';
import { buildRealityLedger } from '../src/universal-spatial/reality-ledger';
import { sedan } from '../src/living/universal-foundry/fixtures/plans';
import type { SpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
import type { ValueOrigin } from '../src/universal-spatial/contracts';

const withOrigin = (plan: SpatialPlanV2, origin: ValueOrigin, evidence: string, sourceKind: 'text' | 'image' = 'image'): SpatialPlanV2 => ({
  ...plan, source: { kind: sourceKind, sha256: plan.source.sha256 },
  components: plan.components.map((c) => ({ ...c, provenance: { geometry: origin, transform: origin, material: origin, evidence } })),
});

describe('Reality ledger sobre o SpatialPlanV2 (mesmo Spatial Core, sem grafo paralelo)', () => {
  it('mapeia a proveniência do plano para tipos de evidência sem promover', () => {
    const l = (o: ValueOrigin, ev = 'bbox da imagem') => buildRealityLedger(withOrigin(sedan(), o, ev)).components[0]!;
    expect(l('observed').geometry.kind).toBe('observed');
    expect(l('inferred').geometry.kind).toBe('inferred');
    expect(l('user_provided').geometry.kind).toBe('inferred');
    expect(l('user_provided').geometry.humanConfirmed).toBe(false);
    expect(l('design_approximation').geometry.kind).toBe('approximated');
    expect(l('unknown').geometry.kind).toBe('unknown');
  });
  it('observed sem texto de evidência degrada para unknown', () => {
    expect(buildRealityLedger(withOrigin(sedan(), 'observed', '  ')).components[0]!.geometry.kind).toBe('unknown');
  });
  it('uma fonte só de texto nunca pode dar geometria observada', () => {
    const c = buildRealityLedger(withOrigin(sedan(), 'observed', 'descrição', 'text')).components[0]!;
    expect(c.geometry.kind).toBe('inferred');
    expect(c.geometry.reason).toMatch(/texto/i);
  });
  it('sem validação, um plano inferido é aproximação conceptual (nunca "fiel")', () => {
    const l = buildRealityLedger(withOrigin(sedan(), 'inferred', 'modelo'));
    expect(l.fidelity.class).toBe('conceptual_approximation');
    expect(l.supportedFraction).toBe(0);
  });
  it('plano observado mas sem validação held-out: não validado', () => {
    expect(buildRealityLedger(withOrigin(sedan(), 'observed', 'bbox')).fidelity.class).toBe('unvalidated');
  });
  it('lista os componentes UNKNOWN e as incógnitas do plano, preservando identidade estável', () => {
    const base = sedan();
    const plan = withOrigin(base, 'unknown', '');
    const l = buildRealityLedger({ ...plan, unknowns: ['interior'] });
    expect(l.unknownComponentIds).toEqual(plan.components.map((c) => c.id));
    expect(l.planUnknowns).toEqual(['interior']);
    expect(l.components.map((c) => c.id)).toEqual(plan.components.map((c) => c.id));
  });
  it('é função pura: não altera o plano e é determinística', () => {
    const plan = withOrigin(sedan(), 'inferred', 'x'); const snap = JSON.stringify(plan);
    const a = buildRealityLedger(plan); const b = buildRealityLedger(plan);
    expect(JSON.stringify(plan)).toBe(snap); expect(a).toEqual(b);
  });
  it('validações held-out passadas elevam a classe, resíduo de fitting não', () => {
    const plan = withOrigin(sedan(), 'observed', 'bbox');
    const v = { id: 'iou', metric: 'silhouette_iou' as const, views: 1, value: 0.9, threshold: 0.8, direction: 'min' as const, heldOut: true, independent: false, groundTruth3d: false };
    expect(buildRealityLedger(plan, { validations: [v] }).fidelity.class).toBe('partially_verified');
    expect(buildRealityLedger(plan, { validations: [{ ...v, heldOut: false }] }).fidelity.class).toBe('unvalidated');
  });
});
