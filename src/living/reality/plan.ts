import { validateSpatialPlanV2, type SpatialPlanV2 } from '../../universal-spatial/contracts-v2';
import type { RealityModel } from './model';
import { analyseStructure } from './structure';
import { FRAME_HALF_PER_DIAGONAL } from './model';

/**
 * The editable structure of a reconstruction: one component per part, with a stable id, its centroid as the component position and a box of the part's
 * extent as the editable proxy (what the plan compiler draws if the shell is unavailable). The shell itself is the reconstruction's geometry and is
 * drawn by RealityGeometry inside the same component group, so selecting, moving, isolating, explaining, undo/redo and saving use the ordinary Spatial Core.
 *
 * Provenance is stated without promotion: geometry and placement are 'inferred' (silhouette evidence, not confirmed; the finer APPROXIMATED/INFERRED
 * reading of the evidence ledger comes from the reconstruction itself), material is 'unknown' (appearance is a colour sampled from the views).
 */
export const DISPLAY_DIAGONAL = 2;
/** World units of the reconstruction -> units on stage (the object's bounding-box diagonal becomes DISPLAY_DIAGONAL). */
export const displayScale = (model: Pick<RealityModel, 'frame'>): number => DISPLAY_DIAGONAL / (model.frame.half / FRAME_HALF_PER_DIAGONAL);

export function planFromModel(model: RealityModel, sha256: string, title: string): SpatialPlanV2 {
  const k = displayScale(model), views = model.evidence.views.length, structure = analyseStructure(model);
  const evidence = `Casco visual de ${views} vistas (silhuetas); forma observada só nos contornos, profundidade e concavidades são hipótese.`.slice(0, 480);
  const T = (position: [number, number, number]) => ({ position, rotationRad: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] });
  return validateSpatialPlanV2({
    contract: 'unfold.spatial-plan.v2', source: { kind: 'image', sha256 }, title: title.slice(0, 100), units: 'unitless', presentationProfile: 'neutral',
    components: model.parts.map((p, i) => ({
      id: p.id, label: `Parte ${i + 1} (hipótese de estrutura)`, parentId: null,
      geometry: { type: 'shape' as const, key: `${p.id}-shell`, operator: 'box' as const, parameters: { dimensions: p.size.map((v) => Math.max(0.02, v * k)) }, transform: T([0, 0, 0]), repeat: null, material: { profile: 'neutral' as const, color: '#8793a3', roughness: 0.55, metalness: 0, clearcoat: 0 } },
      transform: T(p.origin.map((v) => v * k) as [number, number, number]),
      provenance: { geometry: 'inferred' as const, transform: 'inferred' as const, material: 'unknown' as const, evidence },
    })),
    // Relations are MEASURED on the reconstruction (contact surface, mirror overlap, axis angle) and stated as inferred; none is a constraint the solver enforces.
    relations: [
      ...structure.contacts.map((c, i) => ({ id: `contact-${i + 1}`, fromId: c.a, toId: c.b, kind: 'adjacent_to' as const, origin: 'inferred' as const, evidence: `Contacto no casco visual: ${(c.areaFraction * 100).toFixed(0)}% da superfície da parte menor; a ligação mecânica não é observada.` })),
      ...structure.symmetries.map((x, i) => ({ id: `mirror-${i + 1}`, fromId: x.a, toId: x.b, kind: 'aligned_with' as const, origin: 'inferred' as const, evidence: `Imagem de espelho em ${x.axis} (sobreposição ${(x.iou * 100).toFixed(0)}%); medido no casco, não imposto.` })),
      ...structure.alignments.map((x, i) => ({ id: `parallel-${i + 1}`, fromId: x.a, toId: x.b, kind: 'aligned_with' as const, origin: 'inferred' as const, evidence: `Eixos principais paralelos (${x.angleDeg}°, alongamentos ${x.elongationA}/${x.elongationB}); medido no casco, não imposto.` })),
    ],
    constraints: [],
    unknowns: [
      'Interior, cavidades e concavidades que nenhuma silhueta mostra (o casco visual preenche-as).',
      'Regiões sem nenhuma vista (cor neutra azulada): forma e aparência são hipótese.',
      'Escala absoluta e unidades: não medidas.',
      ...structure.visibility.filter((v) => v.status !== 'observed').map((v) => `${v.partId}: vista por ${v.observedViews} vista(s) (menos de 2): forma e posição em grande parte hipótese.`),
      ...model.evidence.assumptions.slice(0, 6),
    ].map((u) => u.slice(0, 300)),
  });
}
