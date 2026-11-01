import { isOrigin, isUnit, isValidation, type Field, type Provenance, type Unit } from '../../core';

/**
 * UNFOLD Electrical — modelo de circuito v1.
 *
 * Convenções (iguais às do SPICE):
 *  - voltage_source: V(p) - V(n) = valor.
 *  - current_source: o valor é a corrente que entra no terminal p vinda de fora, ou seja,
 *    a fonte empurra corrente do terminal n, através de si própria, para o terminal p.
 *    (No SPICE, `I1 A B 1m` corresponde a terminals { p: B, n: A }.)
 *  - Correntes de componente são sempre medidas de p para n através do componente (convenção passiva).
 */

export const CIRCUIT_SCHEMA = 'unfold.electrical.circuit.v1' as const;

export const COMPONENT_KINDS = ['resistor', 'voltage_source', 'current_source'] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

export const VALUE_UNIT: Record<ComponentKind, Unit> = { resistor: 'ohm', voltage_source: 'V', current_source: 'A' };
export const VALUE_FIELD: Record<ComponentKind, string> = { resistor: 'resistance', voltage_source: 'voltage', current_source: 'current' };

export type Net = { id: string; label: string; isGround: boolean; provenance: Provenance };

export type ElectricalComponent = {
  id: string;
  kind: ComponentKind;
  label: string;
  terminals: { p: string; n: string };
  value: Field<number>;
  provenance: Provenance;
};

export type CircuitRevision = { id: string; number: number; parentId: string | null };

export type CircuitV1 = {
  schema: typeof CIRCUIT_SCHEMA;
  id: string;
  title: string;
  revision: CircuitRevision;
  nets: Net[];
  components: ElectricalComponent[];
};

export type CircuitIssue = { code: string; path: string; message: string; subject: string[] };

const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function validProvenance(value: unknown): value is Provenance {
  return isObject(value) && isOrigin(value.origin) && isValidation(value.validation) && typeof value.recordedAt === 'string' && Number.isFinite(Date.parse(value.recordedAt));
}

/** Validação estrutural e topológica. Não resolve o circuito; só diz se faz sentido resolvê-lo. */
export function validateCircuit(value: unknown): CircuitIssue[] {
  const issues: CircuitIssue[] = [];
  const push = (code: string, path: string, message: string, subject: string[] = []) => issues.push({ code, path, message, subject });

  if (!isObject(value) || value.schema !== CIRCUIT_SCHEMA) return [{ code: 'SCHEMA_INVALID', path: 'schema', message: `Esperado ${CIRCUIT_SCHEMA}.`, subject: [] }];
  if (typeof value.id !== 'string' || !ID.test(value.id)) push('ID_INVALID', 'id', 'Identificador do circuito inválido.');
  if (!isObject(value.revision) || typeof value.revision.id !== 'string' || !Number.isSafeInteger(value.revision.number)) push('REVISION_INVALID', 'revision', 'Revisão inválida.');
  if (!Array.isArray(value.nets) || !Array.isArray(value.components)) return [...issues, { code: 'SHAPE_INVALID', path: '', message: 'nets e components têm de ser listas.', subject: [] }];

  const nets = value.nets as unknown[];
  const components = value.components as unknown[];
  const netIds = new Set<string>();
  const allIds = new Set<string>();

  nets.forEach((net, index) => {
    if (!isObject(net) || typeof net.id !== 'string' || !ID.test(net.id) || typeof net.label !== 'string' || typeof net.isGround !== 'boolean' || !validProvenance(net.provenance)) {
      push('NET_INVALID', `nets[${index}]`, 'Nó inválido.');
      return;
    }
    if (allIds.has(net.id)) push('DUPLICATE_ID', `nets[${index}].id`, `Identificador duplicado: ${net.id}.`, [net.id]);
    allIds.add(net.id);
    netIds.add(net.id);
  });

  const grounds = nets.filter((net) => isObject(net) && net.isGround === true);
  if (grounds.length !== 1) push('GROUND_COUNT', 'nets', `O circuito precisa de exactamente uma referência (massa); tem ${grounds.length}.`);

  const valid: ElectricalComponent[] = [];
  components.forEach((item, index) => {
    const path = `components[${index}]`;
    if (!isObject(item) || typeof item.id !== 'string' || !ID.test(item.id) || typeof item.label !== 'string' || !(COMPONENT_KINDS as readonly string[]).includes(String(item.kind)) || !isObject(item.terminals) || !isObject(item.value) || !validProvenance(item.provenance) || !validProvenance(item.value.provenance)) {
      push('COMPONENT_INVALID', path, 'Componente inválido.');
      return;
    }
    const component = item as unknown as ElectricalComponent;
    if (allIds.has(component.id)) push('DUPLICATE_ID', `${path}.id`, `Identificador duplicado: ${component.id}.`, [component.id]);
    allIds.add(component.id);
    const { p, n } = component.terminals;
    if (!netIds.has(p) || !netIds.has(n)) push('TERMINAL_UNKNOWN_NET', `${path}.terminals`, `${component.id} liga a um nó inexistente.`, [component.id]);
    if (p === n) push('TERMINAL_SHORTED', `${path}.terminals`, `${component.id} tem os dois terminais no mesmo nó.`, [component.id]);
    const v = component.value.value;
    if (v !== null && (typeof v !== 'number' || !Number.isFinite(v))) push('VALUE_INVALID', `${path}.value`, `Valor de ${component.id} não é um número finito.`, [component.id]);
    if (component.value.unit === undefined || !isUnit(component.value.unit) || component.value.unit !== VALUE_UNIT[component.kind]) push('UNIT_INVALID', `${path}.value.unit`, `${component.id} tem de estar em ${VALUE_UNIT[component.kind]}.`, [component.id]);
    if (component.kind === 'resistor' && typeof v === 'number' && v <= 0) push('RESISTANCE_NOT_POSITIVE', `${path}.value`, `A resistência de ${component.id} tem de ser positiva.`, [component.id]);
    valid.push(component);
  });

  // Todos os nós têm de estar ligados à massa por algum caminho de componentes; caso contrário a tensão é indeterminada.
  const ground = grounds[0];
  if (grounds.length === 1 && isObject(ground) && typeof ground.id === 'string') {
    const adjacency = new Map<string, string[]>();
    for (const component of valid) {
      const { p, n } = component.terminals;
      adjacency.set(p, [...(adjacency.get(p) ?? []), n]);
      adjacency.set(n, [...(adjacency.get(n) ?? []), p]);
    }
    const reached = new Set<string>([ground.id]);
    const queue = [ground.id];
    while (queue.length) for (const next of adjacency.get(queue.shift()!) ?? []) if (!reached.has(next)) { reached.add(next); queue.push(next); }
    for (const id of netIds) if (!reached.has(id)) push('FLOATING_NET', 'nets', `O nó ${id} não tem ligação à massa; a sua tensão é indeterminada.`, [id]);
  }
  return issues;
}

export function groundOf(circuit: CircuitV1): Net {
  const ground = circuit.nets.find((net) => net.isGround);
  if (!ground) throw new Error('GROUND_MISSING');
  return ground;
}
