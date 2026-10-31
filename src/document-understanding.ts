import { validateMechanicalObservation, type MechanicalObservation } from './meta';

export const DOCUMENT_DOMAINS = ['architectural_floorplan', 'electrical_installation_plan', 'mechanical_mechanism', 'unknown'] as const;
export type DocumentDomain = typeof DOCUMENT_DOMAINS[number];
export type EvidenceStatus = 'observed' | 'inferred' | 'ambiguous';

export type EvidenceValue<T> = { value: T; status: EvidenceStatus; evidence: string; confidence: number };
export type ArchitecturalAnalysis = {
  rooms: Array<{ id: string; name: EvidenceValue<string>; area?: EvidenceValue<{ value: number; unit: 'm²' | 'ft²' | 'unknown' }> }>;
  dimensions: Array<{ id: string; label: EvidenceValue<string>; value: EvidenceValue<number>; unit: EvidenceValue<string> }>;
  elements: Array<{ id: string; kind: 'wall' | 'door' | 'window' | 'stair' | 'unknown'; label: EvidenceValue<string> }>;
  relations: Array<{ fromId: string; toId: string; relation: EvidenceValue<string> }>;
  ambiguities: string[];
  missingInformation: string[];
};
export type ElectricalAnalysis = {
  symbols: Array<{ id: string; kind: 'lighting_point' | 'socket' | 'panel' | 'other' | 'unknown'; label: EvidenceValue<string> }>;
  ratings: Array<{ id: string; targetId: string | null; quantity: 'apparent_power' | 'active_power' | 'voltage'; value: EvidenceValue<number>; unit: 'VA' | 'W' | 'V' }>;
  circuits: Array<{ id: string; label: EvidenceValue<string> }>;
  connections: Array<{ fromId: string; toId: string; relation: EvidenceValue<string> }>;
  ambiguities: string[];
  missingInformation: string[];
};
export type UnknownAnalysis = { visibleDescription: string; evidence: string; ambiguities: string[]; missingInformation: string[] };
export type DocumentExtraction =
  | { domain: 'architectural_floorplan'; data: ArchitecturalAnalysis }
  | { domain: 'electrical_installation_plan'; data: ElectricalAnalysis }
  | { domain: 'mechanical_mechanism'; data: MechanicalObservation }
  | { domain: 'unknown'; data: UnknownAnalysis };
export type DocumentAnswer = { id: string; question: string; answer: string; basis: 'observed' | 'interpretation' | 'missing'; sourceIds: string[] };
export type DocumentAnalysis = {
  domain: DocumentDomain;
  classification: { confidence: number; evidence: string; rationale: string };
  extraction: DocumentExtraction;
  answers: DocumentAnswer[];
};

export type DocumentCorrection = {
  field: 'domain' | 'component' | 'value' | 'unit' | 'relation' | 'missing_parameter';
  targetId: string | null;
  value: string;
  unit: string | null;
  confirmed: true;
  author: 'user';
  provenance: 'explicit_user_correction';
  createdAt: string;
};

export const DOCUMENT_QUESTIONS: Record<'architectural_floorplan' | 'electrical_installation_plan', Array<{ id: string; question: string }>> = {
  architectural_floorplan: [
    { id: 'what_is_this', question: 'O que representa esta planta?' },
    { id: 'rooms', question: 'Que divisões consegues identificar?' },
    { id: 'kitchen_area', question: 'Qual é a área da cozinha?' },
    { id: 'garage_location', question: 'Onde fica a garagem?' },
    { id: 'missing_for_3d', question: 'Que dados te faltam para construir um modelo 3D?' },
  ],
  electrical_installation_plan: [
    { id: 'explain', question: 'Explica-me este desenho.' },
    { id: 'va', question: 'O que significam os valores em VA?' },
    { id: 'lighting', question: 'Consegues identificar os pontos de iluminação?' },
    { id: 'fault_test', question: 'Consigo ligar este circuito e testar uma falha?' },
    { id: 'missing_for_simulation', question: 'Que informações são necessárias para uma simulação fiável?' },
  ],
};

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = (value: unknown, max = 700): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const confidence = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const stringList = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 80 && value.every((item) => nonEmpty(item, 700));

function validateEvidence<T>(value: unknown, isValue: (candidate: unknown) => candidate is T): value is EvidenceValue<T> {
  return isObject(value) && isValue(value.value) && ['observed', 'inferred', 'ambiguous'].includes(String(value.status)) && nonEmpty(value.evidence) && confidence(value.confidence);
}

function idsUnique(items: Array<{ id: string }>): boolean {
  return new Set(items.map((item) => item.id)).size === items.length;
}

function validateArchitecture(value: unknown): value is ArchitecturalAnalysis {
  if (!isObject(value) || !Array.isArray(value.rooms) || value.rooms.length > 100 || !Array.isArray(value.dimensions) || value.dimensions.length > 200 || !Array.isArray(value.elements) || value.elements.length > 500 || !Array.isArray(value.relations) || value.relations.length > 500 || !stringList(value.ambiguities) || !stringList(value.missingInformation)) return false;
  const ids = [...value.rooms, ...value.dimensions, ...value.elements];
  if (ids.some((item) => !isObject(item) || !nonEmpty(item.id, 100)) || !idsUnique(ids as Array<{ id: string }>)) return false;
  if (!value.rooms.every((room) => isObject(room) && validateEvidence(room.name, nonEmpty) && (room.area === undefined || validateEvidence(room.area, (area): area is { value: number; unit: 'm²' | 'ft²' | 'unknown' } => isObject(area) && typeof area.value === 'number' && Number.isFinite(area.value) && area.value >= 0 && ['m²', 'ft²', 'unknown'].includes(String(area.unit)))))) return false;
  if (!value.dimensions.every((dimension) => isObject(dimension) && validateEvidence(dimension.label, nonEmpty) && validateEvidence(dimension.value, (number): number is number => typeof number === 'number' && Number.isFinite(number) && number > 0) && validateEvidence(dimension.unit, nonEmpty))) return false;
  if (!value.elements.every((element) => isObject(element) && ['wall', 'door', 'window', 'stair', 'unknown'].includes(String(element.kind)) && validateEvidence(element.label, nonEmpty))) return false;
  const known = new Set(ids.map((item) => (item as { id: string }).id));
  return value.relations.every((relation) => isObject(relation) && known.has(String(relation.fromId)) && known.has(String(relation.toId)) && validateEvidence(relation.relation, nonEmpty));
}

function validateElectrical(value: unknown): value is ElectricalAnalysis {
  if (!isObject(value) || !Array.isArray(value.symbols) || value.symbols.length > 300 || !Array.isArray(value.ratings) || value.ratings.length > 300 || !Array.isArray(value.circuits) || value.circuits.length > 100 || !Array.isArray(value.connections) || value.connections.length > 500 || !stringList(value.ambiguities) || !stringList(value.missingInformation)) return false;
  const ids = [...value.symbols, ...value.ratings, ...value.circuits];
  if (ids.some((item) => !isObject(item) || !nonEmpty(item.id, 100)) || !idsUnique(ids as Array<{ id: string }>)) return false;
  if (!value.symbols.every((symbol) => isObject(symbol) && ['lighting_point', 'socket', 'panel', 'other', 'unknown'].includes(String(symbol.kind)) && validateEvidence(symbol.label, nonEmpty))) return false;
  if (!value.ratings.every((rating) => isObject(rating) && (rating.targetId === null || typeof rating.targetId === 'string' && (value.symbols as Array<{ id: string }>).some((symbol) => symbol.id === rating.targetId) || typeof rating.targetId === 'string' && (value.circuits as Array<{ id: string }>).some((circuit) => circuit.id === rating.targetId)) && ['apparent_power', 'active_power', 'voltage'].includes(String(rating.quantity)) && ['VA', 'W', 'V'].includes(String(rating.unit)) && (rating.quantity === 'apparent_power' ? rating.unit === 'VA' : rating.quantity === 'active_power' ? rating.unit === 'W' : rating.unit === 'V') && validateEvidence(rating.value, (number): number is number => typeof number === 'number' && Number.isFinite(number) && number > 0))) return false;
  if (!value.circuits.every((circuit) => isObject(circuit) && validateEvidence(circuit.label, nonEmpty))) return false;
  const known = new Set(ids.map((item) => (item as { id: string }).id));
  return value.connections.every((connection) => isObject(connection) && known.has(String(connection.fromId)) && known.has(String(connection.toId)) && validateEvidence(connection.relation, nonEmpty));
}

export function validateDocumentAnalysis(value: unknown): DocumentAnalysis {
  if (!isObject(value) || !DOCUMENT_DOMAINS.includes(value.domain as DocumentDomain) || !isObject(value.classification) || !confidence(value.classification.confidence) || !nonEmpty(value.classification.evidence) || !nonEmpty(value.classification.rationale) || !isObject(value.extraction) || value.extraction.domain !== value.domain || !Array.isArray(value.answers) || value.answers.length > 5) throw new Error('Classificação ou envelope do documento inválido.');
  const extraction = value.extraction;
  const valid = value.domain === 'architectural_floorplan' ? validateArchitecture(extraction.data)
    : value.domain === 'electrical_installation_plan' ? validateElectrical(extraction.data)
      : value.domain === 'mechanical_mechanism' ? (() => { try { validateMechanicalObservation(extraction.data); return true; } catch { return false; } })()
        : isObject(extraction.data) && nonEmpty(extraction.data.visibleDescription) && nonEmpty(extraction.data.evidence) && stringList(extraction.data.ambiguities) && stringList(extraction.data.missingInformation);
  if (!valid) throw new Error('Os dados extraídos não correspondem ao domínio classificado.');
  const answers = value.answers;
  if (!answers.every((answer) => isObject(answer) && nonEmpty(answer.id, 80) && nonEmpty(answer.question, 300) && nonEmpty(answer.answer, 1200) && ['observed', 'interpretation', 'missing'].includes(String(answer.basis)) && Array.isArray(answer.sourceIds) && answer.sourceIds.length <= 50 && answer.sourceIds.every((id) => typeof id === 'string'))) throw new Error('Respostas contextuais inválidas.');
  if (new Set(answers.map((answer) => (answer as { id: string }).id)).size !== answers.length) throw new Error('IDs de respostas duplicados.');
  const requiredAnswers = value.domain === 'architectural_floorplan' ? DOCUMENT_QUESTIONS.architectural_floorplan : value.domain === 'electrical_installation_plan' ? DOCUMENT_QUESTIONS.electrical_installation_plan : [];
  if (requiredAnswers.length && (answers.length !== requiredAnswers.length || requiredAnswers.some((question) => !answers.some((answer) => (answer as { id: string }).id === question.id)))) throw new Error('Faltam respostas contextuais obrigatórias para o domínio.');
  const knownSources = new Set<string>();
  if (value.domain === 'architectural_floorplan') {
    const data = extraction.data as ArchitecturalAnalysis;
    [...data.rooms, ...data.dimensions, ...data.elements].forEach((item) => knownSources.add(item.id));
  } else if (value.domain === 'electrical_installation_plan') {
    const data = extraction.data as ElectricalAnalysis;
    [...data.symbols, ...data.ratings, ...data.circuits].forEach((item) => knownSources.add(item.id));
  } else if (value.domain === 'mechanical_mechanism') {
    const data = extraction.data as MechanicalObservation;
    data.elements.forEach((item) => knownSources.add(item.id));
  }
  if (answers.some((answer) => (answer as { sourceIds: string[] }).sourceIds.some((id) => !knownSources.has(id)))) throw new Error('Resposta referencia origem documental inexistente.');
  return value as DocumentAnalysis;
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  return trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim() ?? trimmed;
}

function extractJsonObject(text: string): string {
  if (text.length > 200_000) throw new Error('A resposta documental excede o limite de processamento.');
  const start = text.indexOf('{');
  if (start < 0) throw new Error('A resposta não contém um objecto JSON.');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  throw new Error('O objecto JSON da resposta está incompleto.');
}

export function parseDocumentAnalysisText(text: string): DocumentAnalysis {
  let parsed: unknown;
  try {
    const cleaned = stripJsonFence(text);
    try { parsed = JSON.parse(cleaned); }
    catch { parsed = JSON.parse(extractJsonObject(cleaned)); }
  }
  catch { throw new Error('A Meta não devolveu JSON de documento parseável.'); }
  if (isObject(parsed) && parsed.domain !== 'unknown' && isObject(parsed.classification) && typeof parsed.classification.confidence === 'number' && parsed.classification.confidence < 0.6 && isObject(parsed.extraction)) {
    const oldData = isObject(parsed.extraction.data) ? parsed.extraction.data : {};
    const oldAmbiguities = stringList(oldData.ambiguities) ? oldData.ambiguities : [];
    const oldMissing = stringList(oldData.missingInformation) ? oldData.missingInformation : [];
    parsed = {
      ...parsed,
      domain: 'unknown',
      classification: { ...parsed.classification, rationale: `Classificação inconclusiva (${parsed.classification.confidence}); é necessário esclarecer o tipo de documento.` },
      extraction: { domain: 'unknown', data: { visibleDescription: 'O documento não foi classificado com confiança suficiente.', evidence: String(parsed.classification.evidence), ambiguities: oldAmbiguities, missingInformation: [...oldMissing, 'esclarecer o tipo de documento'] } },
      answers: [],
    };
  }
  return validateDocumentAnalysis(parsed);
}

export function buildDocumentImagePrompt(): string {
  return `Analisa a imagem anexada e identifica primeiro o domínio: architectural_floorplan, electrical_installation_plan, mechanical_mechanism ou unknown. Linhas geométricas por si só nunca provam que existe um mecanismo. Se não for claro, usa unknown. Responde apenas com um único objecto JSON válido, sem markdown, preâmbulo ou texto depois do JSON, no formato {"domain":...,"classification":{"confidence":0-1,"evidence":"...","rationale":"..."},"extraction":{"domain":...,"data":...},"answers":[{"id":"...","question":"...","answer":"...","basis":"observed|interpretation|missing","sourceIds":[]}]}.
Toda propriedade extraída inclui evidence literal/visual suficiente, confidence 0-1 e status observed, inferred ou ambiguous. IDs estáveis dentro da resposta. Não inventes coordenadas, conectividade por contacto de linhas, medidas, unidades ou topologia. Se não estiver comprovado, coloca em ambiguities ou missingInformation. Preserva o documento como fonte, não como CAD.
Para architectural_floorplan usa data={rooms:[{id,name:{value,status,evidence,confidence},area?:{value:{value,unit:"m²|ft²|unknown"},status,evidence,confidence}}],dimensions:[{id,label:{value,status,evidence,confidence},value:{value,status,evidence,confidence},unit:{value,status,evidence,confidence}}],elements:[{id,kind:"wall|door|window|stair|unknown",label:{value,status,evidence,confidence}}],relations:[{fromId,toId,relation:{value,status,evidence,confidence}}],ambiguities:[],missingInformation:[]}.
Para electrical_installation_plan usa data={symbols:[{id,kind:"lighting_point|socket|panel|other|unknown",label:{value,status,evidence,confidence}}],ratings:[{id,targetId:null|string,quantity:"apparent_power|active_power|voltage",value:{value,status,evidence,confidence},unit:"VA|W|V"}],circuits:[{id,label:{value,status,evidence,confidence}}],connections:[{fromId,toId,relation:{value,status,evidence,confidence}}],ambiguities:[],missingInformation:[]}. Mantém VA distinto de W. Não infiras disjuntores, secções de cabo, tensão ou ligações a partir de símbolos isolados.
Para mechanical_mechanism usa data como contrato observed-only {elements:[{id,kind:"bar|joint|fixed",label,observed:true,evidence,confidence}],connections:[{from,to,relation,observed:true,evidence}],dimensions:[{label,value,observed:true,evidence}],ambiguities:[],missingInformation:[]}.
Para unknown usa data={visibleDescription,evidence,ambiguities:[],missingInformation:[]}.
Para plantas arquitectónicas responde exactamente aos ids what_is_this, rooms, kitchen_area, garage_location, missing_for_3d; responde com informação em falta quando necessário. Para planos eléctricos responde exactamente aos ids explain, va, lighting, fault_test, missing_for_simulation. Cada resposta deve ter no máximo 45 palavras. Respostas baseadas apenas na imagem, com basis observed, interpretation ou missing e sourceIds existentes. Não afirmes certificação nem simulação física.`;
}

export function documentFacts(analysis: DocumentAnalysis): { facts: string[]; missing: string[]; uncertainty: string[] } {
  if (analysis.domain === 'architectural_floorplan') {
    const data = analysis.extraction.data as ArchitecturalAnalysis;
    return {
      facts: [...data.rooms.map((room) => `${room.name.value}${room.area ? `: ${room.area.value.value} ${room.area.value.unit}` : ''} [${room.name.status}; ${room.name.evidence}]`), ...data.dimensions.map((dimension) => `${dimension.label.value}: ${dimension.value.value} ${dimension.unit.value} [${dimension.value.status}; ${dimension.value.evidence}]`), ...data.elements.map((element) => `${element.kind}: ${element.label.value} [${element.label.status}; ${element.label.evidence}]`)],
      missing: data.missingInformation,
      uncertainty: data.ambiguities,
    };
  }
  if (analysis.domain === 'electrical_installation_plan') {
    const data = analysis.extraction.data as ElectricalAnalysis;
    return {
      facts: [...data.symbols.map((symbol) => `${symbol.kind}: ${symbol.label.value} [${symbol.label.status}; ${symbol.label.evidence}]`), ...data.ratings.map((rating) => `${rating.quantity} ${rating.value.value} ${rating.unit} [${rating.value.status}; ${rating.value.evidence}]`), ...data.circuits.map((circuit) => `circuit: ${circuit.label.value} [${circuit.label.status}; ${circuit.label.evidence}]`), ...data.connections.map((connection) => `${connection.fromId} ${connection.relation.value} ${connection.toId} [${connection.relation.status}]`)],
      missing: data.missingInformation,
      uncertainty: data.ambiguities,
    };
  }
  if (analysis.domain === 'mechanical_mechanism') {
    const data = analysis.extraction.data as MechanicalObservation;
    return { facts: data.elements.map((element) => `${element.kind}: ${element.label} [observed; ${element.evidence}]`).concat(data.dimensions.map((dimension) => `${dimension.label}: ${dimension.value} [observed; ${dimension.evidence}]`)), missing: data.missingInformation, uncertainty: data.ambiguities };
  }
  const data = analysis.extraction.data as UnknownAnalysis;
  return { facts: [`${data.visibleDescription} [${data.evidence}]`], missing: data.missingInformation, uncertainty: data.ambiguities };
}

export function createDocumentCorrection(input: { field: DocumentCorrection['field']; targetId?: string; value: string; unit?: string; now?: Date }): DocumentCorrection {
  const allowed: DocumentCorrection['field'][] = ['domain', 'component', 'value', 'unit', 'relation', 'missing_parameter'];
  if (!allowed.includes(input.field) || !nonEmpty(input.value, 500) || input.targetId !== undefined && !nonEmpty(input.targetId, 100) || input.unit !== undefined && !nonEmpty(input.unit, 40)) throw new Error('Correcção inválida.');
  return { field: input.field, targetId: input.targetId ?? null, value: input.value.trim(), unit: input.unit?.trim() ?? null, confirmed: true, author: 'user', provenance: 'explicit_user_correction', createdAt: (input.now ?? new Date()).toISOString() };
}

export function answerDocumentQuestion(message: string, analysis: DocumentAnalysis): DocumentAnswer | undefined {
  const normalized = message.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const faq = analysis.answers.find((answer) => {
    const question = answer.question.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    return normalized === question || normalized === answer.id.replace(/_/g, ' ');
  });
  return faq;
}
