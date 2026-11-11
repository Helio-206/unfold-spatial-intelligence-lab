import { describe, it, expect } from 'vitest';
import { classifyFidelity, FIDELITY_LABEL, DEFAULT_FIDELITY_POLICY, type FidelityInput, type ValidationRecord } from '../src/core/fidelity';

const val = (over: Partial<ValidationRecord> = {}): ValidationRecord => ({ id: 'v', metric: 'silhouette_iou', views: 1, value: 0.9, threshold: 0.8, direction: 'min', heldOut: true, independent: false, groundTruth3d: false, ...over });
const comp = (g: 'observed' | 'measured' | 'inferred' | 'approximated' | 'unknown', id = 'c') => ({ id, geometry: g });
const input = (over: Partial<FidelityInput> = {}): FidelityInput => ({ components: [comp('observed')], validations: [], ...over });

describe('classificação de fidelidade', () => {
  it('rótulos públicos das quatro classes', () => {
    expect(FIDELITY_LABEL).toEqual({ faithful: 'Reconstrução fiel', partially_verified: 'Reconstrução parcialmente verificada', conceptual_approximation: 'Aproximação conceptual', unvalidated: 'Resultado não validado' });
  });
  it('política por defeito é declarada provisória (limiares ainda não derivados do benchmark)', () => {
    expect(DEFAULT_FIDELITY_POLICY.provisional).toBe(true);
  });
  it('só inferido/aproximado, sem validação: aproximação conceptual', () => {
    expect(classifyFidelity(input({ components: [comp('inferred', 'a'), comp('approximated', 'b')] })).class).toBe('conceptual_approximation');
  });
  it('componentes vazios ou todos unknown: não validado', () => {
    expect(classifyFidelity(input({ components: [] })).class).toBe('unvalidated');
    expect(classifyFidelity(input({ components: [comp('unknown')] })).class).toBe('unvalidated');
  });
  it('apoiado por observação mas nunca validado: não validado (não fiel, não conceptual)', () => {
    expect(classifyFidelity(input()).class).toBe('unvalidated');
  });
  it('validação que falha → não validado', () => {
    expect(classifyFidelity(input({ validations: [val({ value: 0.5 })] })).class).toBe('unvalidated');
  });
  it('resíduo do próprio fitting (não held-out) não conta como validação', () => {
    const r = classifyFidelity(input({ validations: [val({ heldOut: false })] }));
    expect(r.class).toBe('unvalidated');
    expect(r.reasons.join(' ')).toMatch(/fitting|held-out/i);
  });
  it('IoU de silhueta numa vista, mesmo excelente, dá no máximo parcialmente verificada', () => {
    const r = classifyFidelity(input({ validations: [val({ value: 0.99, independent: true })], supportedFraction: 1 }));
    expect(r.class).toBe('partially_verified');
    expect(r.unvalidatable.join(' ')).toMatch(/ground truth 3D/);
  });
  it('validação passada mas sem suporte observado → aproximação conceptual', () => {
    expect(classifyFidelity(input({ components: [comp('inferred')], validations: [val()], supportedFraction: 0 })).class).toBe('conceptual_approximation');
  });
  it('faithful exige: consistência multivista (>= vistas mínimas) OU ground truth 3D, independente, held-out, suporte e todas passadas', () => {
    const base = { supportedFraction: 0.9, components: [comp('observed'), comp('measured', 'd')] };
    const mv = val({ metric: 'multiview_consistency', views: 3, independent: true, value: 0.9 });
    expect(classifyFidelity(input({ ...base, validations: [mv] })).class).toBe('faithful');
    expect(classifyFidelity(input({ ...base, validations: [{ ...mv, views: 2 }] })).class).toBe('partially_verified');
    expect(classifyFidelity(input({ ...base, validations: [{ ...mv, independent: false }] })).class).toBe('partially_verified');
    const gt = val({ metric: 'surface_distance', direction: 'max', value: 0.01, threshold: 0.02, groundTruth3d: true, independent: true });
    expect(classifyFidelity(input({ ...base, validations: [gt] })).class).toBe('faithful');
    expect(classifyFidelity(input({ ...base, validations: [mv, val({ value: 0.1 })] })).class).not.toBe('faithful');
    expect(classifyFidelity(input({ ...base, supportedFraction: 0.5, validations: [mv] })).class).toBe('partially_verified');
    expect(classifyFidelity(input({ ...base, components: [...base.components, comp('unknown', 'u')], validations: [mv] })).class).not.toBe('faithful');
  });
  it('sem ground truth 3D, o resultado declara o que não pode ser validado', () => {
    const r = classifyFidelity(input({ validations: [val()], supportedFraction: 0.8 }));
    expect(r.unvalidatable.length).toBeGreaterThan(0);
  });
  it('determinismo e explicabilidade: razões e bloqueios sempre presentes', () => {
    const i = input({ validations: [val()], supportedFraction: 0.4 });
    expect(classifyFidelity(i)).toEqual(classifyFidelity(i));
    expect(classifyFidelity(i).reasons.length).toBeGreaterThan(0);
    expect(classifyFidelity(i).blockers.length).toBeGreaterThan(0);
  });
  it('supportedFraction fora de [0,1] ou NaN é tratado como desconhecido, não como 1', () => {
    expect(classifyFidelity(input({ validations: [val()], supportedFraction: Number.NaN })).class).toBe('conceptual_approximation');
    expect(classifyFidelity(input({ validations: [val()], supportedFraction: 2 })).class).toBe('conceptual_approximation');
  });
});
