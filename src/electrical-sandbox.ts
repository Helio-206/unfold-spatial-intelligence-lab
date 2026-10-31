export type ElectricalNodeKind = 'source' | 'branch' | 'load';
export type ElectricalSandboxV1 = {
  contract: 'electrical_sandbox.v1';
  evidenceStatus: 'user_configured' | 'independent_example';
  source: { id: string; voltageV: number };
  branches: Array<{ id: string; nodeId: string; name: string; enabled: boolean; currentLimitA: number }>;
  loads: Array<{ id: string; nodeId: string; branchId: string; name: string; enabled: boolean; apparentPowerVA: number }>;
  connections: Array<{ id: string; from: string; to: string; closed: boolean }>;
};
export type ElectricalSandboxResult = {
  contract: 'electrical_sandbox.result.v1';
  inputValidity: 'valid';
  evidenceStatus: ElectricalSandboxV1['evidenceStatus'];
  source: { voltageV: number };
  loads: Array<{ id: string; name: string; apparentPowerVA: number; energized: boolean }>;
  branches: Array<{ id: string; name: string; energized: boolean; currentA: number; currentLimitA: number; overloaded: boolean }>;
  limitations: string[];
};

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 100;

export function validateElectricalSandbox(value: unknown): ElectricalSandboxV1 {
  if (!isObject(value) || value.contract !== 'electrical_sandbox.v1' || (value.evidenceStatus !== 'user_configured' && value.evidenceStatus !== 'independent_example') || !isObject(value.source) || !text(value.source.id) || !positive(value.source.voltageV) || !Array.isArray(value.branches) || value.branches.length < 1 || value.branches.length > 32 || !Array.isArray(value.loads) || value.loads.length > 256 || !Array.isArray(value.connections) || value.connections.length > 512) throw new Error('Circuito eléctrico incompleto ou inválido.');
  const branches = value.branches;
  const loads = value.loads;
  const connections = value.connections;
  if (!branches.every((branch) => isObject(branch) && text(branch.id) && text(branch.nodeId) && text(branch.name) && typeof branch.enabled === 'boolean' && positive(branch.currentLimitA))) throw new Error('Ramo eléctrico inválido.');
  if (!loads.every((load) => isObject(load) && text(load.id) && text(load.nodeId) && text(load.branchId) && text(load.name) && typeof load.enabled === 'boolean' && positive(load.apparentPowerVA))) throw new Error('Carga eléctrica inválida.');
  if (!connections.every((connection) => isObject(connection) && text(connection.id) && text(connection.from) && text(connection.to) && typeof connection.closed === 'boolean')) throw new Error('Ligação eléctrica inválida.');
  const branchIds = branches.map((branch) => (branch as { id: string }).id);
  const loadIds = loads.map((load) => (load as { id: string }).id);
  const nodeIds = [value.source.id, ...branches.map((branch) => (branch as { nodeId: string }).nodeId), ...loads.map((load) => (load as { nodeId: string }).nodeId)];
  if (new Set(nodeIds).size !== nodeIds.length) throw new Error('IDs de nós eléctricos duplicados.');
  if (new Set(branchIds).size !== branchIds.length || new Set(loadIds).size !== loadIds.length || new Set([...branchIds, ...loadIds]).size !== branchIds.length + loadIds.length || [...branchIds, ...loadIds].some((id) => nodeIds.includes(id))) throw new Error('IDs de componentes eléctricos duplicados.');
  const known = new Set(nodeIds);
  if (connections.some((connection) => !known.has((connection as { from: string }).from) || !known.has((connection as { to: string }).to) || (connection as { from: string }).from === (connection as { to: string }).to)) throw new Error('Ligação refere nós inválidos.');
  const knownBranchIds = new Set(branchIds);
  if (loads.some((load) => !knownBranchIds.has((load as { branchId: string }).branchId))) throw new Error('Carga ligada a um ramo inexistente.');
  const connectionIds = connections.map((connection) => (connection as { id: string }).id);
  if (new Set(connectionIds).size !== connectionIds.length) throw new Error('IDs de ligações duplicados.');
  return value as unknown as ElectricalSandboxV1;
}

function reachableFromSource(circuit: ElectricalSandboxV1): Set<string> {
  const branchByNode = new Map(circuit.branches.map((branch) => [branch.nodeId, branch]));
  const adjacency = new Map<string, string[]>();
  for (const connection of circuit.connections) {
    if (!connection.closed) continue;
    const next = adjacency.get(connection.from) ?? [];
    next.push(connection.to);
    adjacency.set(connection.from, next);
  }
  const reached = new Set<string>([circuit.source.id]);
  const pending = [circuit.source.id];
  while (pending.length) {
    const current = pending.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      const branch = branchByNode.get(next);
      if (branch && !branch.enabled || reached.has(next)) continue;
      reached.add(next);
      pending.push(next);
    }
  }
  return reached;
}

export function calculateElectricalSandbox(input: ElectricalSandboxV1): ElectricalSandboxResult {
  const circuit = validateElectricalSandbox(input);
  const reached = reachableFromSource(circuit);
  const loads = circuit.loads.map((load) => ({ id: load.id, name: load.name, apparentPowerVA: load.apparentPowerVA, energized: load.enabled && reached.has(load.nodeId) }));
  const branches = circuit.branches.map((branch) => {
    const branchLoads = circuit.loads.filter((load) => load.branchId === branch.id && load.enabled && reached.has(load.nodeId));
    const energized = branch.enabled && reached.has(branch.nodeId);
    const currentA = energized ? branchLoads.reduce((sum, load) => sum + load.apparentPowerVA, 0) / circuit.source.voltageV : 0;
    return { id: branch.id, name: branch.name, energized, currentA, currentLimitA: branch.currentLimitA, overloaded: currentA > branch.currentLimitA };
  });
  return {
    contract: 'electrical_sandbox.result.v1',
    inputValidity: 'valid',
    evidenceStatus: circuit.evidenceStatus,
    source: { voltageV: circuit.source.voltageV },
    loads,
    branches,
    limitations: ['Cálculo monofásico nominal I = ΣVA / V.', 'Não calcula factor de potência, queda de tensão, curto-circuito, choque, disparo ou coordenação de protecção.', 'Sobrecarga significa corrente nominal calculada acima do limite configurado; não prevê actuação de disjuntor.'],
  };
}

export type ElectricalOperation =
  | { kind: 'set_branch_enabled'; branchId: string; enabled: boolean }
  | { kind: 'set_connection_closed'; connectionId: string; closed: boolean }
  | { kind: 'set_load_enabled'; loadId: string; enabled: boolean }
  | { kind: 'update_load_apparent_power'; loadId: string; valueVA: number };

export function applyElectricalOperation(input: ElectricalSandboxV1, operation: ElectricalOperation): ElectricalSandboxV1 {
  const circuit = validateElectricalSandbox(input);
  if (operation.kind === 'set_branch_enabled') {
    if (!circuit.branches.some((branch) => branch.id === operation.branchId)) throw new Error('Ramo não encontrado.');
    return validateElectricalSandbox({ ...circuit, branches: circuit.branches.map((branch) => branch.id === operation.branchId ? { ...branch, enabled: operation.enabled } : branch) });
  }
  if (operation.kind === 'set_connection_closed') {
    if (!circuit.connections.some((connection) => connection.id === operation.connectionId)) throw new Error('Ligação não encontrada.');
    return validateElectricalSandbox({ ...circuit, connections: circuit.connections.map((connection) => connection.id === operation.connectionId ? { ...connection, closed: operation.closed } : connection) });
  }
  if (operation.kind === 'set_load_enabled') {
    if (!circuit.loads.some((load) => load.id === operation.loadId)) throw new Error('Carga não encontrada.');
    return validateElectricalSandbox({ ...circuit, loads: circuit.loads.map((load) => load.id === operation.loadId ? { ...load, enabled: operation.enabled } : load) });
  }
  if (!positive(operation.valueVA) || !circuit.loads.some((load) => load.id === operation.loadId)) throw new Error('Carga ou valor VA inválido.');
  return validateElectricalSandbox({ ...circuit, loads: circuit.loads.map((load) => load.id === operation.loadId ? { ...load, apparentPowerVA: operation.valueVA } : load) });
}

export function createUserElectricalCircuit(input: { voltageV: number; currentLimitA: number; lightingVA: number; outletVA: number; confirmedTopology: boolean }): ElectricalSandboxV1 {
  if (!input.confirmedTopology) throw new Error('Confirme explicitamente a topologia e as ligações antes de criar o circuito.');
  const circuit: ElectricalSandboxV1 = {
    contract: 'electrical_sandbox.v1', evidenceStatus: 'user_configured', source: { id: 'source', voltageV: input.voltageV },
    branches: [{ id: 'branch-1', nodeId: 'branch-node-1', name: 'Circuito 1', enabled: true, currentLimitA: input.currentLimitA }],
    loads: [
      { id: 'lighting-1', nodeId: 'lighting-node-1', branchId: 'branch-1', name: 'Ponto de iluminação', enabled: true, apparentPowerVA: input.lightingVA },
      { id: 'outlet-1', nodeId: 'outlet-node-1', branchId: 'branch-1', name: 'Ponto de utilização', enabled: true, apparentPowerVA: input.outletVA },
    ],
    connections: [
      { id: 'feed-1', from: 'source', to: 'branch-node-1', closed: true },
      { id: 'load-link-light-1', from: 'branch-node-1', to: 'lighting-node-1', closed: true },
      { id: 'load-link-outlet-1', from: 'branch-node-1', to: 'outlet-node-1', closed: true },
    ],
  };
  return validateElectricalSandbox(circuit);
}

export function createIndependentElectricalExample(): ElectricalSandboxV1 {
  return validateElectricalSandbox({
    contract: 'electrical_sandbox.v1', evidenceStatus: 'independent_example', source: { id: 'source', voltageV: 230 },
    branches: [{ id: 'branch-1', nodeId: 'branch-node-1', name: 'Circuito de demonstração', enabled: true, currentLimitA: 5 }],
    loads: [
      { id: 'lighting-1', nodeId: 'lighting-node-1', branchId: 'branch-1', name: 'Carga A · 60 VA', enabled: true, apparentPowerVA: 60 },
      { id: 'outlet-1', nodeId: 'outlet-node-1', branchId: 'branch-1', name: 'Carga B · 460 VA', enabled: true, apparentPowerVA: 460 },
    ],
    connections: [
      { id: 'feed-1', from: 'source', to: 'branch-node-1', closed: true },
      { id: 'load-link-light-1', from: 'branch-node-1', to: 'lighting-node-1', closed: true },
      { id: 'load-link-outlet-1', from: 'branch-node-1', to: 'outlet-node-1', closed: true },
    ],
  });
}
