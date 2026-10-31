import type { TechnicalDocumentV1 } from './technical-document';

export type ValueValidationStatus = 'unreviewed' | 'ambiguous' | 'verified' | 'rejected' | 'corrected';
export type EvidenceRegion = {
  coordinates: { x: number; y: number; width: number; height: number };
  originalSize: { width: number; height: number };
  source: 'manual_selection' | 'model_proposed';
  confirmedBy: 'user' | null;
  selectedAt: string;
};
export type ReviewedValue = { rawValue: string; value: number | null; unit: string | null };
export type TechnicalValueReviewEntry = {
  status: ValueValidationStatus;
  sourceRef: { kind: 'element'; id: string } | { kind: 'observed_text'; index: number };
  original: ReviewedValue;
  current: ReviewedValue | null;
  region: EvidenceRegion | null;
};
export type TechnicalReviewEvent = {
  elementId: string;
  field: 'value';
  action: 'region_selected' | 'regional_reading' | 'confirmed' | 'rejected' | 'corrected';
  actor: 'user' | 'muse_spark_same_model';
  at: string;
  previous: ReviewedValue;
  next: ReviewedValue | null;
  region?: EvidenceRegion;
  note?: string;
};
export type TechnicalValueReviewV1 = {
  schema: 'technical_value_review.v1';
  documentSha256: string;
  entries: Record<string, TechnicalValueReviewEntry>;
  history: TechnicalReviewEvent[];
};

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function createTechnicalValueReview(documentSha256: string, document: TechnicalDocumentV1): TechnicalValueReviewV1 {
  if (!/^[a-f0-9]{64}$/i.test(documentSha256)) throw new Error('Hash SHA-256 do documento inválido.');
  const ambiguityText = normalize([...document.ambiguities, ...document.observedText].join(' '));
  const entries: TechnicalValueReviewV1['entries'] = {};
  for (const item of document.elements) {
    if (item.rawValue === null) continue;
    const itemText = normalize(`${item.label} ${item.rawValue}`);
    const isAmbiguous = item.status === 'unknown' || item.confidence < 0.5 || ambiguityText.includes(itemText) || normalize(item.label).length > 2 && ambiguityText.includes(normalize(item.label));
    entries[item.id] = {
      status: isAmbiguous ? 'ambiguous' : 'unreviewed',
      sourceRef: { kind: 'element', id: item.id },
      original: { rawValue: item.rawValue, value: item.value, unit: item.unit },
      current: null,
      region: null,
    };
  }
  document.observedText.forEach((rawValue, index) => {
    if (!/[-+]?\d/.test(rawValue)) return;
    const valueMatch = rawValue.match(/[-+]?\d+(?:[.,]\d+)?/);
    const unitMatch = rawValue.match(/\b(?:m²|m2|mm|cm|m|ft²|ft2|VA|W|kW|V|A)\b/i);
    const id = `observedText-${index}`;
    entries[id] = {
      status: /incert|duvid|ileg[ií]vel|\?/.test(normalize(rawValue)) ? 'ambiguous' : 'unreviewed',
      sourceRef: { kind: 'observed_text', index },
      original: { rawValue, value: valueMatch ? Number(valueMatch[0].replace(',', '.')) : null, unit: unitMatch?.[0] ?? null },
      current: null,
      region: null,
    };
  });
  return { schema: 'technical_value_review.v1', documentSha256: documentSha256.toLowerCase(), entries, history: [] };
}

export function parseTechnicalValueReview(value: unknown, documentSha256: string, document: TechnicalDocumentV1): TechnicalValueReviewV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Revisão documental persistida inválida.');
  const candidate = value as TechnicalValueReviewV1;
  if (candidate.schema !== 'technical_value_review.v1' || candidate.documentSha256 !== documentSha256 || !candidate.entries || typeof candidate.entries !== 'object' || !Array.isArray(candidate.history) || candidate.history.length > 500) throw new Error('Revisão documental não corresponde à imagem original.');
  const originalById = new Map<string, { sourceRef: TechnicalValueReviewEntry['sourceRef']; original: ReviewedValue }>(document.elements.filter((item) => item.rawValue !== null).map((item) => [item.id, { sourceRef: { kind: 'element', id: item.id }, original: { rawValue: item.rawValue!, value: item.value, unit: item.unit } }]));
  document.observedText.forEach((rawValue, index) => {
    if (!/[-+]?\d/.test(rawValue)) return;
    const id = `observedText-${index}`;
    const valueMatch = rawValue.match(/[-+]?\d+(?:[.,]\d+)?/);
    const unitMatch = rawValue.match(/\b(?:m²|m2|mm|cm|m|ft²|ft2|VA|W|kW|V|A)\b/i);
    originalById.set(id, { sourceRef: { kind: 'observed_text', index }, original: { rawValue, value: valueMatch ? Number(valueMatch[0].replace(',', '.')) : null, unit: unitMatch?.[0] ?? null } });
  });
  for (const [id, entry] of Object.entries(candidate.entries)) {
    const source = originalById.get(id);
    if (!source || !entry || !['unreviewed', 'ambiguous', 'verified', 'rejected', 'corrected'].includes(entry.status) || JSON.stringify(entry.sourceRef) !== JSON.stringify(source.sourceRef) || JSON.stringify(entry.original) !== JSON.stringify(source.original) || !(entry.current === null || typeof entry.current.rawValue === 'string' && (entry.current.value === null || Number.isFinite(entry.current.value)) && (entry.current.unit === null || typeof entry.current.unit === 'string'))) throw new Error('Entrada de revisão inválida ou divergente da extracção original.');
    if (entry.region) validateEvidenceRegion(entry.region.coordinates, entry.region.originalSize);
    const actions = candidate.history.filter((item) => item.elementId === id && item.actor === 'user').map((item) => item.action);
    if (entry.status === 'verified' && !actions.includes('confirmed') || entry.status === 'corrected' && !actions.includes('corrected') || entry.status === 'rejected' && !actions.includes('rejected')) throw new Error('Estado humano sem evento correspondente no histórico.');
  }
  return candidate;
}

export function validateEvidenceRegion(region: EvidenceRegion['coordinates'], originalSize: EvidenceRegion['originalSize']): void {
  if (!Number.isInteger(originalSize.width) || !Number.isInteger(originalSize.height) || originalSize.width < 1 || originalSize.height < 1 || originalSize.width > 20_000 || originalSize.height > 20_000) throw new Error('Dimensões originais da imagem inválidas.');
  if (![region.x, region.y, region.width, region.height].every(Number.isFinite) || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 || region.x + region.width > 1 || region.y + region.height > 1) throw new Error('Região fora dos limites da imagem original.');
}

export function selectManualEvidenceRegion(review: TechnicalValueReviewV1, elementId: string, coordinates: EvidenceRegion['coordinates'], originalSize: EvidenceRegion['originalSize'], now = new Date()): TechnicalValueReviewV1 {
  const entry = review.entries[elementId];
  if (!entry) throw new Error('Elemento sem valor numérico revisto neste documento.');
  validateEvidenceRegion(coordinates, originalSize);
  const region: EvidenceRegion = { coordinates: { ...coordinates }, originalSize: { ...originalSize }, source: 'manual_selection', confirmedBy: 'user', selectedAt: now.toISOString() };
  return {
    ...review,
    entries: { ...review.entries, [elementId]: { ...entry, region } },
    history: [...review.history, { elementId, field: 'value', action: 'region_selected', actor: 'user', at: now.toISOString(), previous: entry.current ?? entry.original, next: null, region }],
  };
}

export function recordRegionalReading(review: TechnicalValueReviewV1, elementId: string, reading: { status: 'readable' | 'uncertain' | 'not_visible'; rawValue: string | null; unit: string | null; explanation: string }, now = new Date()): TechnicalValueReviewV1 {
  const entry = review.entries[elementId];
  if (!entry || !entry.region) throw new Error('A releitura exige uma região seleccionada e associada ao elemento.');
  const parsed = reading.rawValue?.match(/[-+]?\d+(?:[.,]\d+)?/);
  const next = reading.rawValue === null ? null : { rawValue: reading.rawValue, value: parsed ? Number(parsed[0].replace(',', '.')) : null, unit: reading.unit };
  const mismatch = next !== null && (
    next.value === null || entry.original.value === null
      ? normalize(next.rawValue) !== normalize(entry.original.rawValue)
      : Math.abs(next.value - entry.original.value) > 0.0001
  ) || next !== null && next.unit !== null && entry.original.unit !== null && normalize(next.unit) !== normalize(entry.original.unit);
  return {
    ...review,
    entries: { ...review.entries, [elementId]: { ...entry, status: mismatch || reading.status !== 'readable' ? 'ambiguous' : entry.status } },
    history: [...review.history, { elementId, field: 'value', action: 'regional_reading', actor: 'muse_spark_same_model', at: now.toISOString(), previous: entry.current ?? entry.original, next, region: entry.region, note: reading.explanation }],
  };
}

export function applyHumanValueDecision(review: TechnicalValueReviewV1, elementId: string, decision: { action: 'confirm' } | { action: 'reject'; note: string } | { action: 'correct'; rawValue: string; value: number | null; unit: string | null }, now = new Date()): TechnicalValueReviewV1 {
  const entry = review.entries[elementId];
  if (!entry) throw new Error('Elemento sem valor numérico revisto neste documento.');
  const at = now.toISOString();
  const previous = entry.current ?? entry.original;
  if (decision.action === 'confirm') {
    return { ...review, entries: { ...review.entries, [elementId]: { ...entry, status: 'verified', current: entry.original } }, history: [...review.history, { elementId, field: 'value', action: 'confirmed', actor: 'user', at, previous, next: entry.original, ...(entry.region ? { region: entry.region } : {}), note: 'Confirmação humana explícita da leitura original.' }] };
  }
  if (decision.action === 'reject') {
    if (!decision.note.trim()) throw new Error('A rejeição exige uma justificação humana.');
    return { ...review, entries: { ...review.entries, [elementId]: { ...entry, status: 'rejected', current: null } }, history: [...review.history, { elementId, field: 'value', action: 'rejected', actor: 'user', at, previous, next: null, ...(entry.region ? { region: entry.region } : {}), note: decision.note.trim() }] };
  }
  if (!decision.rawValue.trim() || decision.rawValue.length > 100 || decision.value !== null && (!Number.isFinite(decision.value)) || decision.unit !== null && decision.unit.length > 32) throw new Error('Valor corrigido inválido.');
  const next = { rawValue: decision.rawValue.trim(), value: decision.value, unit: decision.unit?.trim() || null };
  return { ...review, entries: { ...review.entries, [elementId]: { ...entry, status: 'corrected', current: next } }, history: [...review.history, { elementId, field: 'value', action: 'corrected', actor: 'user', at, previous, next, ...(entry.region ? { region: entry.region } : {}), note: 'Correcção explícita do utilizador; a extracção original permanece imutável.' }] };
}

export function isValueUsableForPhysicalModel(review: TechnicalValueReviewV1 | undefined, elementId: string): boolean {
  const status = review?.entries[elementId]?.status;
  return status === 'verified' || status === 'corrected';
}
