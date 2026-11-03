/**
 * Reconstruction fixture for the premium experience prototype: what a reconstruction of the side-elevation drawing
 * could return, in the existing `unfold.excavator_observation.v1` contract (src/living/reconstruction/contracts.ts).
 *
 * FIXTURE. No model was called. The drawing it refers to is rendered from the canonical synthetic excavator, so the
 * regions line up with canonical parts by construction; that is what makes the transition to the lab exact, and it is
 * stated in the interface. Statuses are chosen to exercise the three categories honestly:
 *  - observed: drawn and legible on the sheet;
 *  - hypothesis: drawn as a symbol but not labelled (the cylinders), or inferred from shape;
 *  - unknown: not legible on the sheet (the bucket linkage) or not drawable at all (counterweight mass).
 */
import { RECONSTRUCTION_OBSERVATION_SCHEMA, validateExcavatorObservation, type ExcavatorObservationV1, type ObservationStatus } from '../reconstruction/contracts';

export const DRAWING_REFERENCE = 'fixture:excavator-side-elevation.v1' as const;

/** Which canonical parts each observed entity covers. The renderer uses these ids, never screen positions. */
export const ENTITY_PARTS: Readonly<Record<string, readonly string[]>> = {
  e_chassis: ['chassis'],
  e_house: ['upper_body'],
  e_counterweight: ['upper_body'],
  e_boom: ['boom'],
  e_stick: ['stick'],
  e_bucket: ['bucket'],
  e_boom_cyl: ['boom_cyl_barrel', 'boom_cyl_rod'],
  e_stick_cyl: ['stick_cyl_barrel', 'stick_cyl_rod'],
  e_bucket_cyl: ['bucket_cyl_barrel', 'bucket_cyl_rod'],
  e_linkage: ['idler_link', 'bucket_link'],
};

const ev = (id: string, detail: string, kind: 'drawing_annotation' | 'image_region' = 'drawing_annotation') => [{ id, kind, detail, locator: DRAWING_REFERENCE }];
const entity = (id: string, kind: ExcavatorObservationV1['entities'][number]['kind'], label: string, status: ObservationStatus, confidence: number, evidence: ReturnType<typeof ev>, features: ExcavatorObservationV1['entities'][number]['features'] = []) =>
  ({ id, kind, label, status, confidence, evidence, features });

export function reconstructionFixture(): ExcavatorObservationV1 {
  const raw: ExcavatorObservationV1 = {
    schema: RECONSTRUCTION_OBSERVATION_SCHEMA,
    source: { kind: 'technical_drawing', reference: DRAWING_REFERENCE },
    machineType: 'excavator',
    entities: [
      entity('e_chassis', 'track', 'Material circulante (rastos)', 'observed', 0.93, ev('ev-chassis', 'Contorno do rasto, roda motriz e roda guia desenhados e legíveis.')),
      entity('e_house', 'house', 'Corpo superior e cabina', 'observed', 0.9, ev('ev-house', 'Contorno da cabina e do capô legíveis.')),
      entity('e_counterweight', 'counterweight', 'Contrapeso', 'unknown', 0.2, ev('ev-cw', 'Contorno visível, mas a massa não está no desenho.'), [{ name: 'massa', value: null, status: 'unknown', evidence: ev('ev-cw-mass', 'Sem cota nem nota de massa.') }]),
      entity('e_boom', 'boom', 'Lança', 'observed', 0.91, ev('ev-boom', 'Lança desenhada, com cota entre pinos.'), [{ name: 'comprimento entre pinos', value: '5400 mm', status: 'observed', evidence: ev('ev-boom-dim', 'Cota «5 400» entre o pino da base e o pino do braço.') }]),
      entity('e_stick', 'stick', 'Braço', 'observed', 0.88, ev('ev-stick', 'Braço desenhado, cota entre pinos legível.'), [{ name: 'comprimento entre pinos', value: '2850 mm', status: 'observed', evidence: ev('ev-stick-dim', 'Cota «2 850».') }]),
      entity('e_bucket', 'bucket', 'Caçamba', 'observed', 0.84, ev('ev-bucket', 'Perfil da caçamba e dentes desenhados.')),
      entity('e_boom_cyl', 'cylinder', 'Cilindro da lança', 'hypothesis', 0.72, ev('ev-boom-cyl', 'Símbolo de cilindro entre o corpo superior e a lança, sem legenda.')),
      entity('e_stick_cyl', 'cylinder', 'Cilindro do braço', 'hypothesis', 0.7, ev('ev-stick-cyl', 'Símbolo de cilindro sobre a lança, sem legenda.')),
      entity('e_bucket_cyl', 'cylinder', 'Cilindro da caçamba', 'hypothesis', 0.61, ev('ev-bucket-cyl', 'Forma alongada sob o braço; pode ser cilindro ou tubagem.')),
      entity('e_linkage', 'joint', 'Ligação da caçamba', 'unknown', 0.18, ev('ev-link', 'Zona do balancé sobreposta; as barras não são legíveis.')),
    ],
    relations: [
      { id: 'r_boom_house', relation: 'pivot', from: 'e_boom', to: 'e_house', status: 'observed', confidence: 0.86, evidence: ev('ev-r1', 'Pino da base da lança desenhado.') },
      { id: 'r_boom_cyl', relation: 'actuated_by', from: 'e_boom', to: 'e_boom_cyl', status: 'hypothesis', confidence: 0.66, evidence: ev('ev-r2', 'Inferido da posição do símbolo.') },
    ],
    dimensions: [
      { id: 'd_boom', partId: 'e_boom', label: 'Lança, pino a pino', value: 5400, unit: 'mm', status: 'observed', evidence: ev('ev-d1', 'Cota «5 400».') },
      { id: 'd_stick', partId: 'e_stick', label: 'Braço, pino a pino', value: 2850, unit: 'mm', status: 'observed', evidence: ev('ev-d2', 'Cota «2 850».') },
      { id: 'd_cw_mass', partId: 'e_counterweight', label: 'Massa do contrapeso', value: null, unit: 'unknown', status: 'unknown', evidence: ev('ev-d3', 'Não consta.') },
    ],
    requests: [],
    unknowns: ['Massa do contrapeso.', 'Geometria das barras da ligação da caçamba.', 'Diâmetros e pressões hidráulicas.'],
    hypotheses: [
      { id: 'h_cyl_symbols', statement: 'Os três símbolos alongados são cilindros hidráulicos.', confidence: 0.66, evidence: ev('ev-h1', 'Forma e posição típicas; sem legenda.') },
    ],
  };
  return validateExcavatorObservation(raw);
}

/**
 * FIXTURE (demo scenario «dados insuficientes»): an excavator is recognised but only the bucket is legible; the
 * structure that a valid assembly needs (tracks, house, boom, stick) is unknown.
 */
export function insufficientObservation(): ExcavatorObservationV1 {
  return validateExcavatorObservation({
    schema: RECONSTRUCTION_OBSERVATION_SCHEMA,
    source: { kind: 'image', reference: 'fixture:partial-photo.v1' },
    machineType: 'excavator',
    entities: [
      entity('e_bucket', 'bucket', 'Caçamba', 'observed', 0.81, ev('ev-p-bucket', 'Caçamba em primeiro plano, bem iluminada.', 'image_region')),
      entity('e_stick', 'stick', 'Braço', 'hypothesis', 0.44, ev('ev-p-stick', 'Parte de um braço visível no canto; corta no limite da imagem.', 'image_region')),
      entity('e_house', 'house', 'Corpo superior e cabina', 'unknown', 0.1, ev('ev-p-house', 'Fora do enquadramento.', 'image_region')),
      entity('e_chassis', 'track', 'Material circulante (rastos)', 'unknown', 0.1, ev('ev-p-chassis', 'Fora do enquadramento.', 'image_region')),
    ],
    relations: [], dimensions: [], requests: [],
    unknowns: ['A fotografia mostra só a caçamba e parte do braço.', 'Sem referência de escala.'],
    hypotheses: [],
  });
}

/** FIXTURE (demo scenario «máquina não identificada»): the source does not show a recognisable excavator. */
export function notIdentifiedObservation(): ExcavatorObservationV1 {
  return validateExcavatorObservation({
    schema: RECONSTRUCTION_OBSERVATION_SCHEMA,
    source: { kind: 'image', reference: 'fixture:unrecognised.v1' },
    machineType: 'unknown',
    entities: [], relations: [], dimensions: [], requests: [],
    unknowns: ['Não foi reconhecida uma escavadora: a imagem parece mostrar uma grua ou um equipamento diferente.'],
    hypotheses: [],
  });
}
