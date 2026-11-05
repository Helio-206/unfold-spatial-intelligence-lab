/**
 * Ponte estreita SpatialPlanV2 → LivingScene (Spaces activos).
 *
 * Regras: identidades são as do plano; fonte e fingerprint acompanham a cena; relações do
 * plano viram restrições declaradas; juntas NÃO são fabricadas — um componente só ganha
 * capacidade de rotação inferida quando há evidência no plano (rótulo de articulação ou
 * restrição coaxial) e mesmo assim sem limites nem actuador: o movimento é uma
 * demonstração plausível dentro de uma amplitude conceptual declarada, nunca uma
 * simulação do mecanismo real. Sem essa evidência, a interacção suportada é
 * identificação, explicação, selecção e foco — e a cena diz o que falta.
 */
import type { SpatialPlanV2 } from '../../universal-spatial/contracts-v2';

export const SPACE_LIVING_SCHEMA = 'unfold.living-scene.space.v1' as const;
/** Amplitude conceptual da demonstração quando o plano não declara limites (rad). Não é um limite do objecto. */
export const CONCEPTUAL_DEMO_RANGE_RAD = 0.6;

export type SpaceCapability =
  | { kind: 'revolute'; status: 'inferred'; axis: 'x' | 'y' | 'z'; limits: null; demoRangeRad: number; reason: string }
  | { kind: 'fixed'; status: 'supported'; reason: string }
  | { kind: 'none'; status: 'unavailable'; reason: string };

export type SpaceEntity = {
  id: string; label: string; parentId: string | null; childIds: string[];
  semanticRole: string; roleStatus: 'inferred';
  capability: SpaceCapability;
  provenance: { geometry: string; transform: string; material: string; evidence: string };
  relationIds: string[];
};

export type SpaceLivingScene = {
  schema: typeof SPACE_LIVING_SCHEMA;
  title: string; sourceKind: string; sourceSha256: string; planFingerprint: string;
  entities: SpaceEntity[];
  missingForMotion: string[];
  motionSupported: boolean;
};

const ROLE_KEYWORDS: Array<[RegExp, string]> = [
  [/wheel|roda/i, 'wheel'], [/hinge|dobradi/i, 'hinge'], [/door|porta|gate/i, 'door'],
  [/lid|tampa|cover/i, 'lid'], [/lever|alavanca/i, 'lever'], [/arm|braço/i, 'arm'],
  [/pedal/i, 'pedal'], [/crank/i, 'crank'], [/seat|assento|chair|cadeira/i, 'seat'],
  [/frame|aro|moldura|chassis/i, 'frame'], [/handle|pega|puxador/i, 'handle'],
];
const ARTICULATED = /hinge|dobradi|door|porta|gate|lid|tampa|wheel|roda|lever|alavanca|pedal|arm|braço/i;

export function buildSpaceLivingScene(plan: SpatialPlanV2, planFingerprint: string): SpaceLivingScene {
  const childrenOf = new Map<string, string[]>();
  for (const c of plan.components) if (c.parentId) childrenOf.set(c.parentId, [...(childrenOf.get(c.parentId) ?? []), c.id]);
  const coaxialAxes = new Map<string, 'x' | 'y' | 'z'>();
  for (const constraint of plan.constraints) {
    if (constraint.kind === 'coaxial' && constraint.axis) for (const id of constraint.componentIds) coaxialAxes.set(id, constraint.axis);
  }
  const entities: SpaceEntity[] = plan.components.map((c) => {
    const role = ROLE_KEYWORDS.find(([re]) => re.test(c.label))?.[1] ?? 'component';
    const relations = plan.relations.filter((r) => r.fromId === c.id || r.toId === c.id);
    const attached = relations.some((r) => r.kind === 'attached_to');
    const coaxialAxis = coaxialAxes.get(c.id);
    let capability: SpaceCapability;
    const isFrame = /frame|aro|moldura|chassis/i.test(c.label) && !/hinge|dobradi/i.test(c.label);
    if (!isFrame && (ARTICULATED.test(c.label) || (coaxialAxis && ARTICULATED.test(role)))) {
      capability = {
        kind: 'revolute', status: 'inferred',
        axis: coaxialAxis ?? 'y', limits: null, demoRangeRad: CONCEPTUAL_DEMO_RANGE_RAD,
        reason: coaxialAxis
          ? `Restrição coaxial (${coaxialAxis}) declarada no plano para um componente articulado; eixo e articulação são inferidos do plano, limites e actuador não foram declarados.`
          : 'Rótulo articulado no plano, sem junta declarada: rotação de demonstração em torno de Y, marcada como inferida.',
      };
    } else if (attached) {
      capability = { kind: 'fixed', status: 'supported', reason: 'Ligado por relação attached_to do plano: ligação fixa declarada, sem movimento próprio.' };
    } else {
      capability = { kind: 'none', status: 'unavailable', reason: 'O plano não declara junta, restrição coaxial nem relação de articulação para este componente.' };
    }
    return {
      id: c.id, label: c.label, parentId: c.parentId, childIds: childrenOf.get(c.id) ?? [],
      semanticRole: role, roleStatus: 'inferred', capability,
      provenance: c.provenance, relationIds: relations.map((r) => r.id),
    };
  });
  const missingForMotion: string[] = [];
  if (!plan.constraints.some((c) => c.kind === 'coaxial')) missingForMotion.push('nenhuma restrição coaxial declarada (eixo de articulação por confirmar)');
  missingForMotion.push('nenhum limite de junta declarado no plano');
  missingForMotion.push('nenhum actuador declarado no plano');
  if (!entities.some((e) => e.capability.kind === 'revolute')) missingForMotion.push('nenhum componente articulado identificado');
  return {
    schema: SPACE_LIVING_SCHEMA, title: plan.title, sourceKind: plan.source.kind, sourceSha256: plan.source.sha256,
    planFingerprint, entities, missingForMotion,
    motionSupported: entities.some((e) => e.capability.kind === 'revolute'),
  };
}

export function explainSpaceComponent(scene: SpaceLivingScene, plan: SpatialPlanV2, id: string): string | null {
  const e = scene.entities.find((x) => x.id === id);
  if (!e) return null;
  const relations = plan.relations.filter((r) => r.fromId === id || r.toId === id)
    .map((r) => `${r.kind}: ${r.fromId === id ? r.toId : r.fromId} (origem ${r.origin}; evidência: ${r.evidence})`);
  const motion = e.capability.kind === 'revolute'
    ? `Movimento: demonstração inferida de rotação em torno de ${e.capability.axis}, limitada conceptualmente a ±${CONCEPTUAL_DEMO_RANGE_RAD} rad. ${e.capability.reason}`
    : e.capability.kind === 'fixed'
      ? `Movimento: nenhum próprio — ${e.capability.reason}`
      : `Movimento: indisponível. ${e.capability.reason} Em falta para mover com fundamento: ${scene.missingForMotion.join('; ')}.`;
  return [
    `${e.label} (${e.id}) — papel semântico inferido: ${e.semanticRole}.`,
    `Hierarquia: ${e.parentId ? `filho de ${e.parentId}` : 'componente raiz'}${e.childIds.length ? `; filhos: ${e.childIds.join(', ')}` : ''}.`,
    relations.length ? `Relações do plano: ${relations.join(' · ')}.` : 'Sem relações declaradas no plano para este componente.',
    motion,
    `Proveniência do plano: geometria ${e.provenance.geometry}, transformação ${e.provenance.transform}, material ${e.provenance.material}. Fonte: ${scene.sourceKind} ${scene.sourceSha256.slice(0, 12)}… · fingerprint ${scene.planFingerprint.slice(0, 12)}…`,
    plan.unknowns.length ? `Desconhecido no plano: ${plan.unknowns.join('; ')}.` : 'O plano não regista unknowns.',
  ].join('\n');
}

/** Controlador determinístico da demonstração de um Space: ângulo em função do tempo dado. */
export class SpaceMotionController {
  angleRad = 0;
  private targetRad = 0;
  private fromRad = 0;
  private elapsedS = 0;
  private durationS = 1.6;
  state: 'idle' | 'playing' | 'paused' | 'finished' = 'idle';
  private generation = 0;

  get token() { return this.generation; }
  start(targetRad: number, rangeRad: number, reducedMotion = false): { ok: true } | { ok: false; code: string; message: string } {
    if (!Number.isFinite(targetRad)) return { ok: false, code: 'INVALID_TARGET', message: 'Alvo inválido.' };
    const clamped = Math.min(rangeRad, Math.max(-rangeRad, targetRad));
    this.fromRad = this.angleRad; this.targetRad = clamped; this.elapsedS = 0;
    this.durationS = reducedMotion ? 0 : 1.6;
    this.state = reducedMotion ? 'finished' : 'playing';
    if (reducedMotion) this.angleRad = clamped;
    this.generation++;
    return { ok: true };
  }
  step(dtS: number, token?: number): number {
    if (token !== undefined && token !== this.generation) throw new Error('SPACE_MOTION_STALE');
    if (this.state === 'playing' && Number.isFinite(dtS) && dtS > 0) {
      this.elapsedS += dtS;
      const t = this.durationS <= 0 ? 1 : Math.min(1, this.elapsedS / this.durationS);
      const eased = t * t * (3 - 2 * t);
      this.angleRad = this.fromRad + (this.targetRad - this.fromRad) * eased;
      if (t >= 1) this.state = 'finished';
    }
    return this.angleRad;
  }
  pause() { if (this.state === 'playing') this.state = 'paused'; }
  resume() { if (this.state === 'paused') this.state = 'playing'; }
  reset() { this.generation++; this.angleRad = 0; this.targetRad = 0; this.fromRad = 0; this.elapsedS = 0; this.state = 'idle'; }
  cancel() { this.generation++; this.pause(); }
}

/** Plano-modelo de porta, escrito à mão e rotulado como fixture. Não foi gerado pela Muse Spark. */
export function doorSpacePlanFixture(sourceSha256: string): SpatialPlanV2 {
  const T = (position: [number, number, number], rotationRad: [number, number, number] = [0, 0, 0]) => ({ position, rotationRad, scale: [1, 1, 1] as [number, number, number] });
  const shape = (key: string, size: [number, number, number], color: string, offset: [number, number, number] = [0, 0, 0]) => ({
    type: 'shape' as const, key, operator: 'box' as const,
    parameters: { dimensions: size }, transform: T(offset), repeat: null,
    material: { profile: 'neutral' as const, color, roughness: 0.7, metalness: 0, clearcoat: 0 },
  });
  const prov = { geometry: 'inferred' as const, transform: 'inferred' as const, material: 'inferred' as const, evidence: 'semantic template supplied as a labelled fixture, matched to the uploaded source by sha256; not generated by Muse Spark' };
  return {
    contract: 'unfold.spatial-plan.v2',
    source: { kind: 'image', sha256: sourceSha256 },
    title: 'Porta com dobradiça (modelo semântico fixture)',
    units: 'm', presentationProfile: 'neutral',
    components: [
      { id: 'door-frame', label: 'Door frame', parentId: null, geometry: shape('door-frame-shape', [1.0, 2.14, 0.05], '#8a5a33'), transform: T([0, 1.07, -0.04]), provenance: prov },
      // O grupo da folha fica SOBRE a linha da dobradiça e a geometria cresce a partir daí:
      // rodar o grupo é rodar em torno da aresta da dobradiça, não do centro da folha.
      { id: 'door-leaf', label: 'Door leaf', parentId: 'door-frame', geometry: shape('door-leaf-shape', [0.86, 2.0, 0.05], '#a87444', [0.45, 0, 0]), transform: T([-0.46, 0, 0.03]), provenance: prov },
      { id: 'door-hinge', label: 'Door hinge', parentId: 'door-frame', geometry: { type: 'shape' as const, key: 'door-hinge-shape', operator: 'cylinder' as const, parameters: { radiusTop: 0.03, radiusBottom: 0.03, height: 0.5, radialSegments: 16 }, transform: T([0, 0, 0]), repeat: null, material: { profile: 'metal' as const, color: '#6b6f75', roughness: 0.4, metalness: 0.8, clearcoat: 0 } }, transform: T([-0.46, 0, 0.03]), provenance: prov },
      { id: 'door-handle', label: 'Door handle', parentId: 'door-leaf', geometry: shape('door-handle-shape', [0.16, 0.04, 0.05], '#55585d'), transform: T([0.78, 0, 0.05]), provenance: prov },
    ],
    relations: [
      { id: 'rel-leaf-hinge', fromId: 'door-leaf', toId: 'door-hinge', kind: 'attached_to', origin: 'inferred', evidence: 'fixture template relation' },
      { id: 'rel-hinge-frame', fromId: 'door-hinge', toId: 'door-frame', kind: 'attached_to', origin: 'inferred', evidence: 'fixture template relation' },
    ],
    constraints: [{ id: 'axis-hinge-leaf', kind: 'coaxial', componentIds: ['door-hinge', 'door-leaf'], axis: 'y', tolerance: 0.01 }],
    unknowns: ['semantic template (fixture): dimensions and hinge behaviour are inferred, not measured from the photograph', 'no joint limits declared', 'no actuator declared'],
  };
}
