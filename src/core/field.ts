import type { Provenance } from './provenance';

/** Unidades conhecidas pelo Core. Cada domínio usa as que precisa; a dimensão evita misturas. */
export const UNITS = {
  m: 'length',
  mm: 'length',
  m2: 'area',
  rad: 'angle',
  ohm: 'resistance',
  V: 'voltage',
  A: 'current',
  W: 'power',
  VA: 'apparent_power',
  angstrom: 'length',
  none: 'dimensionless',
} as const;
export type Unit = keyof typeof UNITS;
export type Dimension = (typeof UNITS)[Unit];

export function isUnit(value: unknown): value is Unit {
  return typeof value === 'string' && Object.hasOwn(UNITS, value);
}

export function dimensionOf(unit: Unit): Dimension {
  return UNITS[unit];
}

/** Um valor com proveniência. `value: null` significa desconhecido, nunca zero. */
export type Field<T = unknown> = {
  value: T | null;
  unit?: Unit;
  provenance: Provenance;
};

export function isKnown<T>(field: Field<T> | undefined): field is Field<T> & { value: T } {
  return field !== undefined && field.value !== null;
}
