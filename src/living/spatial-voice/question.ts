/** Universal, bounded text context. It contains labels and reviewed relations, never images or geometry commands. */
export type SpatialQuestion = {
  question: string;
  selectedId: string;
  revision: string;
  title: string;
  components: Array<{ id: string; label: string }>;
  relations: Array<{ fromId: string; toId: string; kind: string; origin: string }>;
  unknowns: string[];
  history: Array<{ question: string; answer: string }>;
};

export function validateSpatialQuestion(input: unknown): SpatialQuestion {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_SPATIAL_QUESTION');
  const q = input as SpatialQuestion;
  const str = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
  if (Object.keys(q).sort().join(',') !== 'components,history,question,relations,revision,selectedId,title,unknowns' || !str(q.question, 500) || !str(q.selectedId, 48) || !str(q.revision, 100) || !str(q.title, 100) || !Array.isArray(q.components) || !q.components.length || q.components.length > 40 || !q.components.every(c => c && Object.keys(c).sort().join(',') === 'id,label' && str(c.id, 48) && str(c.label, 100)) || !q.components.some(c => c.id === q.selectedId) || !Array.isArray(q.relations) || q.relations.length > 80 || !q.relations.every(r => r && Object.keys(r).sort().join(',') === 'fromId,kind,origin,toId' && str(r.fromId, 48) && str(r.toId, 48) && str(r.kind, 40) && str(r.origin, 40) && q.components.some(c => c.id === r.fromId) && q.components.some(c => c.id === r.toId)) || !Array.isArray(q.unknowns) || q.unknowns.length > 20 || !q.unknowns.every(u => str(u, 300)) || !Array.isArray(q.history) || q.history.length > 4 || !q.history.every(h => h && Object.keys(h).sort().join(',') === 'answer,question' && str(h.question, 500) && str(h.answer, 1200))) throw new Error('INVALID_SPATIAL_QUESTION');
  return q;
}

export const SPATIAL_ANSWER_SCHEMA = { type: 'object', additionalProperties: false, required: ['answer', 'limitations'], properties: { answer: { type: 'string', minLength: 1, maxLength: 1200 }, limitations: { type: 'string', minLength: 1, maxLength: 600 } } } as const;
export function parseSpatialAnswer(text: string): { answer: string; limitations: string } {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'answer,limitations') throw new Error('INVALID_SPATIAL_ANSWER');
  const result = value as { answer: unknown; limitations: unknown };
  if (typeof result.answer !== 'string' || !result.answer.trim() || result.answer.length > 1200 || typeof result.limitations !== 'string' || !result.limitations.trim() || result.limitations.length > 600) throw new Error('INVALID_SPATIAL_ANSWER');
  return { answer: result.answer, limitations: result.limitations };
}
