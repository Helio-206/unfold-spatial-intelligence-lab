/**
 * Supported experiments. Deterministic and local: the assistant may suggest one, but what can run is decided here.
 * The engine is not connected, so the best available result is a labelled fixture preview, or nothing.
 */
import type { ComponentRegistry } from '../visual-foundry/component-registry';
import { engineSource, type FixturePreview } from '../visual-foundry/poses';

const lc = (label: string) => label.charAt(0).toLocaleLowerCase('pt') + label.slice(1);

export type ExperimentPlan =
  | { kind: 'preview_fixture'; actuatorId: string; title: string; detail: string; preview: FixturePreview }
  | { kind: 'unavailable'; actuatorId: string | null; title: string; detail: string };

export function planExtendExperiment(componentId: string | null, registry: ComponentRegistry, previews: FixturePreview[]): ExperimentPlan {
  const c = componentId ? registry.get(componentId) : undefined;
  const cyl = c?.role === 'hydraulic_cylinder' ? c : c ? registry.ownerOfPart(c.id) : undefined;
  if (!cyl || cyl.role !== 'hydraulic_cylinder') return { kind: 'unavailable', actuatorId: null, title: 'Sem experiência', detail: 'Seleccione um cilindro hidráulico.' };
  const engine = engineSource();
  const preview = previews.find((p) => p.actuatorId === cyl.id);
  if (!preview) return { kind: 'unavailable', actuatorId: cyl.id, title: `Estender o ${lc(cyl.label)}`, detail: `${engine.reason} Também não há pré-visualização de fixture para este cilindro, por isso não há nada para mostrar.` };
  const ds = preview.strokeToM - preview.strokeFromM;
  return {
    kind: 'preview_fixture', actuatorId: cyl.id, title: `Estender o ${lc(cyl.label)} +${ds.toFixed(2)} m`,
    detail: `${engine.reason} Pré-visualização de fixture (FK independente, não verificada): curso ${preview.strokeFromM.toFixed(3)} → ${preview.strokeToM.toFixed(3)} m. Não altera dados confirmados.`,
    preview,
  };
}
