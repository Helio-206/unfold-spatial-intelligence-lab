/** Demonstrações multi-domínio: montagens `unfold.assembly.v1` reais, resolvidas pelo mesmo motor FK. */
import type { Assembly, Pose, Vec3 } from '../contracts';
import type { Provenance } from '../../core';

const prov: Provenance = { origin: 'fixture', validation: 'unreviewed', recordedAt: '2026-11-05T00:00:00.000Z', evidence: [{ sourceId: 'src-living-intelligence-fixture', locator: 'living-intelligence/fixtures', excerpt: 'Montagem sintética de demonstração; sem fabricante.' }] };
const pose = (t: Vec3): Pose => ({ translationM: t, rotation: [0, 0, 0, 1], provenance: { translationM: prov, rotation: prov } });
const qty = (value: number, unit: 'rad' | 'm' | 'rad/s') => ({ value, unit, provenance: prov });

function base(id: string, title: string): Assembly {
  return {
    schema: 'unfold.assembly.v1', id, title, units: { length: 'm', angle: 'rad', time: 's' },
    sources: [{ id: 'src-living-intelligence-fixture', kind: 'fixture', title: 'Fixture sintético Living Intelligence' }],
    frames: [{ id: 'world', parentFrameId: null, kind: 'world', pose: pose([0, 0, 0]), description: 'Mundo' }],
    root: { partId: '', frameId: 'world', pose: pose([0, 0, 0]) },
    parts: [], joints: [], constraints: [], actuators: [],
    collision: { groundPlane: null, ignorePairs: [], onContact: 'warn' }, provenance: prov,
  };
}

/** Roda + direcção: virar (steer, eixo Y) e rodar (spin, eixo Z) são juntas reais resolvidas por FK. */
export const WHEEL_STEERING_ASSEMBLY: Assembly = (() => {
  const a = base('wheel-steering-fixture-1', 'Roda e direcção (fixture sintético)');
  a.root.partId = 'vehicle_chassis';
  a.parts = [
    { id: 'vehicle_chassis', label: 'Chassis do veículo', role: 'chassis', points: [], shapes: [], massKg: null, provenance: prov },
    { id: 'steer_knuckle', label: 'Manga de eixo (direcção)', role: 'other', points: [], shapes: [], massKg: null, provenance: prov },
    { id: 'wheel', label: 'Roda', role: 'other', points: [{ id: 'contact_patch', role: 'reference', positionM: [0, -0.35, 0], provenance: prov }], shapes: [], massKg: null, provenance: prov },
  ];
  a.joints = [
    { id: 'steer_joint', type: 'revolute', parentPartId: 'vehicle_chassis', childPartId: 'steer_knuckle', origin: pose([1.1, 0.35, 0.75]), axis: [0, 1, 0], limits: { min: qty(-0.55, 'rad'), max: qty(0.55, 'rad') }, referenceValue: qty(0, 'rad'), motion: null, provenance: prov },
    { id: 'wheel_spin', type: 'revolute', parentPartId: 'steer_knuckle', childPartId: 'wheel', origin: pose([0, 0, 0.12]), axis: [0, 0, 1], limits: { min: qty(-6.283185307179586, 'rad'), max: qty(6.283185307179586, 'rad') }, referenceValue: qty(0, 'rad'), motion: null, provenance: prov },
  ];
  a.actuators = [
    { id: 'steering_drive', label: 'Accionamento da direcção', kind: 'rotary_drive', jointId: 'steer_joint', maxRate: qty(1, 'rad/s'), provenance: prov },
    { id: 'wheel_drive', label: 'Rotação da roda', kind: 'rotary_drive', jointId: 'wheel_spin', maxRate: qty(6, 'rad/s'), provenance: prov },
  ];
  return a;
})();

/** Porta de dobradiça: uma junta revolute com limites, accionamento manual declarado. */
export const DOOR_ASSEMBLY: Assembly = (() => {
  const a = base('hinged-door-fixture-1', 'Porta de dobradiça (fixture sintético)');
  a.root.partId = 'door_frame';
  a.parts = [
    { id: 'door_frame', label: 'Aro da porta', role: 'other', points: [], shapes: [], massKg: null, provenance: prov },
    { id: 'door_leaf', label: 'Folha da porta', role: 'other', points: [{ id: 'handle', role: 'reference', positionM: [0.85, 0, 0.05], provenance: prov }], shapes: [], massKg: null, provenance: prov },
  ];
  a.joints = [
    { id: 'door_hinge', type: 'revolute', parentPartId: 'door_frame', childPartId: 'door_leaf', origin: pose([0, 1.05, 0]), axis: [0, 1, 0], limits: { min: qty(0, 'rad'), max: qty(1.92, 'rad') }, referenceValue: qty(0, 'rad'), motion: null, provenance: prov },
  ];
  a.actuators = [{ id: 'door_manual', label: 'Abertura manual da porta', kind: 'rotary_drive', jointId: 'door_hinge', maxRate: qty(1.2, 'rad/s'), provenance: prov }];
  return a;
})();

export const FIXTURE_PROVENANCE = prov;
