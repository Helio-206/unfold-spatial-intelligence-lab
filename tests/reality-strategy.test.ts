import { describe, it, expect } from 'vitest';
import { selectStrategy } from '../src/living/reality/strategy';
import type { CaptureAssessment } from '../src/living/reality/capture-quality';

const cap = (codes: string[]): CaptureAssessment => ({ ok: true, issues: codes.map((c) => ({ code: c as never, severity: 'warning' as const, viewIndexes: [], message: `m-${c}`, advice: `a-${c}` })), coverage: { azimuthMaxGapDeg: 45, gapStartDeg: 0, elevationMinDeg: 0, elevationMaxDeg: 20, views: 8 } });

describe('selecção de estratégia', () => {
  it('texto e imagem única não-veículo: interpretação da IA, tecto conceptual, nunca certificada', () => {
    for (const s of [selectStrategy({ kind: 'text', views: 0, outlinesCredible: false }), selectStrategy({ kind: 'single-image', views: 1, outlinesCredible: true })]) {
      expect(s.id).toBe('ai-interpretation'); expect(s.ceiling).toBe('conceptual_approximation'); expect(s.certified).toBe(false);
    }
  });
  it('imagem única de veículo em perfil: ajuste paramétrico existente', () => {
    expect(selectStrategy({ kind: 'single-image', views: 1, outlinesCredible: true, vehicleSideView: true }).id).toBe('vehicle-fitting');
  });
  it('várias imagens com contornos credíveis: casco; <4 vistas não tem vista de controlo; ≥8 em volta de mesa é a configuração certificada', () => {
    expect(selectStrategy({ kind: 'multi-image', views: 3, outlinesCredible: true }).ceiling).toBe('conceptual_approximation');
    const s = selectStrategy({ kind: 'multi-image', views: 8, outlinesCredible: true, capture: cap(['NO_ELEVATION_VARIETY']) });
    expect(s.id).toBe('silhouette-hull'); expect(s.ceiling).toBe('partially_verified'); expect(s.certified).toBe(true);
    expect(s.limits.join(' ')).toMatch(/m-NO_ELEVATION_VARIETY/); expect(s.requires).toContain('a-NO_ELEVATION_VARIETY');
    expect(selectStrategy({ kind: 'multi-image', views: 6, outlinesCredible: true }).certified).toBe(false); // sem medição com 6 vistas fotográficas
  });
  it('contorno não credível ou vistas a menos: recusa com instrução, não usa casco', () => {
    const a = selectStrategy({ kind: 'multi-image', views: 8, outlinesCredible: false });
    expect(a.id).toBe('needs-input'); expect(a.requires.join(' ')).toMatch(/Ajustar contorno/);
    expect(selectStrategy({ kind: 'video', views: 1, outlinesCredible: true }).id).toBe('needs-input');
  });
  it('desenho técnico e planta: não certificados', () => {
    expect(selectStrategy({ kind: 'drawing-3view', views: 3, outlinesCredible: true }).certified).toBe(false);
    expect(selectStrategy({ kind: 'floor-plan', views: 1, outlinesCredible: true }).id).toBe('plan-reconstruction');
  });
});
