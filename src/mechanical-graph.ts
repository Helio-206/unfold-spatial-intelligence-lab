import type { MechanicalObservation } from './meta';

export const MECHANICAL_GRAPH_SCHEMA = 'mechanical_graph.v1' as const;

export const MECHANICAL_KINDS = ['link', 'joint', 'support', 'shaft', 'coupler', 'handle', 'disc', 'unknown'] as const;
export type MechanicalKind = typeof MECHANICAL_KINDS[number];

export const EVIDENCE_STATUSES = ['observed', 'inferred', 'ambiguous'] as const;
export type EvidenceStatus = typeof EVIDENCE_STATUSES[number];

export const REVIEW_STATUSES = ['pending', 'verified'] as const;
export type ReviewStatus = typeof REVIEW_STATUSES[number];

export type MechanicalGraphSource = {
  caseId: string;
  imagePath: string;
  sourceUrl: string;
  title: string;
};

export type MechanicalGraphNode = {
  id: string;
  sourceElementId: string;
  label: string;
  kind: MechanicalKind;
  provenance: EvidenceStatus;
  evidence: string;
  confidence: number;
  candidates: MechanicalKind[];
  review: ReviewStatus;
  reviewNote?: string;
};

export type MechanicalGraphConnection = {
  id: string;
  sourceConnectionIndex: number;
  from: string;
  to: string;
  relation: string;
  provenance: EvidenceStatus;
  evidence: string;
  review: ReviewStatus;
  reviewNote?: string;
};

export type MechanicalGraphDimension = {
  label: string;
  value: string;
  provenance: 'observed';
  evidence: string;
};

export type ReviewAction =
  | { action: 'approve'; target: 'node' | 'connection'; id: string; note?: string }
  | { action: 'correct_kind'; nodeId: string; kind: MechanicalKind; note: string }
  | { action: 'correct_connection'; connectionId: string; from: string; to: string; relation: string; note: string }
  | { action: 'mark_uncertain'; target: 'node' | 'connection'; id: string; note: string };

export type HumanReviewChange = ReviewAction & {
  author: string;
  confirmedAt: string;
};

export type HumanReviewRecord = {
  status: 'pending' | 'verified';
  proposedActions: ReviewAction[];
  changes: HumanReviewChange[];
  reviewer?: { name: string };
  confirmedAt?: string;
};

export type MechanicalGraphV1 = {
  schema: typeof MECHANICAL_GRAPH_SCHEMA;
  source: MechanicalGraphSource;
  nodes: MechanicalGraphNode[];
  connections: MechanicalGraphConnection[];
  dimensions: MechanicalGraphDimension[];
  review: HumanReviewRecord;
};

export type HumanConfirmation = {
  reviewer: { name: string };
  confirmedAt: string;
  confirmationText: 'CONFIRM_MECHANICAL_REVIEW';
  changes: ReviewAction[];
};

export function validateReviewActions(value: unknown): ReviewAction[] {
  if (!Array.isArray(value)) throw new Error('Plano de revisão inválido.');
  for (const [index, action] of value.entries()) {
    if (!action || typeof action !== 'object' || typeof action.action !== 'string') throw new Error(`Acção de revisão inválida na posição ${index}.`);
    if (action.action === 'approve') {
      if (!['node', 'connection'].includes(action.target) || typeof action.id !== 'string' || !action.id) throw new Error(`Aprovação inválida na posição ${index}.`);
    } else if (action.action === 'correct_kind') {
      if (typeof action.nodeId !== 'string' || !action.nodeId || !(MECHANICAL_KINDS as readonly string[]).includes(action.kind) || typeof action.note !== 'string' || !action.note) throw new Error(`Correcção de tipo inválida na posição ${index}.`);
    } else if (action.action === 'correct_connection') {
      if (typeof action.connectionId !== 'string' || !action.connectionId || typeof action.from !== 'string' || !action.from || typeof action.to !== 'string' || !action.to || typeof action.relation !== 'string' || !action.relation || typeof action.note !== 'string' || !action.note) throw new Error(`Correcção de ligação inválida na posição ${index}.`);
    } else if (action.action === 'mark_uncertain') {
      if (!['node', 'connection'].includes(action.target) || typeof action.id !== 'string' || !action.id || typeof action.note !== 'string' || !action.note) throw new Error(`Marcação de incerteza inválida na posição ${index}.`);
    } else {
      throw new Error(`Acção de revisão desconhecida na posição ${index}.`);
    }
  }
  return value as ReviewAction[];
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

function candidatesForRawKind(kind: MechanicalObservation['elements'][number]['kind']): MechanicalKind[] {
  if (kind === 'fixed') return ['support', 'unknown'];
  if (kind === 'joint') return ['joint', 'coupler', 'support', 'unknown'];
  return ['link', 'shaft', 'coupler', 'handle', 'disc', 'unknown'];
}

export function normalizeMechanicalObservation(observation: MechanicalObservation, source: MechanicalGraphSource): MechanicalGraphV1 {
  const sourceToNode = new Map<string, string>();
  const nodes = observation.elements.map((element, index) => {
    const id = `node-${index + 1}-${slug(element.id)}`;
    sourceToNode.set(element.id, id);
    const candidates = candidatesForRawKind(element.kind);
    const provenance: EvidenceStatus = element.kind === 'bar' ? 'ambiguous' : 'inferred';
    return {
      id,
      sourceElementId: element.id,
      label: element.label,
      kind: 'unknown' as const,
      provenance,
      evidence: `Meta observou ${element.kind}: ${element.evidence}`,
      confidence: element.confidence,
      candidates,
      review: 'pending' as const,
    };
  });

  const connections = observation.connections.map((connection, index) => {
    const from = sourceToNode.get(connection.from);
    const to = sourceToNode.get(connection.to);
    if (!from || !to) throw new Error(`Ligação ${index + 1} referencia elemento ausente.`);
    return {
      id: `connection-${index + 1}`,
      sourceConnectionIndex: index,
      from,
      to,
      relation: connection.relation,
      provenance: 'observed' as const,
      evidence: connection.evidence,
      review: 'pending' as const,
    };
  });

  return {
    schema: MECHANICAL_GRAPH_SCHEMA,
    source,
    nodes,
    connections,
    dimensions: observation.dimensions.map((dimension) => ({ ...dimension, provenance: 'observed' as const })),
    review: { status: 'pending', proposedActions: [], changes: [] },
  };
}

function assertString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} inválido.`);
}

export function validateMechanicalGraph(value: unknown): MechanicalGraphV1 {
  if (!value || typeof value !== 'object') throw new Error('Grafo mecânico inválido.');
  const graph = value as Partial<MechanicalGraphV1>;
  if (graph.schema !== MECHANICAL_GRAPH_SCHEMA || !graph.source || !Array.isArray(graph.nodes) || !Array.isArray(graph.connections) || !Array.isArray(graph.dimensions) || !graph.review) {
    throw new Error('Contrato mechanical_graph.v1 incompleto.');
  }
  assertString(graph.source.caseId, 'source.caseId');
  assertString(graph.source.imagePath, 'source.imagePath');
  assertString(graph.source.sourceUrl, 'source.sourceUrl');
  assertString(graph.source.title, 'source.title');
  if (!['pending', 'verified'].includes(graph.review.status)) throw new Error('Estado de revisão inválido.');
  validateReviewActions(graph.review.proposedActions);
  if (!Array.isArray(graph.review.changes)) throw new Error('Histórico de revisão inválido.');
  for (const change of graph.review.changes) {
    validateReviewActions([change]);
    assertString(change.author, 'review.change.author');
    assertString(change.confirmedAt, 'review.change.confirmedAt');
  }
  if (graph.review.status === 'verified') {
    if (!graph.review.reviewer || typeof graph.review.reviewer.name !== 'string' || !graph.review.reviewer.name || typeof graph.review.confirmedAt !== 'string' || !graph.review.confirmedAt) throw new Error('Revisão verified sem autor ou data.');
  }
  const nodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (!node || typeof node !== 'object') throw new Error('Nó inválido.');
    assertString(node.id, 'node.id');
    assertString(node.sourceElementId, 'node.sourceElementId');
    assertString(node.label, 'node.label');
    assertString(node.evidence, 'node.evidence');
    if (nodeIds.has(node.id)) throw new Error(`ID de nó duplicado: ${node.id}.`);
    nodeIds.add(node.id);
    if (!(MECHANICAL_KINDS as readonly string[]).includes(node.kind)) throw new Error(`Tipo de nó inválido: ${node.kind}.`);
    if (!(EVIDENCE_STATUSES as readonly string[]).includes(node.provenance)) throw new Error(`Proveniência de nó inválida: ${node.id}.`);
    if (!Number.isFinite(node.confidence) || node.confidence < 0 || node.confidence > 1) throw new Error(`Confiança de nó inválida: ${node.id}.`);
    if (!Array.isArray(node.candidates) || node.candidates.some((kind) => !(MECHANICAL_KINDS as readonly string[]).includes(kind))) throw new Error(`Candidatos de nó inválidos: ${node.id}.`);
    if (!(REVIEW_STATUSES as readonly string[]).includes(node.review)) throw new Error(`Revisão de nó inválida: ${node.id}.`);
  }
  const connectionIds = new Set<string>();
  for (const connection of graph.connections) {
    if (!connection || typeof connection !== 'object') throw new Error('Ligação inválida.');
    assertString(connection.id, 'connection.id');
    assertString(connection.from, 'connection.from');
    assertString(connection.to, 'connection.to');
    assertString(connection.relation, 'connection.relation');
    assertString(connection.evidence, 'connection.evidence');
    if (connectionIds.has(connection.id)) throw new Error(`ID de ligação duplicado: ${connection.id}.`);
    connectionIds.add(connection.id);
    if (!nodeIds.has(connection.from) || !nodeIds.has(connection.to) || connection.from === connection.to) throw new Error(`Referência de ligação inválida: ${connection.id}.`);
    if (!(EVIDENCE_STATUSES as readonly string[]).includes(connection.provenance)) throw new Error(`Proveniência de ligação inválida: ${connection.id}.`);
    if (!(REVIEW_STATUSES as readonly string[]).includes(connection.review)) throw new Error(`Revisão de ligação inválida: ${connection.id}.`);
  }
  for (const dimension of graph.dimensions) {
    if (!dimension || typeof dimension !== 'object') throw new Error('Dimensão inválida.');
    assertString(dimension.label, 'dimension.label');
    assertString(dimension.value, 'dimension.value');
    assertString(dimension.evidence, 'dimension.evidence');
    if (dimension.provenance !== 'observed') throw new Error('Dimensão só pode ser observed.');
  }
  return graph as MechanicalGraphV1;
}

function applyReviewActions(graph: MechanicalGraphV1, actions: ReviewAction[], verified: boolean, author?: string, confirmedAt?: string): MechanicalGraphV1 {
  const safeActions = validateReviewActions(actions);
  const reviewed: MechanicalGraphV1 = structuredClone(graph);
  const nodes = new Map(reviewed.nodes.map((node) => [node.id, node]));
  const connections = new Map(reviewed.connections.map((connection) => [connection.id, connection]));

  for (const action of safeActions) {
    if (action.action === 'approve') {
      const item = action.target === 'node' ? nodes.get(action.id) : connections.get(action.id);
      if (!item) throw new Error(`Alvo de aprovação inexistente: ${action.id}.`);
      if (verified) item.review = 'verified';
      if (action.note) item.reviewNote = action.note;
    } else if (action.action === 'correct_kind') {
      const node = nodes.get(action.nodeId);
      if (!node) throw new Error(`Nó inexistente: ${action.nodeId}.`);
      if (!(MECHANICAL_KINDS as readonly string[]).includes(action.kind)) throw new Error(`Tipo corrigido inválido: ${action.kind}.`);
      node.kind = action.kind;
      node.provenance = 'inferred';
      if (verified) node.review = 'verified';
      node.reviewNote = action.note;
    } else if (action.action === 'correct_connection') {
      const connection = connections.get(action.connectionId);
      if (!connection) throw new Error(`Ligação inexistente: ${action.connectionId}.`);
      if (!nodes.has(action.from) || !nodes.has(action.to) || action.from === action.to) throw new Error(`Ligação corrigida inválida: ${action.connectionId}.`);
      connection.from = action.from;
      connection.to = action.to;
      connection.relation = action.relation;
      connection.provenance = 'inferred';
      if (verified) connection.review = 'verified';
      connection.reviewNote = action.note;
    } else {
      const item = action.target === 'node' ? nodes.get(action.id) : connections.get(action.id);
      if (!item) throw new Error(`Alvo de incerteza inexistente: ${action.id}.`);
      item.provenance = 'ambiguous';
      if (verified) item.review = 'verified';
      item.reviewNote = action.note;
    }
  }

  reviewed.review = {
    status: verified ? 'verified' : 'pending',
    proposedActions: verified ? structuredClone(graph.review.proposedActions) : structuredClone(safeActions),
    changes: verified && author && confirmedAt ? safeActions.map((action) => ({ ...action, author, confirmedAt })) : [],
    ...(verified && author && confirmedAt ? { reviewer: { name: author }, confirmedAt } : {}),
  };
  return validateMechanicalGraph(reviewed);
}

export function applyReviewDraft(graph: MechanicalGraphV1, actions: ReviewAction[]): MechanicalGraphV1 {
  return applyReviewActions({ ...graph, review: { ...graph.review, status: 'pending', changes: [] } }, actions, false);
}

export function confirmHumanReview(graph: MechanicalGraphV1, confirmation: HumanConfirmation): MechanicalGraphV1 {
  if (graph.review.status !== 'pending') throw new Error('Só uma revisão pending pode ser confirmada.');
  if (!confirmation.reviewer || typeof confirmation.reviewer.name !== 'string' || !confirmation.reviewer.name.trim()) throw new Error('Autor da revisão é obrigatório.');
  if (confirmation.confirmationText !== 'CONFIRM_MECHANICAL_REVIEW') throw new Error('Confirmação humana explícita ausente.');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(confirmation.confirmedAt)) throw new Error('Data de confirmação deve ser ISO UTC.');
  return applyReviewActions(graph, confirmation.changes, true, confirmation.reviewer.name.trim(), confirmation.confirmedAt);
}
