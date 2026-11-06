/** Cenários guardados: estado interactivo suportado, serializável e reaberto sem tocar no plano autoritativo. */
export const LIVING_SCENARIO_SCHEMA = 'unfold.living-scenario.v1' as const;
export type LivingScenario = {
  schema: typeof LIVING_SCENARIO_SCHEMA; assemblyId: string;
  actuatorValues: Record<string, number>;
  experimentId: string | null; experimentInput: Record<string, number>;
  walkthroughStep: number; savedAt: string;
};
export function serializeScenario(s: Omit<LivingScenario, 'schema' | 'savedAt'>, now = new Date()): string {
  return JSON.stringify({ schema: LIVING_SCENARIO_SCHEMA, ...s, savedAt: now.toISOString() });
}
export function parseScenario(raw: string | null, expectedAssemblyId: string): LivingScenario | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as LivingScenario;
    if (v.schema !== LIVING_SCENARIO_SCHEMA || v.assemblyId !== expectedAssemblyId) return null;
    if (typeof v.actuatorValues !== 'object' || v.actuatorValues === null || Object.values(v.actuatorValues).some(x => typeof x !== 'number' || !Number.isFinite(x))) return null;
    return v;
  } catch { return null; }
}
export const scenarioStorageKey = (assemblyId: string) => `unfold.living-scenario.${assemblyId}`;
