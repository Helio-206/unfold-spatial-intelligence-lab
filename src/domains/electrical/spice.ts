import type { Provenance } from '../../core';
import { CIRCUIT_SCHEMA, VALUE_UNIT, type CircuitV1, type ComponentKind, type ElectricalComponent, type Net } from './model';

/**
 * Importação de netlists SPICE simples (R, V, I em DC). É a via "vectorial" do domínio eléctrico:
 * os valores entram como `observed`, com a linha de origem como evidência.
 * Elementos não suportados não são ignorados em silêncio: aparecem em `unsupported`.
 */

export type SpiceImport = { circuit: CircuitV1; unsupported: Array<{ line: number; text: string; reason: string }> };

const SUFFIX: Array<[string, number]> = [['meg', 1e6], ['t', 1e12], ['g', 1e9], ['k', 1e3], ['m', 1e-3], ['u', 1e-6], ['µ', 1e-6], ['n', 1e-9], ['p', 1e-12], ['f', 1e-15]];

/** Converte valores SPICE como `1k`, `4.7u`, `2meg`, `10V`, `220ohm`. Devolve null se não for um número. */
export function parseSpiceValue(raw: string): number | null {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-zµ]*)$/i.exec(raw.trim());
  if (!match) return null;
  const base = Number(match[1]);
  const tail = match[2]!.toLowerCase();
  if (!tail) return base;
  const suffix = SUFFIX.find(([key]) => tail.startsWith(key));
  // Letras que não são multiplicadores (por exemplo 'v', 'a', 'ohm') são unidades e ignoram-se, como no SPICE.
  return suffix ? base * suffix[1] : base;
}

const safeId = (name: string) => name.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 64);

export function parseSpiceNetlist(text: string, options: { circuitId: string; sourceId: string; clock?: () => Date }): SpiceImport {
  const recordedAt = (options.clock ?? (() => new Date()))().toISOString();
  const lines = text.split(/\r?\n/);
  const title = lines[0]?.trim() || 'Circuito importado';
  const nets = new Map<string, Net>();
  const components: ElectricalComponent[] = [];
  const unsupported: SpiceImport['unsupported'] = [];
  const observed = (line: number, excerpt: string): Provenance => ({ origin: 'observed', validation: 'unreviewed', recordedAt, evidence: [{ sourceId: options.sourceId, locator: `line ${line}`, excerpt }] });

  const netFor = (name: string, line: number, excerpt: string): string => {
    const ground = name === '0' || name.toLowerCase() === 'gnd';
    const id = ground ? 'gnd' : safeId(name);
    if (!nets.has(id)) nets.set(id, { id, label: ground ? 'GND' : name, isGround: ground, provenance: observed(line, excerpt) });
    return id;
  };

  // A primeira linha de um ficheiro SPICE é o título.
  lines.slice(1).forEach((rawLine, offset) => {
    const lineNumber = offset + 2;
    const line = rawLine.replace(/;.*$/, '').trim();
    if (!line || line.startsWith('*') || line.startsWith('+')) return;
    if (line.startsWith('.')) {
      if (!/^\.(end|op)\b/i.test(line)) unsupported.push({ line: lineNumber, text: line, reason: 'Directiva não suportada; ignorada.' });
      return;
    }
    const tokens = line.split(/\s+/);
    const name = tokens[0]!;
    const letter = name[0]!.toUpperCase();
    const kind: ComponentKind | undefined = letter === 'R' ? 'resistor' : letter === 'V' ? 'voltage_source' : letter === 'I' ? 'current_source' : undefined;
    if (!kind) {
      unsupported.push({ line: lineNumber, text: line, reason: `Elemento ${letter} não suportado na análise DC v1.` });
      return;
    }
    const valueToken = (tokens[3]?.toUpperCase() === 'DC' ? tokens[4] : tokens[3]) ?? '';
    const value = parseSpiceValue(valueToken);
    if (tokens.length < 4 || value === null) {
      unsupported.push({ line: lineNumber, text: line, reason: 'Não foi possível ler os nós ou o valor.' });
      return;
    }
    const a = netFor(tokens[1]!, lineNumber, line);
    const b = netFor(tokens[2]!, lineNumber, line);
    // SPICE: em `I N+ N-`, a corrente atravessa a fonte de N+ para N-, ou seja, entra no circuito por N-.
    const terminals = kind === 'current_source' ? { p: b, n: a } : { p: a, n: b };
    components.push({ id: safeId(name), kind, label: name, terminals, value: { value, unit: VALUE_UNIT[kind], provenance: observed(lineNumber, line) }, provenance: observed(lineNumber, line) });
  });

  return {
    circuit: { schema: CIRCUIT_SCHEMA, id: options.circuitId, title, revision: { id: `${options.circuitId}:r0`, number: 0, parentId: null }, nets: [...nets.values()], components },
    unsupported,
  };
}
