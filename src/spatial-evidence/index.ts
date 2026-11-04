/** Independent, source-bound evidence; all review actors are client assertions, not authentication. */
export const SPATIAL_EVIDENCE_CONTRACT = 'unfold.spatial-evidence.v1' as const;
export type EvidenceNature = 'observed' | 'inferred' | 'approximate' | 'unknown';
export type EvidenceStatus = 'hypothesis' | 'verified' | 'needs_review' | 'invalidated';
export type EvidenceSource = { id: string; sha256: string; kind: 'image' | 'document'; pages: Array<{ page: number; width: number; height: number }> };
export type EvidenceComponent = { id: string; identity: string; correspondenceVersion: string };
export type EvidenceRegion = { id: string; sourceId: string; page: number; x: number; y: number; width: number; height: number };
export type EvidenceAssociation = { id: string; componentId: string; componentIdentity: string; correspondenceVersion: string; regionId: string; nature: EvidenceNature; origin: 'ai' | 'person' | 'import'; provenance: string; status: EvidenceStatus; review: { actor: string; revision: string; decision: 'verified' } | null };
export type EvidenceSnapshot = { contract: typeof SPATIAL_EVIDENCE_CONTRACT; revision: { id: string; number: number; parentId: string | null; previousIds: string[] }; sources: EvidenceSource[]; components: EvidenceComponent[]; regions: EvidenceRegion[]; associations: EvidenceAssociation[] };
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const keys = (x: unknown, list: string[]) => object(x) && Object.keys(x).sort().join('|') === [...list].sort().join('|');
const id = (v: unknown): v is string => typeof v === 'string' && ID.test(v);
const text = (v: unknown, max = 500): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const positiveInt = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0 && Number(v) <= 100_000;
const fail = (code: string): never => { throw new Error(code); };
const unique = (items: Array<{ id: string }>) => new Set(items.map(item => item.id)).size === items.length;

/** Validates untrusted snapshots before use; never fills in missing coordinates. */
export function validateEvidence(value: unknown): EvidenceSnapshot {
  if (!keys(value, ['contract','revision','sources','components','regions','associations'])) return fail('EVIDENCE_INVALID');
  const v = value as unknown as EvidenceSnapshot;
  if (v.contract !== SPATIAL_EVIDENCE_CONTRACT || !keys(v.revision, ['id','number','parentId','previousIds']) || !id(v.revision.id) || !Number.isSafeInteger(v.revision.number) || v.revision.number < 0 || !(v.revision.parentId === null || id(v.revision.parentId)) || (v.revision.number === 0) !== (v.revision.parentId === null) || v.revision.parentId === v.revision.id || !Array.isArray(v.revision.previousIds) || v.revision.previousIds.length !== v.revision.number || v.revision.previousIds.length > 10_000 || !v.revision.previousIds.every(id) || new Set([...v.revision.previousIds, v.revision.id]).size !== v.revision.number + 1 || (v.revision.previousIds.at(-1) ?? null) !== v.revision.parentId) return fail('EVIDENCE_REVISION_INVALID');
  if (!Array.isArray(v.sources) || v.sources.length > 100 || !v.sources.every(s => keys(s,['id','sha256','kind','pages']) && id(s.id) && typeof s.sha256 === 'string' && HASH.test(s.sha256) && ['image','document'].includes(s.kind) && Array.isArray(s.pages) && s.pages.length > 0 && s.pages.length <= 1000 && s.pages.every(p => keys(p,['page','width','height']) && positiveInt(p.page) && positiveInt(p.width) && positiveInt(p.height)) && new Set(s.pages.map(p => p.page)).size === s.pages.length && (s.kind !== 'image' || s.pages.length === 1 && s.pages[0]!.page === 1)) || !unique(v.sources)) return fail('EVIDENCE_SOURCE_INVALID');
  const revisions = new Set([...v.revision.previousIds, v.revision.id]);
  const sourcePages = new Map(v.sources.map(s => [s.id, new Set(s.pages.map(p => p.page))]));
  if (!Array.isArray(v.components) || v.components.length > 1000 || !v.components.every(c => keys(c,['id','identity','correspondenceVersion']) && id(c.id) && id(c.identity) && id(c.correspondenceVersion)) || !unique(v.components)) return fail('EVIDENCE_COMPONENT_INVALID');
  const componentsById = new Map(v.components.map(c => [c.id, c]));
  if (!Array.isArray(v.regions) || v.regions.length > 5000 || !v.regions.every(r => keys(r,['id','sourceId','page','x','y','width','height']) && id(r.id) && id(r.sourceId) && positiveInt(r.page) && [r.x,r.y,r.width,r.height].every(number) && r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0 && r.x + r.width <= 1 && r.y + r.height <= 1 && sourcePages.get(r.sourceId)?.has(r.page)) || !unique(v.regions)) return fail('EVIDENCE_REGION_INVALID');
  const regionsById = new Map(v.regions.map(r => [r.id, r]));
  if (!Array.isArray(v.associations) || v.associations.length > 10000 || !v.associations.every(a => {
    if (!keys(a,['id','componentId','componentIdentity','correspondenceVersion','regionId','nature','origin','provenance','status','review']) || !id(a.id) || !id(a.componentId) || !id(a.componentIdentity) || !id(a.correspondenceVersion) || !id(a.regionId) || !['observed','inferred','approximate','unknown'].includes(a.nature) || !['ai','person','import'].includes(a.origin) || !text(a.provenance) || !['hypothesis','verified','needs_review','invalidated'].includes(a.status) || !regionsById.has(a.regionId)) return false;
    const component = componentsById.get(a.componentId);
    if (a.status !== 'invalidated' && (!component || component.identity !== a.componentIdentity)) return false;
    if ((a.status === 'hypothesis' || a.status === 'verified') && component?.correspondenceVersion !== a.correspondenceVersion) return false;
    if (a.status === 'verified' && (!a.review || a.nature === 'unknown')) return false;
    return a.review === null || keys(a.review,['actor','revision','decision']) && text(a.review.actor, 120) && id(a.review.revision) && revisions.has(a.review.revision) && a.review.decision === 'verified';
  }) || !unique(v.associations)) return fail('EVIDENCE_ASSOCIATION_INVALID');
  const activePairs = new Set<string>();
  for (const a of v.associations) if (a.status !== 'invalidated') { const r = regionsById.get(a.regionId)!; const k = JSON.stringify([a.componentId, r.sourceId, r.page, r.x, r.y, r.width, r.height]); if (activePairs.has(k)) return fail('EVIDENCE_CONTRADICTION'); activePairs.add(k); }
  return structuredClone(v);
}

export function createEvidence(revisionId: string): EvidenceSnapshot {
  return validateEvidence({ contract: SPATIAL_EVIDENCE_CONTRACT, revision: { id: revisionId, number: 0, parentId: null, previousIds: [] }, sources: [], components: [], regions: [], associations: [] });
}

function advance(current: EvidenceSnapshot, expected: string, next: string, update: (draft: EvidenceSnapshot) => void): EvidenceSnapshot {
  const copy = validateEvidence(current);
  if (copy.revision.id !== expected) return fail('EVIDENCE_STALE_REVISION');
  if (!id(next) || next === expected || copy.revision.previousIds.includes(next)) return fail('EVIDENCE_REVISION_INVALID');
  update(copy); copy.revision = { id: next, number: copy.revision.number + 1, parentId: expected, previousIds: [...copy.revision.previousIds, expected] };
  return validateEvidence(copy);
}

export function addSource(snapshot: EvidenceSnapshot, expected: string, next: string, source: EvidenceSource): EvidenceSnapshot {
  return advance(snapshot, expected, next, draft => { draft.sources.push(structuredClone(source)); });
}
export function addRegion(snapshot: EvidenceSnapshot, expected: string, next: string, region: EvidenceRegion): EvidenceSnapshot {
  return advance(snapshot, expected, next, draft => { draft.regions.push(structuredClone(region)); });
}
export function addAssociation(snapshot: EvidenceSnapshot, expected: string, next: string, association: Omit<EvidenceAssociation, 'componentIdentity' | 'correspondenceVersion' | 'status' | 'review'>): EvidenceSnapshot {
  return advance(snapshot, expected, next, draft => {
    const component = draft.components.find(c => c.id === association.componentId); if (!component) return fail('EVIDENCE_COMPONENT_NOT_FOUND');
    draft.associations.push({ ...structuredClone(association), componentIdentity: component.identity, correspondenceVersion: component.correspondenceVersion, status: 'hypothesis', review: null });
  });
}
/** A client-asserted decision, not proof of authenticated human identity. The nature never changes. */
export function verifyAssociation(snapshot: EvidenceSnapshot, expected: string, next: string, associationId: string, actor: string): EvidenceSnapshot {
  return advance(snapshot, expected, next, draft => {
    const a = draft.associations.find(item => item.id === associationId); if (!a || a.status === 'invalidated' || a.nature === 'unknown' || !text(actor,120)) return fail('EVIDENCE_REVIEW_INVALID');
    const c = draft.components.find(item => item.id === a.componentId); if (!c || c.identity !== a.componentIdentity) return fail('EVIDENCE_REVIEW_INVALID');
    a.correspondenceVersion = c.correspondenceVersion; a.status = 'verified'; a.review = { actor, revision: next, decision: 'verified' };
  });
}
/** Caller must supply a complete authoritative component inventory and bump correspondenceVersion when binding may change. */
export function reconcileComponents(snapshot: EvidenceSnapshot, expected: string, next: string, components: EvidenceComponent[]): EvidenceSnapshot {
  return advance(snapshot, expected, next, draft => {
    draft.components = structuredClone(components);
    const byId = new Map(draft.components.map(component => [component.id, component]));
    for (const a of draft.associations) {
      if (a.status === 'invalidated') continue;
      const c = byId.get(a.componentId);
      if (!c || c.identity !== a.componentIdentity) a.status = 'invalidated';
      else if (c.correspondenceVersion !== a.correspondenceVersion) a.status = 'needs_review';
    }
  });
}
export function associationsForComponent(snapshot: EvidenceSnapshot, componentId: string): EvidenceAssociation[] {
  return validateEvidence(snapshot).associations.filter(a => a.componentId === componentId && a.status !== 'invalidated');
}
export function associationsForRegion(snapshot: EvidenceSnapshot, regionId: string): EvidenceAssociation[] {
  return validateEvidence(snapshot).associations.filter(a => a.regionId === regionId && a.status !== 'invalidated');
}
export function serializeEvidence(snapshot: EvidenceSnapshot): string { return JSON.stringify(validateEvidence(snapshot)); }
export function deserializeEvidence(json: string): EvidenceSnapshot {
  if (typeof json !== 'string' || json.length > 5_000_000) return fail('EVIDENCE_SERIALIZATION_INVALID');
  let value: unknown; try { value = JSON.parse(json); } catch { return fail('EVIDENCE_SERIALIZATION_INVALID'); }
  return validateEvidence(value);
}
