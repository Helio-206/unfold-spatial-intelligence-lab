import type { Provenance } from '../../core';
import { CIRCUIT_SCHEMA, VALUE_UNIT, type CircuitV1, type ComponentKind, type ElectricalComponent, type Net } from './model';

/**
 * Importação de netlists SPICE simples (R, V, I em DC). É a via "vectorial" do domínio eléctrico:
 * os valores entram como `observed`, com a linha de origem como evidência.
 * Elementos não suportados não são ignorados em silêncio: aparecem em `unsupported`.
 */

export type SpiceImport = { circuit: CircuitV1; unsupported: Array<{ line: number; text: string; reason: string }> };

const MULTIPLIER: Record<string, number> = { meg: 1e6, t: 1e12, g: 1e9, k: 1e3, m: 1e-3, u: 1e-6, 'µ': 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 };

/**
 * Converte valores SPICE como `1k`, `4.7u`, `2meg`, `10V`, `220ohm`: número, multiplicador opcional e unidade opcional
 * (V, A, ohm). Devolve null para tudo o resto. Em particular `mil` (25,4 µ em SPICE) e sufixos desconhecidos não são
 * lidos como outra coisa: uma migração não fabrica um valor.
 */
export function parseSpiceValue(raw: string): number | null {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(meg|[tgkmunpfµ])?(v|a|ohms?|ω)?$/i.exec(raw.trim());
  if (!match) return null;
  const base = Number(match[1]);
  const multiplier = match[2] === undefined ? 1 : MULTIPLIER[match[2].toLowerCase()]!;
  return base * multiplier;
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
  for (const [offset, rawLine] of lines.slice(1).entries()) {
    const lineNumber = offset + 2;
    const line = rawLine.replace(/;.*$/, '').trim();
    if (!line || line.startsWith('*')) continue;
    if (/^\.end\b/i.test(line)) break; // nada depois de .end faz parte do circuito
    if (line.startsWith('+')) {
      unsupported.push({ line: lineNumber, text: line, reason: 'Linha de continuação não suportada; a linha anterior pode estar incompleta.' });
      continue;
    }
    if (line.startsWith('.')) {
      if (!/^\.op\b/i.test(line)) unsupported.push({ line: lineNumber, text: line, reason: 'Directiva não suportada; ignorada.' });
      continue;
    }
    const tokens = line.split(/\s+/);
    const name = tokens[0]!;
    const letter = name[0]!.toUpperCase();
    const kind: ComponentKind | undefined = letter === 'R' ? 'resistor' : letter === 'V' ? 'voltage_source' : letter === 'I' ? 'current_source' : undefined;
    if (!kind) {
      unsupported.push({ line: lineNumber, text: line, reason: `Elemento ${letter} não suportado na análise DC v1.` });
      continue;
    }
    // R nome n1 n2 valor | V/I nome n1 n2 [DC] valor. Qualquer parâmetro a mais (tc1=, AC, ...) não é ignorado em silêncio.
    const hasDc = kind !== 'resistor' && tokens[3]?.toUpperCase() === 'DC';
    const expectedTokens = hasDc ? 5 : 4;
    if (tokens.length !== expectedTokens) {
      unsupported.push({ line: lineNumber, text: line, reason: tokens.length < expectedTokens ? 'Não foi possível ler os nós ou o valor.' : 'Parâmetros adicionais não suportados; ignorá-los mudaria o circuito.' });
      continue;
    }
    const value = parseSpiceValue(tokens[expectedTokens - 1]!);
    if (value === null) {
      unsupported.push({ line: lineNumber, text: line, reason: 'Não foi possível ler o valor.' });
      continue;
    }
    const a = netFor(tokens[1]!, lineNumber, line);
    const b = netFor(tokens[2]!, lineNumber, line);
    // SPICE: em `I N+ N-`, a corrente atravessa a fonte de N+ para N-, ou seja, entra no circuito por N-.
    const terminals = kind === 'current_source' ? { p: b, n: a } : { p: a, n: b };
    components.push({ id: safeId(name), kind, label: name, terminals, value: { value, unit: VALUE_UNIT[kind], provenance: observed(lineNumber, line) }, provenance: observed(lineNumber, line) });
  }

  return {
    circuit: { schema: CIRCUIT_SCHEMA, id: options.circuitId, title, revision: { id: `${options.circuitId}:r0`, number: 0, parentId: null }, nets: [...nets.values()], components },
    unsupported,
  };
}
