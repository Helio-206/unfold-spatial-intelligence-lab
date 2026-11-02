import type { AssemblyPart, AssemblyDimension, AssemblyValueSource } from './contracts';

/**
 * Template frame used only inside the proposal layer: +X forward, +Y to the
 * operator's left, +Z up. The engineering adapter converts it to the
 * canonical +X forward, +Y up, +Z operator-right frame.
 */
export const RECONSTRUCTION_SOURCE_FRAME = 'reconstruction.template.x-forward-y-left-z-up' as const;

export type ExcavatorTemplate = {
  role: AssemblyPart['role'];
  libraryKey: string;
  parentRole: AssemblyPart['role'] | null;
  transform: AssemblyPart['transform'];
  dimensions: Record<string, { value: number | null; unit: AssemblyDimension['unit']; requiredForVerification: boolean }>;
};

const hypothetical = (value: number, unit: AssemblyDimension['unit'] = 'm', requiredForVerification = true) => ({ value, unit, requiredForVerification });
const unknown = (unit: AssemblyDimension['unit'] = 'm', requiredForVerification = true) => ({ value: null, unit, requiredForVerification });

export const EXCAVATOR_TEMPLATE_LIBRARY: readonly ExcavatorTemplate[] = [
  { role: 'chassis', libraryKey: 'excavator.chassis.basic', parentRole: null, transform: { translation: [0, 0, 0], rotationEulerDeg: [0, 0, 0], scale: [1, 1, 1] }, dimensions: { length: hypothetical(3.2), width: hypothetical(2.4), height: hypothetical(0.8) } },
  { role: 'house', libraryKey: 'excavator.house.swing', parentRole: 'chassis', transform: { translation: [0, 0, 0.8], rotationEulerDeg: [0, 0, 0], scale: [1, 1, 1] }, dimensions: { length: hypothetical(2.4), width: hypothetical(2.2), height: hypothetical(1.9) } },
  { role: 'boom', libraryKey: 'excavator.boom.single', parentRole: 'house', transform: { translation: [0, 0, 2.1], rotationEulerDeg: [0, 0, 8], scale: [1, 1, 1] }, dimensions: { length: hypothetical(4.0) } },
  { role: 'stick', libraryKey: 'excavator.stick.single', parentRole: 'boom', transform: { translation: [4.0, 0, 2.7], rotationEulerDeg: [0, 0, -22], scale: [1, 1, 1] }, dimensions: { length: hypothetical(2.8) } },
  { role: 'bucket', libraryKey: 'excavator.bucket.general', parentRole: 'stick', transform: { translation: [6.8, 0, 1.65], rotationEulerDeg: [0, 0, -28], scale: [1, 1, 1] }, dimensions: { width: hypothetical(1.0), depth: unknown() } },
  { role: 'track', libraryKey: 'excavator.track.left', parentRole: 'chassis', transform: { translation: [0, 1.15, 0.1], rotationEulerDeg: [0, 0, 0], scale: [1, 1, 1] }, dimensions: { length: hypothetical(3.2), width: hypothetical(0.45) } },
  { role: 'track', libraryKey: 'excavator.track.right', parentRole: 'chassis', transform: { translation: [0, -1.15, 0.1], rotationEulerDeg: [0, 0, 0], scale: [1, 1, 1] }, dimensions: { length: hypothetical(3.2), width: hypothetical(0.45) } },
  { role: 'cylinder', libraryKey: 'excavator.hydraulic.boom.body', parentRole: 'house', transform: { translation: [1.1, 0, 1.8], rotationEulerDeg: [0, 55, 0], scale: [1, 1, 1] }, dimensions: { stroke: hypothetical(1.5), bore: unknown('mm') } },
  { role: 'cylinder', libraryKey: 'excavator.hydraulic.boom.rod', parentRole: 'boom', transform: { translation: [2.0, 0, 2.1], rotationEulerDeg: [0, 55, 0], scale: [1, 1, 1] }, dimensions: { stroke: unknown() } },
  { role: 'cylinder', libraryKey: 'excavator.hydraulic.stick.body', parentRole: 'boom', transform: { translation: [3.0, 0, 2.5], rotationEulerDeg: [0, 36, 0], scale: [1, 1, 1] }, dimensions: { stroke: hypothetical(1.4), bore: unknown('mm') } },
  { role: 'cylinder', libraryKey: 'excavator.hydraulic.stick.rod', parentRole: 'stick', transform: { translation: [4.0, 0, 2.55], rotationEulerDeg: [0, 36, 0], scale: [1, 1, 1] }, dimensions: { stroke: unknown() } },
  { role: 'cylinder', libraryKey: 'excavator.hydraulic.bucket.body', parentRole: 'stick', transform: { translation: [5.3, 0, 2.0], rotationEulerDeg: [0, 28, 0], scale: [1, 1, 1] }, dimensions: { stroke: hypothetical(1.0), bore: unknown('mm') } },
  { role: 'cylinder', libraryKey: 'excavator.hydraulic.bucket.rod', parentRole: 'bucket', transform: { translation: [6.0, 0, 1.8], rotationEulerDeg: [0, 28, 0], scale: [1, 1, 1] }, dimensions: { stroke: unknown() } },
];

export function templateFor(role: AssemblyPart['role'], libraryKey: string): ExcavatorTemplate | undefined {
  return EXCAVATOR_TEMPLATE_LIBRARY.find((template) => template.role === role && template.libraryKey === libraryKey);
}

export function templateSourceDimension(template: ExcavatorTemplate, name: string): AssemblyDimension | undefined {
  const specification = template.dimensions[name];
  if (!specification) return undefined;
  const source: AssemblyValueSource = specification.value === null ? 'unknown' : 'template';
  return { ...specification, source, evidenceIds: specification.value === null ? [] : [`template-${template.libraryKey}-${name}`] };
}
