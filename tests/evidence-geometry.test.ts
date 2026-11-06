import { describe, it, expect } from 'vitest';
import { extractEvidence } from '../src/living/universal-foundry/evidence';
import { correctedEvidence } from '../src/living/universal-foundry/correction';
import { deriveVehicleProportions, buildProportionsProposal, planWithProportions, detectWheelContacts } from '../src/living/universal-foundry/evidence-geometry';
import { evidenceWithModelMask } from '../src/living/universal-foundry/mediapipe-segmentation';
import { applySpatialOperationV2 } from '../src/universal-spatial/contracts-v2';
import { sedan } from '../src/living/universal-foundry/fixtures/plans';

/** Silhueta sintética de carro com duas rodas marcadas no fundo (contactos com o chão). */
function carMaskEvidence(): ReturnType<typeof correctedEvidence> {
  const width = 200, height = 134, data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = 240; data[i + 1] = 240; data[i + 2] = 240; data[i + 3] = 255; }
  const base = extractEvidence({ width, height, data });
  // corpo baixo+comprido com cabina e dois arcos: polígono com recortes nas rodas
  const polygon: Array<[number, number]> = [
    [0.08, 0.52], [0.14, 0.38], [0.30, 0.30], [0.55, 0.30], [0.72, 0.38], [0.88, 0.48], [0.90, 0.62],
    [0.82, 0.64], [0.80, 0.86], [0.68, 0.86], [0.66, 0.66], [0.36, 0.66], [0.34, 0.86], [0.22, 0.86], [0.20, 0.64], [0.09, 0.62],
  ];
  return correctedEvidence(base, { polygon, confirmedAt: '2026-11-05T00:00:00.000Z', provenance: 'user_confirmed' });
}

describe('proporções derivadas da evidência', () => {
  it('detecta dois contactos de roda e emparelha por eixos com orientação decidida', () => {
    const ev = carMaskEvidence();
    const contacts = detectWheelContacts(ev);
    expect(contacts).not.toBeNull();
    expect(contacts!.length).toBeGreaterThanOrEqual(2);
    const derived = deriveVehicleProportions(ev, sedan());
    expect(derived.status).toBe('derived');
    if (derived.status !== 'derived') return;
    expect(derived.wheels.length).toBe(4); // 2 eixos × 2 lados do plano fixture
    expect(derived.wheelbaseFraction).toBeGreaterThan(0.3);
    for (const w of derived.wheels) expect(w.radiusFractionOfBboxHeight).toBeGreaterThan(0.05);
  });
  it('proposta tipada valida contra o contrato e não toca no plano original', () => {
    const plan = sedan();
    const before = JSON.stringify(plan);
    const derived = deriveVehicleProportions(carMaskEvidence(), plan);
    expect(derived.status).toBe('derived');
    if (derived.status !== 'derived') return;
    const operations = buildProportionsProposal(plan, derived, 'side');
    expect(operations).not.toBeNull();
    for (const op of operations!) expect(op.contract).toBe('unfold.spatial-operation.v2');
    const copy = planWithProportions(plan, derived, 'side');
    expect(copy).not.toBeNull();
    expect(JSON.stringify(plan)).toBe(before);
    // as operações aplicam-se de facto e mudam as rodas visadas
    let next = plan;
    for (const op of operations!) next = applySpatialOperationV2(next, op, { origin: 'inferred', evidence: 'test' });
    const wheel = next.components.find((c) => c.id === derived.wheels[0]!.componentId)!;
    expect(wheel.transform.position[0]).not.toBeCloseTo(plan.components.find((c) => c.id === wheel.id)!.transform.position[0], 3);
  });
  it('em três-quartos, a escala de corpo por aspecto é omitida (erro de câmara separado)', () => {
    const plan = sedan();
    const derived = deriveVehicleProportions(carMaskEvidence(), plan);
    if (derived.status !== 'derived') throw new Error('derived expected');
    const side = buildProportionsProposal(plan, derived, 'side')!;
    const tq = buildProportionsProposal(plan, derived, 'three-quarter')!;
    const bodyOp = (ops: typeof side) => ops.find((o) => /body/i.test(o.componentId));
    // com a silhueta sintética o aspecto pode não pedir escala; quando pede, só existe em side
    if (bodyOp(side)) expect(bodyOp(tq)).toBeUndefined();
    expect(tq.length).toBeLessThanOrEqual(side.length);
  });
  it('falha fechado sem contactos de roda detectáveis', () => {
    const width = 60, height = 40, data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) { data[i] = 240; data[i + 1] = 240; data[i + 2] = 240; data[i + 3] = 255; }
    const ev = extractEvidence({ width, height, data });
    expect(detectWheelContacts(ev)).toBeNull();
    expect(deriveVehicleProportions(ev, sedan()).status).toBe('unavailable');
  });
  it('máscara de modelo (DeepLab): classes VOC de veículo viram evidência com IoU alto contra o polígono', () => {
    const width = 100, height = 60;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) { data[i] = 240; data[i + 1] = 240; data[i + 2] = 240; data[i + 3] = 255; }
    const labels = new Uint8Array(width * height);
    for (let y = 20; y < 50; y++) for (let x = 15; x < 85; x++) labels[y * width + x] = 7; // car
    labels[5 * width + 5] = 15; // person: ignorado
    const ev = evidenceWithModelMask({ width, height, data }, labels, width, height);
    expect(ev).not.toBeNull();
    expect(ev!.bbox).toEqual({ x0: 15, y0: 20, x1: 84, y1: 49 });
    expect(ev!.foregroundRatio).toBeCloseTo((70 * 30) / 6000, 2);
  });
});
