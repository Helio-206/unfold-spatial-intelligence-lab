import { ANATOMY_COMPONENTS, validateAnatomyReview, validateBoundAnatomyObservation, type AnatomyObservationV1, type AnatomyReviewV1 } from './contracts';

export type AnatomySceneProposal = {
  schema: 'unfold.anatomy_scene.v1';
  sourceObservationId: string;
  sourceImageSha256: string;
  model: { url: '/anatomy/heart.glb'; sha256: string; license: 'CC-BY-4.0'; attribution: string };
  components: Array<{ entityId: string; componentId: string; meshName: string; reviewDecision: 'accepted' | 'corrected'; observationStatus: 'observed' | 'hypothesis' }>;
  uncertainties: string[];
  motion: { kind: 'illustrative'; physiologyValidated: false; durationS: 4; phases: Array<{ id: string; label: string; startS: number; endS: number; note: string }> };
};

export const HEART_MODEL_SHA256 = 'b80a727d022a4ab07ccfcf15caccc228eaccb6d69ec0e72923324946ac35a946';
export const HEART_COMPONENT_LABELS: Record<(typeof ANATOMY_COMPONENTS)[number], string> = {
  'right-atrium': 'Parede do átrio direito', 'left-atrium': 'Parede do átrio esquerdo', 'ventricular-wall': 'Parede ventricular (combinada)',
  'right-ventricle': 'Cavidade do ventrículo direito', 'left-ventricle': 'Cavidade do ventrículo esquerdo', 'ascending-aorta': 'Aorta ascendente',
  'aortic-arch': 'Arco da aorta', 'pulmonary-trunk': 'Tronco pulmonar', 'superior-vena-cava': 'Veia cava superior',
  'left-coronary': 'Árvore coronária esquerda', 'right-coronary': 'Árvore coronária direita',
};

export function buildAnatomySceneProposal(observation: AnatomyObservationV1, reviewInput: unknown): AnatomySceneProposal {
  if (observation.subjectDisposition !== 'heart_illustration') throw new Error('ANATOMY_FAMILY_BLOCKED');
  const review: AnatomyReviewV1 = validateAnatomyReview(reviewInput, observation);
  const decisions = new Map(review.decisions.map((d) => [d.targetId, d]));
  const components = observation.structures.flatMap((structure) => {
    const decision = decisions.get(structure.id)!;
    if (decision.decision === 'reject' || structure.status === 'unknown') return [];
    const componentId = decision.decision === 'correct' ? decision.correctedComponentId! : structure.id;
    if (!ANATOMY_COMPONENTS.includes(componentId)) throw new Error(`ANATOMY_COMPONENT_UNSUPPORTED:${componentId}`);
    return [{ entityId: structure.id, componentId, meshName: componentId, reviewDecision: decision.decision === 'correct' ? 'corrected' as const : 'accepted' as const, observationStatus: structure.status as 'observed' | 'hypothesis' }];
  });
  if (new Set(components.map((component) => component.componentId)).size !== components.length) throw new Error('ANATOMY_REVIEW_DUPLICATE_MAPPING');
  return {
    schema: 'unfold.anatomy_scene.v1', sourceObservationId: observation.observationId, sourceImageSha256: observation.source.sha256,
    model: { url: '/anatomy/heart.glb', sha256: HEART_MODEL_SHA256, license: 'CC-BY-4.0', attribution: 'BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International.' },
    components, uncertainties: [...observation.uncertainties, 'O modelo 3D é um atlas de referência estático; não é reconstruído da ilustração.'],
    motion: { kind: 'illustrative', physiologyValidated: false, durationS: 4, phases: [
      { id: 'fill', label: 'Enchimento (ilustração)', startS: 0, endS: 1, note: 'Realce sequencial educativo; sem fluxo ou força modelados.' },
      { id: 'atria', label: 'Fase auricular (ilustração)', startS: 1, endS: 2, note: 'Realce dos átrios; não representa uma simulação fisiológica.' },
      { id: 'ventricles', label: 'Fase ventricular (ilustração)', startS: 2, endS: 3, note: 'Realce da parede ventricular combinada; sem deformação do músculo.' },
      { id: 'rest', label: 'Relaxamento (ilustração)', startS: 3, endS: 4, note: 'Reposição visual do realce; duração não calibrada.' },
    ] },
  };
}

/** Independent adapter for the human-anatomy domain; it never accepts industrial assembly contracts. */
export class AnatomyDomainAdapter {
  validateObservation(input: unknown): AnatomyObservationV1 { return validateBoundAnatomyObservation(input); }
  validateReview(input: unknown, observation: AnatomyObservationV1): AnatomyReviewV1 { return validateAnatomyReview(input, observation); }
  adapt(observation: AnatomyObservationV1, review: unknown): AnatomySceneProposal { return buildAnatomySceneProposal(observation, review); }
}

export const anatomyDomainAdapter = new AnatomyDomainAdapter();
