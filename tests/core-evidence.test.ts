import { describe, it, expect } from 'vitest';
import { ORIGINS, VALIDATIONS, type Provenance, type Origin, type Validation } from '../src/core';
import {
  EVIDENCE_KINDS, EVIDENCE_LABEL, evidenceKindOf, weakestKind, kindRank, makeEvidenced, validateEvidenced,
  type Measurement, type EvidenceKind,
} from '../src/core/evidence';

const prov = (origin: Origin, validation: Validation = 'unreviewed', extra: Partial<Provenance> = {}): Provenance =>
  ({ origin, validation, recordedAt: '2026-01-01T00:00:00Z', ...extra });
const ref = [{ sourceId: 'img-1', locator: 'bbox' }];
const exact: Measurement = { method: 'pixel count', unit: 'px', uncertainty: { quantified: true, plusMinus: 0.5, unit: 'px', calibration: 'by_construction' }, evidence: ref, assumptions: [] };
const declared: Measurement = { ...exact, method: 'ellipse eccentricity', unit: 'deg', uncertainty: { quantified: true, plusMinus: 10, unit: 'deg', calibration: 'declared' }, assumptions: ['orthographic projection'] };

describe('Evidence kinds', () => {
  it('expõe exactamente os cinco rótulos do contrato', () => {
    expect(EVIDENCE_KINDS).toEqual(['observed', 'measured', 'inferred', 'approximated', 'unknown']);
    expect(EVIDENCE_LABEL).toEqual({ observed: 'OBSERVED', measured: 'MEASURED', inferred: 'INFERRED', approximated: 'APPROXIMATED', unknown: 'UNKNOWN' });
  });
  it('observed exige evidência rastreável; sem referência degrada para unknown (nunca fabrica certeza)', () => {
    expect(evidenceKindOf(prov('observed', 'unreviewed', { evidence: ref })).kind).toBe('observed');
    expect(evidenceKindOf(prov('observed')).kind).toBe('unknown');
  });
  it('heurística: measured só com medição calibrada; incerteza apenas declarada dá approximated; sem medição, inferred', () => {
    expect(evidenceKindOf(prov('heuristic'), { measurement: exact }).kind).toBe('measured');
    expect(evidenceKindOf(prov('heuristic'), { measurement: declared }).kind).toBe('approximated');
    expect(evidenceKindOf(prov('heuristic')).kind).toBe('inferred');
    expect(evidenceKindOf(prov('heuristic'), { measurement: { ...exact, evidence: [] } }).kind).toBe('inferred');
    expect(evidenceKindOf(prov('heuristic'), { measurement: { ...exact, uncertainty: { quantified: false } } }).kind).toBe('inferred');
  });
  it('um modelo nunca produz measured/observed, mesmo com medição anexada', () => {
    expect(evidenceKindOf(prov('model_inferred'), { measurement: exact }).kind).toBe('inferred');
  });
  it('fixture, synthetic e unknown nunca são evidência de um objecto real', () => {
    for (const o of ['fixture', 'synthetic', 'unknown'] as const) expect(evidenceKindOf(prov(o, 'verified', { evidence: ref })).kind).toBe('unknown');
  });
  it('confirmação humana não promove a categoria: regista humanConfirmed à parte', () => {
    const a = evidenceKindOf(prov('model_inferred', 'verified', { authorizationId: 'a1' }));
    expect(a.kind).toBe('inferred'); expect(a.humanConfirmed).toBe(true);
    expect(evidenceKindOf(prov('model_inferred', 'rejected')).kind).toBe('unknown');
  });
  it('derivado/solver herda o elo mais fraco; sem entradas é unknown', () => {
    expect(evidenceKindOf(prov('solver')).kind).toBe('unknown');
    expect(evidenceKindOf(prov('solver'), { inputs: ['measured', 'observed'] }).kind).toBe('measured');
    expect(evidenceKindOf(prov('derived'), { inputs: ['measured', 'inferred'] }).kind).toBe('inferred');
    expect(evidenceKindOf(prov('derived'), { inputs: ['observed', 'unknown'] }).kind).toBe('unknown');
  });
  it('weakestKind é a ordem total declarada', () => {
    const order: EvidenceKind[] = ['unknown', 'inferred', 'approximated', 'measured', 'observed'];
    expect(order.map(kindRank)).toEqual([0, 1, 2, 3, 4]);
    expect(weakestKind(['observed', 'approximated'])).toBe('approximated');
    expect(weakestKind([])).toBe('unknown');
  });
  it('propriedade: nenhuma combinação origem × validação × contexto promove acima do tecto da origem', () => {
    const ceiling: Record<Origin, EvidenceKind> = { observed: 'observed', heuristic: 'measured', model_inferred: 'inferred', human_entered: 'measured', derived: 'observed', solver: 'observed', fixture: 'unknown', synthetic: 'unknown', unknown: 'unknown' };
    const contexts = [{}, { measurement: exact }, { measurement: declared }, { inputs: ['inferred'] as EvidenceKind[] }, { inputs: ['observed'] as EvidenceKind[], measurement: exact }];
    for (const origin of ORIGINS) for (const validation of VALIDATIONS) for (const withRef of [false, true]) for (const ctx of contexts) {
      const k = evidenceKindOf(prov(origin, validation, withRef ? { evidence: ref } : {}), ctx);
      expect(kindRank(k.kind)).toBeLessThanOrEqual(kindRank(ceiling[origin]));
      if (validation === 'rejected') expect(k.kind).toBe('unknown');
    }
  });
  it('a validação humana (verified/corrected) nunca altera a categoria', () => {
    for (const origin of ORIGINS) for (const ctx of [{}, { measurement: exact }, { inputs: ['inferred'] as EvidenceKind[] }]) {
      const base = evidenceKindOf(prov(origin, 'unreviewed', { evidence: ref }), ctx).kind;
      for (const v of ['verified', 'corrected'] as const) expect(evidenceKindOf(prov(origin, v, { evidence: ref, authorizationId: 'x' }), ctx).kind).toBe(base);
    }
  });
});

describe('EvidencedValue', () => {
  it('makeEvidenced calcula o tipo a partir da proveniência e valida', () => {
    const v = makeEvidenced(1.8, prov('heuristic', 'unreviewed', { evidence: ref }), { measurement: exact });
    expect(v.kind).toBe('measured'); expect(validateEvidenced(v)).toEqual([]);
  });
  it('unknown carrega valor nulo; valor com kind unknown é rejeitado', () => {
    expect(makeEvidenced(5, prov('unknown')).value).toBeNull();
    const bad = { ...makeEvidenced(null, prov('unknown')), value: 5 };
    expect(validateEvidenced(bad)).toContain('UNKNOWN_WITH_VALUE');
  });
  it('rejeita promoção manual do kind', () => {
    const v = makeEvidenced(3, prov('model_inferred'));
    expect(validateEvidenced({ ...v, kind: 'measured' })).toContain('KIND_PROMOTED_ABOVE_PROVENANCE');
    expect(validateEvidenced({ ...v, kind: 'observed' })).toContain('KIND_PROMOTED_ABOVE_PROVENANCE');
  });
  it('measured exige medição calibrada com unidade e evidência', () => {
    const v = makeEvidenced(3, prov('heuristic', 'unreviewed', { evidence: ref }), { measurement: exact });
    expect(validateEvidenced({ ...v, measurement: undefined })).toContain('MEASURED_WITHOUT_MEASUREMENT');
    expect(validateEvidenced({ ...v, measurement: { ...exact, uncertainty: { quantified: false } } })).toContain('MEASURED_UNCALIBRATED');
    expect(validateEvidenced({ ...v, measurement: { ...exact, unit: '' } })).toContain('MEASUREMENT_WITHOUT_UNIT');
  });
  it('approximated exige base declarada', () => {
    const v = makeEvidenced(30, prov('heuristic', 'unreviewed', { evidence: ref }), { measurement: declared, basis: 'ellipse eccentricity' });
    expect(v.kind).toBe('approximated'); expect(validateEvidenced(v)).toEqual([]);
    expect(validateEvidenced({ ...v, basis: '' })).toContain('APPROXIMATED_WITHOUT_BASIS');
  });
  it('observed exige referência de evidência', () => {
    const v = makeEvidenced('wall', prov('observed', 'unreviewed', { evidence: ref }));
    expect(validateEvidenced({ ...v, provenance: prov('observed') })).toContain('OBSERVED_WITHOUT_EVIDENCE');
  });
});
