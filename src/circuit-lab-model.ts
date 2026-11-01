import { categoryOf, type InformationCategory } from './core';
import { parseSpiceNetlist, parseSpiceValue, solveDc, type CircuitV1, type DcResult, type ValueChangePreview } from './domains/electrical';

/**
 * Pure logic behind the circuit screen. Everything shown on screen is read from here:
 * the netlist, the solver result and the preview. Nothing is typed into the design by hand.
 */

export const EXAMPLE_NETLIST = ['Divisor resistivo (exemplo)', 'V1 in 0 12', 'R1 in mid 330', 'R2 mid 0 470', 'R3 mid 0 470', ''].join('\n');
export const EXAMPLE_SOURCE_ID = 'exemplo:divisor-resistivo';

export type ExampleVariant = 'complete' | 'missing-r3';

/** The bundled example is a fixture, not something extracted from a user file, so it is labelled as an example. */
export function exampleCircuit(variant: ExampleVariant = 'complete', clock: () => Date = () => new Date()): CircuitV1 {
  const { circuit } = parseSpiceNetlist(EXAMPLE_NETLIST, { circuitId: 'divisor', sourceId: EXAMPLE_SOURCE_ID, clock });
  const next = structuredClone(circuit);
  const recordedAt = clock().toISOString();
  const fixture = { origin: 'fixture' as const, validation: 'unreviewed' as const, recordedAt };
  for (const net of next.nets) net.provenance = { ...fixture };
  for (const component of next.components) {
    component.provenance = { ...fixture };
    component.value = { ...component.value, provenance: { ...fixture } };
  }
  if (variant === 'missing-r3') {
    const r3 = next.components.find((component) => component.id === 'r3')!;
    r3.value = { value: null, unit: 'ohm', provenance: { origin: 'unknown', validation: 'unreviewed', recordedAt } };
  }
  return next;
}

export type ParsedCommand = { ok: true; componentId: string; value: number } | { ok: false; reason: string };

/** "Altera R2 para 220 Ω" — a deterministic reading of one sentence shape. No model involved. */
export function parseCommand(text: string): ParsedCommand {
  const match = /^\s*(?:altera|muda|define|set)\s+([a-z]\w*)\s+(?:para|=|to)\s+([-+]?[0-9.,]+\s*(?:meg|[kmgu])?)\s*(?:ω|ohms?)?\s*\.?\s*$/i.exec(text);
  if (!match) return { ok: false, reason: 'Não percebi. Experimente: "Altera R2 para 220 Ω".' };
  const value = parseSpiceValue(match[2]!.replace(/\s+/g, '').replace(',', '.'));
  if (value === null) return { ok: false, reason: 'Não consegui ler o valor.' };
  return { ok: true, componentId: match[1]!.toLowerCase(), value };
}

/** Dash velocity (px/s) for the current in a branch. 0 stays 0; 8 mA is 14 px/s, 25 mA is 42 px/s; linear in between, clamped. */
export function flowSpeed(currentA: number): number {
  const mA = Math.abs(currentA) * 1000;
  if (mA === 0) return 0;
  const k = Math.min(1, Math.max(0, (mA - 8) / (25 - 8)));
  return 14 + k * 28;
}

export type BranchId = 'r1' | 'r2' | 'r3';
export type Readout =
  | { status: 'solved'; currentMa: Record<BranchId, number>; voltageV: Record<BranchId, number>; totalMa: number; category: InformationCategory }
  | { status: 'unknown'; why: string; missing: string[] };

const BRANCHES: BranchId[] = ['r1', 'r2', 'r3'];

/** Everything the screen prints about a solver result, rounded to the precision it displays (0.1 mA, 0.01 V). */
export function readout(result: DcResult): Readout {
  if (result.status === 'missing') return { status: 'unknown', why: `falta o valor de ${result.missing.map((ref) => ref.entityId.toUpperCase()).join(', ')}`, missing: result.missing.map((ref) => ref.entityId) };
  if (result.status !== 'solved') return { status: 'unknown', why: result.status === 'invalid' ? result.issues[0]?.message ?? 'circuito inválido' : result.reason, missing: [] };
  const currentMa = {} as Record<BranchId, number>;
  const voltageV = {} as Record<BranchId, number>;
  for (const id of BRANCHES) {
    currentMa[id] = round(result.componentCurrents[id]!.value! * 1000, 1);
    voltageV[id] = round(Math.abs(result.componentPower[id]!.value! / result.componentCurrents[id]!.value!), 2);
  }
  return { status: 'solved', currentMa, voltageV, totalMa: currentMa.r1, category: categoryOf(result.componentCurrents.r1!.provenance) };
}

export const round = (value: number, decimals: number): number => Number(value.toFixed(decimals));

export type PreviewView =
  | { status: 'ready'; componentId: string; from: number; to: number; before: Readout; after: Readout }
  | { status: 'blocked'; componentId: string; reason: string };

export function previewView(preview: ValueChangePreview, componentId: string): PreviewView {
  if (preview.status === 'blocked' || !preview.after) return { status: 'blocked', componentId, reason: preview.issues[0]?.message ?? 'Alteração bloqueada.' };
  const change = preview.operation.changes[0]!;
  return { status: 'ready', componentId, from: Number(change.from), to: Number(change.to), before: readout(preview.before), after: readout(preview.after) };
}

export const formatOhm = (ohm: number): string => (ohm >= 1000 ? `${trim(ohm / 1000)} kΩ` : `${trim(ohm)} Ω`);
const trim = (value: number): string => String(Number(value.toFixed(3)));

export const solve = (circuit: CircuitV1, clock?: () => Date): DcResult => solveDc(circuit, clock ? { clock } : {});
