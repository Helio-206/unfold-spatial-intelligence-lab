import type { Provenance } from '../../src/core';
import { CIRCUIT_SCHEMA, VALUE_UNIT, type CircuitV1, type ComponentKind } from '../../src/domains/electrical';

export const at = '2026-11-02T10:00:00.000Z';
export const clock = () => new Date(at);
export const observed: Provenance = { origin: 'observed', validation: 'unreviewed', recordedAt: at };
export const confirmed: Provenance = { origin: 'observed', validation: 'verified', recordedAt: at, actor: { kind: 'human', id: 'local-user' }, authorizationId: 'auth-old' };

export type Part = { id: string; kind: ComponentKind; p: string; n: string; value: number | null; provenance?: Provenance };

/** Construtor de circuitos de teste. `gnd` é a massa; os outros nós vêm dos terminais usados. */
export function circuit(parts: Part[], options: { grounds?: string[]; extraNets?: string[]; id?: string; revision?: number } = {}): CircuitV1 {
  const grounds = options.grounds ?? ['gnd'];
  const names = new Set<string>([...grounds, ...(options.extraNets ?? [])]);
  for (const part of parts) { names.add(part.p); names.add(part.n); }
  const id = options.id ?? 'c1';
  const number = options.revision ?? 0;
  return {
    schema: CIRCUIT_SCHEMA,
    id,
    title: 'teste',
    revision: { id: `${id}:r${number}`, number, parentId: number === 0 ? null : `${id}:r${number - 1}` },
    nets: [...names].map((net) => ({ id: net, label: net, isGround: grounds.includes(net), provenance: observed })),
    components: parts.map((part) => ({
      id: part.id, kind: part.kind, label: part.id, terminals: { p: part.p, n: part.n },
      value: { value: part.value, unit: VALUE_UNIT[part.kind], provenance: part.provenance ?? observed },
      provenance: observed,
    })),
  };
}

export const R = (id: string, p: string, n: string, ohms: number | null, provenance?: Provenance): Part => ({ id, kind: 'resistor', p, n, value: ohms, provenance });
export const V = (id: string, p: string, n: string, volts: number | null, provenance?: Provenance): Part => ({ id, kind: 'voltage_source', p, n, value: volts, provenance });
export const I = (id: string, p: string, n: string, amps: number | null, provenance?: Provenance): Part => ({ id, kind: 'current_source', p, n, value: amps, provenance });
