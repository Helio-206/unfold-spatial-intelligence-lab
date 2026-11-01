import type { Check, Field, FieldRef, Provenance, VerificationReport } from '../../core';
import { groundOf, validateCircuit, VALUE_FIELD, type CircuitIssue, type CircuitV1 } from './model';

/**
 * Ponto de funcionamento DC por análise nodal modificada (MNA).
 * O solver não assume valores: se faltar algum, recusa e diz quais faltam.
 * Os resultados entram como `origin: 'solver'`, com `derivedFrom` a apontar para os valores de entrada.
 */

export const DC_ASSUMPTIONS = [
  'Componentes ideais e lineares.',
  'Regime estacionário em corrente contínua.',
  'Ligações sem resistência.',
  'Valores dos componentes tal como indicados, sem tolerâncias de fabrico.',
];

export type DcSolved = {
  status: 'solved';
  circuitId: string;
  revisionId: string;
  nodeVoltages: Record<string, Field<number>>; // V, em relação à massa
  componentCurrents: Record<string, Field<number>>; // A, de p para n através do componente
  componentPower: Record<string, Field<number>>; // W absorvidos (negativo = fornecidos)
  report: VerificationReport;
};
export type DcResult =
  | DcSolved
  | { status: 'invalid'; issues: CircuitIssue[] }
  | { status: 'missing'; missing: FieldRef[] }
  | { status: 'singular'; reason: string };

export type SolveOptions = { clock?: () => Date };

const SOLVER_ID = 'unfold.electrical.mna-dc.v1';

export function solveDc(circuit: CircuitV1, options: SolveOptions = {}): DcResult {
  const issues = validateCircuit(circuit);
  if (issues.length) return { status: 'invalid', issues };

  const missing: FieldRef[] = circuit.components
    .filter((component) => component.value.value === null)
    .map((component) => ({ entityId: component.id, field: VALUE_FIELD[component.kind] }));
  if (missing.length) return { status: 'missing', missing };

  const ground = groundOf(circuit);
  const nodes = circuit.nets.filter((net) => !net.isGround).map((net) => net.id);
  const nodeIndex = new Map(nodes.map((id, index) => [id, index]));
  const sources = circuit.components.filter((component) => component.kind === 'voltage_source');
  const size = nodes.length + sources.length;
  const A = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const z = new Array<number>(size).fill(0);
  const idx = (net: string) => (net === ground.id ? -1 : nodeIndex.get(net)!);

  for (const component of circuit.components) {
    const value = component.value.value!;
    const p = idx(component.terminals.p);
    const n = idx(component.terminals.n);
    if (component.kind === 'resistor') {
      const g = 1 / value;
      if (p >= 0) A[p][p] += g;
      if (n >= 0) A[n][n] += g;
      if (p >= 0 && n >= 0) { A[p][n] -= g; A[n][p] -= g; }
    } else if (component.kind === 'current_source') {
      if (p >= 0) z[p] += value;
      if (n >= 0) z[n] -= value;
    }
  }
  sources.forEach((source, k) => {
    const row = nodes.length + k;
    const p = idx(source.terminals.p);
    const n = idx(source.terminals.n);
    if (p >= 0) { A[p][row] = 1; A[row][p] = 1; }
    if (n >= 0) { A[n][row] = -1; A[row][n] = -1; }
    z[row] = source.value.value!;
  });

  const x = solveLinear(A, z);
  if (!x) return { status: 'singular', reason: 'O sistema de equações não tem solução única: verifique ciclos de fontes de tensão ou nós alimentados só por fontes de corrente.' };

  const voltage = (net: string) => (net === ground.id ? 0 : x[nodeIndex.get(net)!]);
  const sourceCurrent = new Map(sources.map((source, k) => [source.id, x[nodes.length + k]]));
  const currents = new Map<string, number>();
  for (const component of circuit.components) {
    const v = component.value.value!;
    const vp = voltage(component.terminals.p);
    const vn = voltage(component.terminals.n);
    currents.set(component.id, component.kind === 'resistor' ? (vp - vn) / v : component.kind === 'voltage_source' ? sourceCurrent.get(component.id)! : -v);
  }

  const recordedAt = (options.clock ?? (() => new Date()))().toISOString();
  const inputs: FieldRef[] = circuit.components.map((component) => ({ entityId: component.id, field: VALUE_FIELD[component.kind] }));
  const solverProvenance: Provenance = { origin: 'solver', validation: 'unreviewed', recordedAt, actor: { kind: 'system', id: SOLVER_ID }, derivedFrom: inputs };
  const field = (value: number, unit: 'V' | 'A' | 'W'): Field<number> => ({ value: Object.is(value, -0) ? 0 : value, unit, provenance: solverProvenance });

  const nodeVoltages: Record<string, Field<number>> = {};
  for (const net of circuit.nets) nodeVoltages[net.id] = field(voltage(net.id), 'V');
  const componentCurrents: Record<string, Field<number>> = {};
  const componentPower: Record<string, Field<number>> = {};
  for (const component of circuit.components) {
    const i = currents.get(component.id)!;
    componentCurrents[component.id] = field(i, 'A');
    componentPower[component.id] = field((voltage(component.terminals.p) - voltage(component.terminals.n)) * i, 'W');
  }

  const checks = verifyDc(circuit, voltage, currents);
  return {
    status: 'solved',
    circuitId: circuit.id,
    revisionId: circuit.revision.id,
    nodeVoltages,
    componentCurrents,
    componentPower,
    report: {
      domain: 'electrical',
      subjectId: circuit.id,
      revisionId: circuit.revision.id,
      generatedAt: recordedAt,
      checks,
      assumptions: DC_ASSUMPTIONS,
      inputs: circuit.components.map((component) => ({ entityId: component.id, field: VALUE_FIELD[component.kind], origin: component.value.provenance.origin, validation: component.value.provenance.validation })),
    },
  };
}

/**
 * Verificações independentes da matriz: recalculam as leis de Kirchhoff e o balanço de potência
 * a partir das tensões e correntes obtidas.
 */
export function verifyDc(circuit: CircuitV1, voltage: (net: string) => number, currents: Map<string, number>): Check[] {
  const maxCurrent = Math.max(1e-12, ...[...currents.values()].map(Math.abs));
  const kclTolerance = 1e-9 * maxCurrent + 1e-15;
  const checks: Check[] = [];

  for (const net of circuit.nets) {
    let leaving = 0;
    for (const component of circuit.components) {
      const i = currents.get(component.id)!;
      if (component.terminals.p === net.id) leaving += i;
      if (component.terminals.n === net.id) leaving -= i;
    }
    checks.push({
      id: `electrical.kcl.${net.id}`,
      status: Math.abs(leaving) <= kclTolerance ? 'pass' : 'fail',
      subject: [net.id],
      measured: leaving,
      expected: 0,
      tolerance: kclTolerance,
      unit: 'A',
      reason: `Lei dos nós de Kirchhoff no nó ${net.label}: a soma das correntes que saem deve ser zero.`,
    });
  }

  for (const component of circuit.components.filter((item) => item.kind === 'voltage_source')) {
    const drop = voltage(component.terminals.p) - voltage(component.terminals.n);
    const expected = component.value.value!;
    const tolerance = 1e-9 * (Math.abs(expected) + 1);
    checks.push({
      id: `electrical.source.${component.id}`,
      status: Math.abs(drop - expected) <= tolerance ? 'pass' : 'fail',
      subject: [component.id],
      measured: drop,
      expected,
      tolerance,
      unit: 'V',
      reason: `A tensão aos terminais de ${component.label} deve ser igual ao valor da fonte.`,
    });
  }

  const powers = circuit.components.map((component) => (voltage(component.terminals.p) - voltage(component.terminals.n)) * currents.get(component.id)!);
  const balance = powers.reduce((sum, power) => sum + power, 0);
  const powerTolerance = 1e-9 * Math.max(1e-12, ...powers.map(Math.abs)) + 1e-15;
  checks.push({
    id: 'electrical.power-balance',
    status: Math.abs(balance) <= powerTolerance ? 'pass' : 'fail',
    subject: circuit.components.map((component) => component.id),
    measured: balance,
    expected: 0,
    tolerance: powerTolerance,
    unit: 'W',
    reason: 'A potência fornecida pelas fontes deve ser igual à potência dissipada.',
  });
  return checks;
}

/** Eliminação de Gauss com pivotagem parcial. Devolve null se a matriz for singular. */
export function solveLinear(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  if (n === 0) return [];
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  const scale = Math.max(...matrix.flat().map(Math.abs), 1e-300);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) <= 1e-12 * scale) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let row = col + 1; row < n; row++) {
      const factor = a[row][col] / a[col][col];
      if (factor === 0) continue;
      for (let k = col; k <= n; k++) a[row][k] -= factor * a[col][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = a[row][n];
    for (let k = row + 1; k < n; k++) sum -= a[row][k] * x[k];
    x[row] = sum / a[row][row];
  }
  return x.every(Number.isFinite) ? x : null;
}
