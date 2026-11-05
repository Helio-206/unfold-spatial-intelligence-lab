/**
 * Proporções derivadas da evidência: centros das rodas, distância entre eixos e
 * proporção global estimados da silhueta confirmada — em vez de ficarem congelados no
 * plano semântico genérico. O resultado NÃO é aplicado ao plano: é transformado numa
 * proposta tipada (`SpatialOperationV2[]`) para o caminho de revisão existente
 * (`proposeSolverEdit` → autorização humana → transacção). O fitting nunca escreve no plano.
 */
import { applySpatialOperationV2, type SpatialOperationV2, type SpatialPlanV2 } from '../../universal-spatial/contracts-v2';
import type { ImageEvidence } from './evidence';

export type DerivedWheel = { componentId: string; centreXFraction: number; radiusFractionOfBboxHeight: number; confidence: 'estimated' };
export type DerivedProportions = {
  status: 'derived';
  aspect: number;
  groundYFraction: number;
  wheels: DerivedWheel[];
  wheelbaseFraction: number | null;
  method: string;
  uncertainty: string;
};
export type ProportionsResult = DerivedProportions | { status: 'unavailable'; reason: string };

const isWheel = (label: string) => /wheel|tyre|tire|roda|pneu/i.test(label);
const isBody = (label: string) => /body|carroceria|hull|chassis/i.test(label);

function componentSpan(plan: SpatialPlanV2): { minX: number; maxX: number; minY: number; maxY: number } {
  // Extensão aproximada incluindo o tamanho dos componentes (não só os centros):
  // sem isto, o aspecto do plano é calculado sobre pontos e a escala sai errada.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of plan.components) {
    const [x, y] = c.transform.position;
    const half = (componentDiameter(plan, c.id) ?? 0.6) / 2;
    minX = Math.min(minX, x - half); maxX = Math.max(maxX, x + half);
    minY = Math.min(minY, y - half); maxY = Math.max(maxY, y + half);
  }
  return { minX, maxX, minY, maxY };
}

/** Diâmetro actual estimado de um componente a partir do primeiro nó de forma (bbox dos parâmetros). */
function componentDiameter(plan: SpatialPlanV2, id: string): number | null {
  const c = plan.components.find((x) => x.id === id);
  if (!c) return null;
  const stack = [c.geometry];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.type === 'group') { stack.push(...node.children); continue; }
    const p = node.parameters as Record<string, unknown>;
    if (Array.isArray(p.dimensions)) return Math.max(...(p.dimensions as number[]).slice(0, 2));
    if (typeof p.radiusTop === 'number') return (p.radiusTop as number) * 2;
    if (typeof p.radius === 'number') return (p.radius as number) * 2;
    if (Array.isArray(p.radii)) return Math.max(...(p.radii as number[]).slice(0, 2)) * 2;
  }
  return null;
}

/**
 * Detecta as rodas na silhueta: agrupamentos de colunas cujo fundo da máscara toca a
 * linha de chão (bbox inferior), separados por arcos. Falha fechado sem ≥2 grupos.
 */
export function detectWheelContacts(evidence: ImageEvidence): Array<{ centreXFraction: number; widthFraction: number }> | null {
  const { mask, width, height, bbox } = evidence;
  const bottomOf = (x: number): number => { for (let y = bbox.y1; y >= bbox.y0; y--) if (mask[y * width + x]) return y; return -1; };
  const contact: boolean[] = [];
  for (let x = bbox.x0; x <= bbox.x1; x++) contact.push(bottomOf(x) >= bbox.y1 - Math.max(1, Math.round(height * 0.02)));
  const clusters: Array<{ start: number; end: number }> = [];
  let start = -1;
  for (let i = 0; i <= contact.length; i++) {
    if (contact[i] && start < 0) start = i;
    if ((!contact[i] || i === contact.length) && start >= 0) {
      // fechar o grupo só após um intervalo real (arco): junta grupos separados por ≤3 colunas
      let j = i;
      while (j < contact.length && !contact[j] && j - i < 3) j++;
      if (j < contact.length && contact[j] && i !== contact.length) { i = j; continue; }
      clusters.push({ start, end: i - 1 }); start = -1;
    }
  }
  const significant = clusters.filter((c) => c.end - c.start + 1 >= Math.max(3, (bbox.x1 - bbox.x0) * 0.03));
  if (significant.length < 2) return null;
  const bw = Math.max(1, bbox.x1 - bbox.x0 + 1);
  return significant.slice(0, 4).map((c) => ({
    centreXFraction: (bbox.x0 + (c.start + c.end) / 2 - bbox.x0) / bw,
    widthFraction: (c.end - c.start + 1) / bw,
  }));
}

/**
 * Raio estimado pelo mergulho da aresta inferior: entre as rodas, o fundo da máscara
 * sobe até à soleira (≈ altura do centro da roda); nas rodas desce ao chão. A diferença
 * aproxima o raio. (A altura da coluna no centro da roda mede o corpo inteiro — não serve.)
 */
function radiusFromBottomDip(evidence: ImageEvidence, contacts: Array<{ centreXFraction: number }>): number {
  const { mask, width, bbox } = evidence;
  const bottomOf = (x: number): number => { for (let y = bbox.y1; y >= bbox.y0; y--) if (mask[y * width + x]) return y; return bbox.y0; };
  if (contacts.length < 2) return 0.16;
  const left = bbox.x0 + Math.round(contacts[0]!.centreXFraction * (bbox.x1 - bbox.x0));
  const right = bbox.x0 + Math.round(contacts[contacts.length - 1]!.centreXFraction * (bbox.x1 - bbox.x0));
  const mid = Math.round((left + right) / 2);
  const sillY = bottomOf(mid);
  const dip = (bbox.y1 - sillY) / Math.max(1, bbox.y1 - bbox.y0 + 1);
  return Math.min(0.35, Math.max(0.08, dip));
}

export function deriveVehicleProportions(evidence: ImageEvidence, plan: SpatialPlanV2): ProportionsResult {
  const wheelComponents = plan.components.filter((c) => isWheel(c.label)).sort((a, b) => a.transform.position[0] - b.transform.position[0]);
  if (wheelComponents.length < 2) return { status: 'unavailable', reason: 'O plano não declara pelo menos duas rodas; proporções de rodas não são deriváveis.' };
  const contacts = detectWheelContacts(evidence);
  if (!contacts) return { status: 'unavailable', reason: 'Não detectei dois contactos de roda com a linha de chão na silhueta (vista ou máscara insuficientes); nada é proposto.' };
  // Orientação: a foto pode estar espelhada face à projecção do plano (+X para a direita).
  // O centro de massa da metade superior da máscara (cabina) decide: compara com o centro
  // da cabina do arquétipo medido desde a traseira e desde a frente; fica o mais próximo.
  const { mask, width, bbox } = evidence;
  let topMass = 0, topWeighted = 0;
  const midY = bbox.y0 + (bbox.y1 - bbox.y0) * 0.45;
  for (let y = bbox.y0; y <= midY; y++) for (let x = bbox.x0; x <= bbox.x1; x++) if (mask[y * width + x]) { topMass++; topWeighted += (x - bbox.x0) / Math.max(1, bbox.x1 - bbox.x0); }
  const cabinCentroid = topMass ? topWeighted / topMass : 0.5;
  // dois eixos distintos no plano (rodas do mesmo eixo partilham x): emparelhar por eixo
  const axles = [...new Map(wheelComponents.map((c) => [Math.round(c.transform.position[0] * 1000), c])).values()]
    .sort((a, b) => a.transform.position[0] - b.transform.position[0]);
  if (axles.length < 2 || contacts.length < 2) return { status: 'unavailable', reason: 'Não detectei dois eixos/contactos correspondentes; nada é proposto.' };
  const rearAxle = axles[0]!, frontAxle = axles[axles.length - 1]!;
  void rearAxle; void frontAxle;
  // plano: traseira à esquerda na projecção. Se o centróide da cabina na imagem está mais
  // perto da posição esperada com a frente à esquerda, a foto está espelhada.
  const cabinFromRear = 0.45; // ponto médio típico da cabina desde a traseira (declarado, não medido no plano)
  const mirrored = Math.abs(cabinCentroid - (1 - cabinFromRear)) < Math.abs(cabinCentroid - cabinFromRear);
  const orderedContacts = mirrored ? [...contacts].reverse() : contacts;
  const wheels: DerivedWheel[] = [];
  const usedContacts = orderedContacts.slice(0, axles.length);
  const radius = radiusFromBottomDip(evidence, usedContacts);
  axles.forEach((axleComponent, i) => {
    const contact = usedContacts[i];
    if (!contact) return;
    for (const c of wheelComponents.filter((w) => Math.round(w.transform.position[0] * 1000) === Math.round(axleComponent.transform.position[0] * 1000))) {
      wheels.push({
        componentId: c.id,
        centreXFraction: contact.centreXFraction,
        radiusFractionOfBboxHeight: radius,
        confidence: 'estimated',
      });
    }
  });
  if (wheels.length < 2) return { status: 'unavailable', reason: 'Emparelhamento roda/contacto insuficiente; nada é proposto.' };
  return {
    status: 'derived',
    aspect: evidence.aspect,
    groundYFraction: (evidence.bbox.y1 + 1) / evidence.height,
    wheels,
    wheelbaseFraction: Math.abs(usedContacts[usedContacts.length - 1]!.centreXFraction - usedContacts[0]!.centreXFraction),
    method: `Contactos de roda = agrupamentos de colunas cujo fundo toca a linha de chão; orientação ${mirrored ? 'espelhada (frente à esquerda)' : 'directa'} decidida pelo centróide da cabina na metade superior da máscara; raio ≈ mergulho da aresta inferior entre rodas (soleira≈centro da roda). Proporção global = aspecto da bbox da máscara.`,
    uncertainty: 'Estimativa a partir de uma silhueta 2D sem calibração: posições são fracções da bbox, não medidas métricas; a decisão de espelho usa um ponto médio de cabina típico declarado (0.45) e pode falhar em carroçarias atípicas; rodas ocultas degradam a estimativa.',
  };
}

/**
 * Constrói a proposta tipada. Valida aplicando as operações a uma cópia com
 * `applySpatialOperationV2` (proveniência inferred de pré-visualização); se alguma
 * operação for inválida, nenhuma proposta é produzida.
 */
export function buildProportionsProposal(plan: SpatialPlanV2, derived: DerivedProportions, camera: 'side' | 'three-quarter' | 'front-rear' = 'side'): SpatialOperationV2[] | null {
  const span = componentSpan(plan);
  const spanX = Math.max(1e-6, span.maxX - span.minX);
  const spanY = Math.max(1e-6, span.maxY - span.minY);
  const operations: SpatialOperationV2[] = [];
  let n = 0;
  const op = (componentId: string, value: unknown): SpatialOperationV2 => ({ contract: 'unfold.spatial-operation.v2', operationId: `evidence-proportions-${++n}`, kind: 'set-transform', componentId, nodeKey: null, value });
  // Rodas: posição ao longo do comprimento e raio derivados; z e rotação do plano ficam.
  for (const wheel of derived.wheels) {
    const component = plan.components.find((c) => c.id === wheel.componentId);
    if (!component) continue;
    const targetX = span.minX + wheel.centreXFraction * spanX;
    const targetRadius = wheel.radiusFractionOfBboxHeight * spanY;
    const diameter = componentDiameter(plan, wheel.componentId);
    const scale = diameter && diameter > 0 ? (targetRadius * 2) / diameter : 1;
    operations.push(op(wheel.componentId, {
      position: [targetX, span.minY + targetRadius, component.transform.position[2]],
      rotationRad: component.transform.rotationRad,
      scale: [scale, scale, scale],
    }));
  }
  // Corpo: altura global para o aspecto observado. SÓ em vista lateral: em três-quartos o
  // aspecto da máscara está encurtado pela perspectiva e aplicá-lo corrompe a carroçaria
  // (medido: baseline do carro caía 0.654 → 0.564 com este termo em três-quartos).
  const body = camera === 'side' ? plan.components.find((c) => isBody(c.label)) : undefined;
  if (body) {
    const currentAspect = spanX / spanY;
    const scaleY = Math.min(1.25, Math.max(0.8, currentAspect / Math.max(0.5, derived.aspect)));
    if (Math.abs(scaleY - 1) > 0.02) {
      operations.push(op(body.id, {
        position: body.transform.position,
        rotationRad: body.transform.rotationRad,
        scale: [body.transform.scale[0], body.transform.scale[1] * scaleY, body.transform.scale[2]],
      }));
    }
  }
  if (!operations.length) return null;
  try {
    let probe: SpatialPlanV2 = plan;
    for (const operation of operations) probe = applySpatialOperationV2(probe, operation, { origin: 'inferred', evidence: 'evidence-proportions preview validation' });
    return operations;
  } catch { return null; }
}

/** Mede o efeito das proporções propostas numa CÓPIA (nunca no plano autoritativo). */
export function planWithProportions(plan: SpatialPlanV2, derived: DerivedProportions, camera: 'side' | 'three-quarter' | 'front-rear' = 'side'): SpatialPlanV2 | null {
  const operations = buildProportionsProposal(plan, derived, camera);
  if (!operations) return null;
  let next: SpatialPlanV2 = plan;
  for (const operation of operations) next = applySpatialOperationV2(next, operation, { origin: 'inferred', evidence: 'evidence-derived proportions (measurement copy only)' });
  return next;
}
