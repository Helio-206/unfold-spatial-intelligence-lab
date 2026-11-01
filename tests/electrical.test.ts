import { describe, expect, it } from 'vitest';
import { categoryOf, summarizeReport } from '../src/core';
import { parseSpiceNetlist, parseSpiceValue, solveDc, solveLinear, verifyDc, type DcResult, type DcSolved } from '../src/domains/electrical';
import { circuit, clock, I, R, V } from './helpers/circuits';

/** Erro relativo < 1e-9 (absoluto, também 1e-9, quando o esperado é zero). */
function expectClose(actual: number | null | undefined, expected: number, label: string) {
  expect(actual, label).toBeTypeOf('number');
  const error = expected === 0 ? Math.abs(actual!) : Math.abs(actual! - expected) / Math.abs(expected);
  expect(error, `${label}: obtido ${actual}, esperado ${expected}`).toBeLessThan(1e-9);
}

function solved(result: DcResult): DcSolved {
  if (result.status !== 'solved') throw new Error(`esperava solved, obtive ${result.status}: ${JSON.stringify(result)}`);
  return result;
}
const volts = (r: DcSolved, net: string) => r.nodeVoltages[net]!.value;
const amps = (r: DcSolved, id: string) => r.componentCurrents[id]!.value;
const watts = (r: DcSolved, id: string) => r.componentPower[id]!.value;

describe('MNA DC — circuitos resolvidos à mão', () => {
  it('divisor de tensão: 10 V, R1 = 1 kΩ, R2 = 2 kΩ', () => {
    // Série: R = 1k + 2k = 3k  →  I = 10 V / 3 kΩ = 10/3 mA.
    // Nó do meio: V = I · R2 = (10/3 mA) · 2 kΩ = 20/3 V   (ou 10 · 2k/3k).
    // Convenção: corrente de p para n através do componente. R1 vai de "in" para "mid" (a favor da corrente): +10/3 mA.
    // A fonte entrega corrente: de p para n através dela é −10/3 mA.
    // Potências: R1 = I²·1k = 100/9 mW; R2 = I²·2k = 200/9 mW; fonte = −10 V · 10/3 mA = −100/3 mW; soma = 0.
    const r = solved(solveDc(circuit([V('V1', 'in', 'gnd', 10), R('R1', 'in', 'mid', 1000), R('R2', 'mid', 'gnd', 2000)]), { clock }));
    expectClose(volts(r, 'in'), 10, 'V(in)');
    expectClose(volts(r, 'mid'), 20 / 3, 'V(mid)');
    expectClose(volts(r, 'gnd'), 0, 'V(gnd)');
    expectClose(amps(r, 'R1'), 10 / 3 / 1000, 'I(R1)');
    expectClose(amps(r, 'R2'), 10 / 3 / 1000, 'I(R2)');
    expectClose(amps(r, 'V1'), -10 / 3 / 1000, 'I(V1)');
    expectClose(watts(r, 'R1'), 100 / 9 / 1000, 'P(R1)');
    expectClose(watts(r, 'R2'), 200 / 9 / 1000, 'P(R2)');
    expectClose(watts(r, 'V1'), -100 / 3 / 1000, 'P(V1)');
    expect(summarizeReport(r.report).status).toBe('pass');
  });

  it('duas resistências em paralelo (4 Ω e 6 Ω) numa fonte de 12 V', () => {
    // Cada ramo vê 12 V: Ia = 12/4 = 3 A, Ib = 12/6 = 2 A, total = 3 + 2 = 5 A (a fonte fornece 5 A: −5 A de p para n).
    // Potências: Ra = 12·3 = 36 W, Rb = 12·2 = 24 W, fonte = −12·5 = −60 W.
    const r = solved(solveDc(circuit([V('V1', 'top', 'gnd', 12), R('Ra', 'top', 'gnd', 4), R('Rb', 'top', 'gnd', 6)]), { clock }));
    expectClose(volts(r, 'top'), 12, 'V(top)');
    expectClose(amps(r, 'Ra'), 3, 'I(Ra)');
    expectClose(amps(r, 'Rb'), 2, 'I(Rb)');
    expectClose(amps(r, 'V1'), -5, 'I(V1)');
    expectClose(watts(r, 'Ra'), 36, 'P(Ra)');
    expectClose(watts(r, 'Rb'), 24, 'P(Rb)');
    expectClose(watts(r, 'V1'), -60, 'P(V1)');
    expect(summarizeReport(r.report).status).toBe('pass');
  });

  it('fonte de corrente de 2 mA numa resistência de 1 kΩ para a massa: 2 V, e a orientação conta', () => {
    // Convenção do modelo (e do SPICE): o valor é a corrente que ENTRA no terminal p vinda da fonte.
    // I1 com p = a, n = gnd injecta 2 mA em "a": V(a) = 2 mA · 1 kΩ = +2 V.
    const into = solved(solveDc(circuit([I('I1', 'a', 'gnd', 0.002), R('R1', 'a', 'gnd', 1000)]), { clock }));
    expectClose(volts(into, 'a'), 2, 'V(a), corrente a entrar em a');
    expectClose(amps(into, 'R1'), 0.002, 'I(R1): de a para a massa');
    // Terminais trocados: a fonte retira 2 mA de "a": V(a) = −2 V e a corrente na resistência inverte-se.
    const out = solved(solveDc(circuit([I('I1', 'gnd', 'a', 0.002), R('R1', 'a', 'gnd', 1000)]), { clock }));
    expectClose(volts(out, 'a'), -2, 'V(a), corrente a sair de a');
    expectClose(amps(out, 'R1'), -0.002, 'I(R1) invertida');
    // Potência: a fonte entrega 2 V · 2 mA = 4 mW, a resistência dissipa 4 mW.
    expectClose(watts(into, 'R1'), 0.004, 'P(R1)');
    expectClose(watts(into, 'I1'), -0.004, 'P(I1)');
    expect(summarizeReport(into.report).status).toBe('pass');
    expect(summarizeReport(out.report).status).toBe('pass');
  });

  it('duas fontes (10 V e 4 V) a alimentar um nó comum, R1 = R2 = R3 = 1 kΩ', () => {
    // Nó x, KCL (soma das correntes que entram = soma das que saem):
    //   (10 − Vx)/1k + (4 − Vx)/1k = Vx/1k   →   14 − 2Vx = Vx   →   Vx = 14/3 V.
    // R1: (10 − 14/3)/1k = 16/3 mA;  R2: (4 − 14/3)/1k = −2/3 mA;  R3: (14/3)/1k = 14/3 mA.   (16/3 − 2/3 = 14/3 ✓)
    // Fontes: V1 fornece 16/3 mA (−16/3 mA de p para n); V2 absorve 2/3 mA (+2/3 mA).
    // Potências: V1 = −10·16/3 = −160/3 mW; V2 = +4·2/3 = +8/3 mW; R1 = (16/3)²/1k = 256/9 mW;
    //            R2 = (2/3)²/1k = 4/9 mW; R3 = (14/3)²/1k = 196/9 mW.  Soma = (−480 + 24 + 256 + 4 + 196)/9 = 0 ✓
    const r = solved(solveDc(circuit([
      V('V1', 'a', 'gnd', 10), V('V2', 'b', 'gnd', 4),
      R('R1', 'a', 'x', 1000), R('R2', 'b', 'x', 1000), R('R3', 'x', 'gnd', 1000),
    ]), { clock }));
    expectClose(volts(r, 'x'), 14 / 3, 'V(x)');
    expectClose(amps(r, 'R1'), 16 / 3 / 1000, 'I(R1)');
    expectClose(amps(r, 'R2'), -2 / 3 / 1000, 'I(R2)');
    expectClose(amps(r, 'R3'), 14 / 3 / 1000, 'I(R3)');
    expectClose(amps(r, 'V1'), -16 / 3 / 1000, 'I(V1)');
    expectClose(amps(r, 'V2'), 2 / 3 / 1000, 'I(V2)');
    expectClose(watts(r, 'V1'), -160 / 3 / 1000, 'P(V1)');
    expectClose(watts(r, 'V2'), 8 / 3 / 1000, 'P(V2)');
    expectClose(watts(r, 'R1'), 256 / 9 / 1000, 'P(R1)');
    expectClose(watts(r, 'R2'), 4 / 9 / 1000, 'P(R2)');
    expectClose(watts(r, 'R3'), 196 / 9 / 1000, 'P(R3)');
    expect(summarizeReport(r.report).status).toBe('pass');
  });
});

describe('MNA DC — relatório de verificação', () => {
  const r = solved(solveDc(circuit([V('V1', 'a', 'gnd', 10), V('V2', 'b', 'gnd', 4), R('R1', 'a', 'x', 1000), R('R2', 'b', 'x', 1000), R('R3', 'x', 'gnd', 1000)]), { clock }));

  it('tem uma verificação KCL por nó, uma por fonte de tensão e o balanço de potência, todas a passar', () => {
    const ids = r.report.checks.map((check) => check.id).sort();
    expect(ids).toEqual(['electrical.kcl.a', 'electrical.kcl.b', 'electrical.kcl.gnd', 'electrical.kcl.x', 'electrical.power-balance', 'electrical.source.V1', 'electrical.source.V2']);
    expect(r.report.checks.every((check) => check.status === 'pass')).toBe(true);
  });

  it('lista as hipóteses e as entradas com a sua proveniência', () => {
    expect(r.report.assumptions.length).toBeGreaterThan(0);
    expect(r.report.inputs.map((input) => `${input.entityId}.${input.field}`)).toEqual(['V1.voltage', 'V2.voltage', 'R1.resistance', 'R2.resistance', 'R3.resistance']);
    expect(r.report.inputs.every((input) => input.origin === 'observed' && input.validation === 'unreviewed')).toBe(true);
  });

  it('o relatório falha quando uma verificação falha (não é decorativo)', () => {
    const broken = { checks: [...r.report.checks, { ...r.report.checks[0]!, status: 'fail' as const }] };
    expect(summarizeReport(broken).status).toBe('fail');
  });
});

describe('MNA DC — os resultados são cálculo, não dados', () => {
  const input = circuit([V('V1', 'in', 'gnd', 10), R('R1', 'in', 'mid', 1000), R('R2', 'mid', 'gnd', 2000)]);
  const before = structuredClone(input);
  const r = solved(solveDc(input, { clock }));

  it('todos os campos de saída são "calculated" e apontam para as entradas', () => {
    const outputs = [...Object.values(r.nodeVoltages), ...Object.values(r.componentCurrents), ...Object.values(r.componentPower)];
    expect(outputs.length).toBe(3 + 3 + 3);
    for (const field of outputs) {
      expect(categoryOf(field.provenance)).toBe('calculated');
      expect(field.provenance.origin).toBe('solver');
      expect(field.provenance.validation).toBe('unreviewed');
      expect(field.provenance.derivedFrom).toEqual([{ entityId: 'V1', field: 'voltage' }, { entityId: 'R1', field: 'resistance' }, { entityId: 'R2', field: 'resistance' }]);
    }
  });

  it('as unidades são V, A e W', () => {
    expect(Object.values(r.nodeVoltages).every((field) => field.unit === 'V')).toBe(true);
    expect(Object.values(r.componentCurrents).every((field) => field.unit === 'A')).toBe(true);
    expect(Object.values(r.componentPower).every((field) => field.unit === 'W')).toBe(true);
  });

  it('resolver não altera o circuito de entrada', () => {
    expect(input).toEqual(before);
  });
});

describe('MNA DC — recusas, sem inventar valores', () => {
  it('componente com valor null: status "missing" com a lista exacta do que falta', () => {
    const result = solveDc(circuit([V('V1', 'in', 'gnd', null), R('R1', 'in', 'mid', 1000), R('R2', 'mid', 'gnd', null), I('I1', 'mid', 'gnd', null)]), { clock });
    expect(result).toEqual({ status: 'missing', missing: [{ entityId: 'V1', field: 'voltage' }, { entityId: 'R2', field: 'resistance' }, { entityId: 'I1', field: 'current' }] });
  });

  it('um só valor em falta aparece sozinho', () => {
    const result = solveDc(circuit([V('V1', 'in', 'gnd', 10), R('R1', 'in', 'gnd', null)]), { clock });
    expect(result).toEqual({ status: 'missing', missing: [{ entityId: 'R1', field: 'resistance' }] });
  });

  const invalid = (result: DcResult) => {
    expect(result.status).toBe('invalid');
    expect(result).not.toHaveProperty('nodeVoltages');
    return result.status === 'invalid' ? result.issues : [];
  };

  it('nó flutuante', () => {
    // "island" só liga a "other"; nenhum caminho de componentes chega à massa.
    const issues = invalid(solveDc(circuit([V('V1', 'a', 'gnd', 5), R('R1', 'a', 'gnd', 100), R('R2', 'island', 'other', 100)]), { clock }));
    expect(issues.filter((issue) => issue.code === 'FLOATING_NET').flatMap((issue) => issue.subject).sort()).toEqual(['island', 'other']);
  });

  it('nó declarado sem nenhum componente', () => {
    const issues = invalid(solveDc(circuit([V('V1', 'a', 'gnd', 5), R('R1', 'a', 'gnd', 100)], { extraNets: ['orphan'] }), { clock }));
    expect(issues).toEqual([expect.objectContaining({ code: 'FLOATING_NET', subject: ['orphan'] })]);
  });

  it('sem massa', () => {
    const issues = invalid(solveDc(circuit([V('V1', 'a', 'b', 5), R('R1', 'a', 'b', 100)], { grounds: [] }), { clock }));
    expect(issues.map((issue) => issue.code)).toEqual(['GROUND_COUNT']);
  });

  it('duas massas', () => {
    const issues = invalid(solveDc(circuit([V('V1', 'a', 'gnd', 5), R('R1', 'a', 'gnd2', 100)], { grounds: ['gnd', 'gnd2'] }), { clock }));
    expect(issues.map((issue) => issue.code)).toEqual(['GROUND_COUNT']);
  });

  it.each([0, -5, -1e-9])('resistência não positiva (%s Ω)', (ohms) => {
    const issues = invalid(solveDc(circuit([V('V1', 'a', 'gnd', 5), R('R1', 'a', 'gnd', ohms)]), { clock }));
    expect(issues).toEqual([expect.objectContaining({ code: 'RESISTANCE_NOT_POSITIVE', subject: ['R1'] })]);
  });

  it('terminais iguais', () => {
    const issues = invalid(solveDc(circuit([V('V1', 'a', 'gnd', 5), R('R1', 'a', 'gnd', 100), R('R2', 'a', 'a', 100)]), { clock }));
    expect(issues).toEqual([expect.objectContaining({ code: 'TERMINAL_SHORTED', subject: ['R2'] })]);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])('valor não finito (%s)', (value) => {
    const issues = invalid(solveDc(circuit([V('V1', 'a', 'gnd', value), R('R1', 'a', 'gnd', 100)]), { clock }));
    expect(issues.map((issue) => issue.code)).toContain('VALUE_INVALID');
  });

  it('inválido tem prioridade sobre valores em falta', () => {
    const result = solveDc(circuit([V('V1', 'a', 'gnd', null), R('R1', 'a', 'gnd', 0)]), { clock });
    expect(result.status).toBe('invalid');
  });

  it('duas fontes de tensão em paralelo com valores diferentes: singular', () => {
    const result = solveDc(circuit([V('V1', 'a', 'gnd', 10), V('V2', 'a', 'gnd', 5), R('R1', 'a', 'gnd', 100)]), { clock });
    expect(result.status).toBe('singular');
    expect(result).not.toHaveProperty('nodeVoltages');
  });

  it('nó alimentado só por fontes de corrente: singular', () => {
    expect(solveDc(circuit([I('I1', 'a', 'gnd', 0.001)]), { clock }).status).toBe('singular');
  });
});

describe('verifyDc — as verificações conseguem falhar', () => {
  // Divisor: V1 10 V (in→gnd), R1 1k (in→mid), R2 2k (mid→gnd). Solução certa: V(mid) = 20/3 V, I = 10/3 mA.
  const divider = circuit([V('V1', 'in', 'gnd', 10), R('R1', 'in', 'mid', 1000), R('R2', 'mid', 'gnd', 2000)]);
  const I0 = 10 / 3 / 1000;
  const goodVoltage = (net: string) => ({ gnd: 0, in: 10, mid: 20 / 3 })[net as 'gnd' | 'in' | 'mid'];
  const status = (checks: ReturnType<typeof verifyDc>, id: string) => checks.find((check) => check.id === id)?.status;

  it('com a solução certa, tudo passa', () => {
    const checks = verifyDc(divider, goodVoltage, new Map([['V1', -I0], ['R1', I0], ['R2', I0]]));
    expect(checks.every((check) => check.status === 'pass')).toBe(true);
  });

  it('correntes que não conservam num nó: KCL falha nesse nó (e só nele) e o balanço de potência também', () => {
    // R1 = 1 mA mas R2 = 2 mA: em "mid" saem 2 mA e só entra 1 mA. Em "in" e "gnd" as contas ainda fecham.
    // Potência: V1 = 10·(−1 mA) = −10 mW; R1 = (10 − 20/3)·1 mA = 10/3 mW; R2 = (20/3)·2 mA = 40/3 mW; soma = 20/3 mW ≠ 0.
    const checks = verifyDc(divider, goodVoltage, new Map([['V1', -0.001], ['R1', 0.001], ['R2', 0.002]]));
    expect(status(checks, 'electrical.kcl.mid')).toBe('fail');
    expect(status(checks, 'electrical.kcl.in')).toBe('pass');
    expect(status(checks, 'electrical.power-balance')).toBe('fail');
    expect(summarizeReport({ checks }).status).toBe('fail');
  });

  it('tensão aos terminais da fonte diferente do valor da fonte: falha', () => {
    // V(in) = 9 V mas a fonte diz 10 V.
    const checks = verifyDc(divider, (net) => (net === 'in' ? 9 : goodVoltage(net)), new Map([['V1', -I0], ['R1', I0], ['R2', I0]]));
    expect(status(checks, 'electrical.source.V1')).toBe('fail');
  });
});

describe('solveLinear', () => {
  it('resolve um sistema pequeno calculado à mão', () => {
    // 2x + y = 4 ; x + 3y = 7  →  x = 1, y = 2.
    const x = solveLinear([[2, 1], [1, 3]], [4, 7])!;
    expectClose(x[0], 1, 'x');
    expectClose(x[1], 2, 'y');
  });

  it('precisa de pivotagem quando o primeiro pivô é zero', () => {
    // y = 2 ; x = 3.
    expect(solveLinear([[0, 1], [1, 0]], [2, 3])).toEqual([3, 2]);
  });

  it('recusa matrizes singulares exactas', () => {
    expect(solveLinear([[1, 2], [2, 4]], [1, 2])).toBeNull();
  });

  it.each([
    ['linhas proporcionais com coeficientes não representáveis em binário', [[0.1, 0.7, 0.3], [0.3, 2.1, 0.9], [1, 1, 1]], [1, 2, 3]],
    ['terceira linha = soma das duas primeiras', [[0.1, 1 / 3, 1 / 7], [0.1 + 1 / 3, 1 / 3 + 1 / 7, 1 / 7 + 0.1], [1 / 3, 1 / 7, 0.1]], [1, 2, 3]],
  ])('recusa matrizes singulares só por arredondamento: %s', (_label, matrix, rhs) => {
    // Sem limiar de pivô, o arredondamento deixa um pivô ~1e-17 e a resposta seria lixo da ordem de 1e16.
    expect(solveLinear(matrix as number[][], rhs as number[])).toBeNull();
  });
});

describe('SPICE — valores com sufixos', () => {
  it.each([
    ['1k', 1e3], ['4.7u', 4.7e-6], ['2meg', 2e6], ['2MEG', 2e6], ['2Meg', 2e6], ['1m', 1e-3], ['1M', 1e-3], ['3.3K', 3.3e3],
    ['5n', 5e-9], ['10p', 1e-11], ['2g', 2e9], ['1t', 1e12], ['7f', 7e-15], ['1e3', 1e3], ['2.5e-3', 2.5e-3], ['.5', 0.5], ['-5', -5], ['+5', 5], ['220', 220],
    ['10V', 10], ['10mV', 1e-2], ['220ohm', 220], ['1kohm', 1e3], ['2mA', 2e-3], ['5A', 5], ['1µ', 1e-6],
  ])('%s = %s', (text, expected) => {
    expectClose(parseSpiceValue(text), expected, text);
  });

  it.each(['', 'k', 'abc', '1mil', '5q', '1x', '1farad', '1.2.3', '1k2', 'NaN', 'inf', '0x10'])('não inventa um valor para %j', (text) => {
    // "mil" em SPICE é 25.4 µ, não 1 m; sufixos desconhecidos não se ignoram em silêncio.
    expect(parseSpiceValue(text)).toBeNull();
  });
});

describe('SPICE — importação', () => {
  const divider = ['Divisor de tensão', 'V1 in 0 DC 10', 'R1 in mid 1k', 'R2 mid 0 2k', '.end'].join('\n');
  const importOf = (text: string) => parseSpiceNetlist(text, { circuitId: 'spice1', sourceId: 'netlist.cir', clock });

  it('importa o divisor e o solver dá o mesmo que a conta à mão (V(mid) = 20/3 V)', () => {
    const { circuit: c, unsupported } = importOf(divider);
    expect(unsupported).toEqual([]);
    expect(c.title).toBe('Divisor de tensão');
    expect(c.components.map((x) => [x.id, x.kind, x.terminals.p, x.terminals.n, x.value.value, x.value.unit])).toEqual([
      ['v1', 'voltage_source', 'in', 'gnd', 10, 'V'],
      ['r1', 'resistor', 'in', 'mid', 1000, 'ohm'],
      ['r2', 'resistor', 'mid', 'gnd', 2000, 'ohm'],
    ]);
    expect(c.nets.filter((net) => net.isGround).map((net) => net.id)).toEqual(['gnd']);
    const r = solved(solveDc(c, { clock }));
    expectClose(volts(r, 'mid'), 20 / 3, 'V(mid)');
    expect(summarizeReport(r.report).status).toBe('pass');
  });

  it('a palavra DC é opcional e "0", "gnd" e "GND" são a mesma massa', () => {
    const { circuit: c, unsupported } = importOf(['t', 'V1 a gnd 5', 'R1 a GND 100', 'R2 a 0 100'].join('\n'));
    expect(unsupported).toEqual([]);
    expect(c.nets.map((net) => net.id).sort()).toEqual(['a', 'gnd']);
    expect(solveDc(c, { clock }).status).toBe('solved');
  });

  it('orientação da fonte de corrente: `I1 N+ N-` empurra a corrente de N+ para N- através da fonte', () => {
    // `I1 0 A 2m`: a corrente sai de gnd, atravessa a fonte e entra em A  →  V(A) = 2 mA · 1 kΩ = +2 V.
    const into = importOf(['t', 'I1 0 A 2m', 'R1 A 0 1k'].join('\n'));
    expect(into.circuit.components[0]!.terminals).toEqual({ p: 'a', n: 'gnd' });
    expectClose(volts(solved(solveDc(into.circuit, { clock })), 'a'), 2, 'V(A) a entrar');
    // `I1 A 0 2m`: a corrente sai de A e vai para a massa  →  V(A) = −2 V.
    const out = importOf(['t', 'I1 A 0 2m', 'R1 A 0 1k'].join('\n'));
    expectClose(volts(solved(solveDc(out.circuit, { clock })), 'a'), -2, 'V(A) a sair');
  });

  it('importa com sufixos', () => {
    const { circuit: c } = importOf(['t', 'V1 a 0 5', 'R1 a b 4.7k', 'R2 b 0 2meg', 'I1 0 b 3u'].join('\n'));
    expect(c.components.map((x) => x.value.value)).toEqual([5, 4700, 2e6, 3e-6]);
  });

  it('tudo o que importa é "observed", não revisto, com a linha como evidência', () => {
    const { circuit: c } = importOf(divider);
    const r1 = c.components.find((x) => x.id === 'r1')!;
    for (const provenance of [r1.provenance, r1.value.provenance]) {
      expect(provenance.origin).toBe('observed');
      expect(provenance.validation).toBe('unreviewed');
      expect(categoryOf(provenance)).toBe('extracted');
      expect(provenance.evidence).toEqual([{ sourceId: 'netlist.cir', locator: 'line 3', excerpt: 'R1 in mid 1k' }]);
    }
    for (const net of c.nets) {
      expect(net.provenance.origin).toBe('observed');
      expect(net.provenance.validation).toBe('unreviewed');
      expect(net.provenance.evidence?.[0]).toMatchObject({ sourceId: 'netlist.cir', excerpt: expect.stringContaining(net.label === 'GND' ? '0' : net.label) });
    }
    expect(c.components.every((x) => x.value.provenance.evidence?.[0]?.locator === `line ${c.components.indexOf(x) + 2}`)).toBe(true);
  });

  it('o que não é suportado aparece em `unsupported`, com a linha e o texto, e não entra no circuito', () => {
    const text = ['Misto', 'V1 a 0 5', 'C1 a b 1u', 'R1 a b 1k', 'L1 b 0 1m', 'D1 b 0 dmod', '.model dmod D', '.tran 1m 10m', 'X1 a b sub', 'R2 b 0', 'V2 c 0 AC 5', 'R3 c 0 1mil', 'R4 b 0 1k tc1=0.01', '+ continuação', '.end'].join('\n');
    const { circuit: c, unsupported } = importOf(text);
    expect(c.components.map((x) => x.id)).toEqual(['v1', 'r1']);
    expect(unsupported.map((u) => [u.line, u.text])).toEqual([
      [3, 'C1 a b 1u'], [5, 'L1 b 0 1m'], [6, 'D1 b 0 dmod'], [7, '.model dmod D'], [8, '.tran 1m 10m'], [9, 'X1 a b sub'],
      [10, 'R2 b 0'], [11, 'V2 c 0 AC 5'], [12, 'R3 c 0 1mil'], [13, 'R4 b 0 1k tc1=0.01'], [14, '+ continuação'],
    ]);
    expect(unsupported.every((u) => u.reason.length > 0)).toBe(true);
  });

  it('comentários e linhas em branco não são "não suportados"; .op e .end são aceites', () => {
    const { unsupported, circuit: c } = importOf(['t', '* comentário', '', 'V1 a 0 5 ; comentário na linha', 'R1 a 0 1k', '.op', '.end'].join('\r\n'));
    expect(unsupported).toEqual([]);
    expect(c.components.map((x) => x.value.value)).toEqual([5, 1000]);
  });

  it('nada depois de .end é lido', () => {
    const { circuit: c, unsupported } = importOf(['t', 'V1 a 0 5', 'R1 a 0 1k', '.end', 'R2 a 0 1', 'C9 a 0 1u'].join('\n'));
    expect(c.components.map((x) => x.id)).toEqual(['v1', 'r1']);
    expect(unsupported).toEqual([]);
  });

  it('nomes repetidos são apanhados na validação, não resolvidos a meio', () => {
    const { circuit: c } = importOf(['t', 'V1 a 0 5', 'R1 a 0 1k', 'R1 a 0 2k'].join('\n'));
    const result = solveDc(c, { clock });
    expect(result.status).toBe('invalid');
    expect(result.status === 'invalid' && result.issues.map((issue) => issue.code)).toContain('DUPLICATE_ID');
  });

  it('um netlist sem massa não é resolvido', () => {
    const { circuit: c } = importOf(['t', 'V1 a b 5', 'R1 a b 1k'].join('\n'));
    const result = solveDc(c, { clock });
    expect(result.status === 'invalid' && result.issues.map((issue) => issue.code)).toEqual(['GROUND_COUNT']);
  });
});

describe('SPICE — nomes sem distinção de maiúsculas', () => {
  const importOf = (text: string) => parseSpiceNetlist(text, { circuitId: 'spice1', sourceId: 'netlist.cir', clock });

  it('"In", "in" e "IN" são o mesmo nó, e o circuito resolve-se', () => {
    // 5 V em "In"; R1 = 1k de "in" para "Mid"; R2 = 2k de "MID" para a massa  →  V(mid) = 5 · 2k/3k = 10/3 V.
    const { circuit: c, unsupported } = importOf(['t', 'V1 In 0 5', 'R1 in Mid 1k', 'R2 MID 0 2k'].join('\n'));
    expect(unsupported).toEqual([]);
    expect(c.nets.map((net) => net.id).sort()).toEqual(['gnd', 'in', 'mid']);
    const r = solved(solveDc(c, { clock }));
    expectClose(volts(r, 'mid'), 10 / 3, 'V(mid)');
    expectClose(volts(r, 'in'), 5, 'V(in)');
  });

  it('o nome original fica no label (o da primeira vez que aparece) e na evidência', () => {
    const { circuit: c } = importOf(['t', 'V1 In 0 5', 'R1 in Mid 1k', 'R2 MID 0 2k'].join('\n'));
    expect(c.nets.find((net) => net.id === 'in')).toMatchObject({ label: 'In', provenance: { evidence: [{ locator: 'line 2', excerpt: 'V1 In 0 5' }] } });
    expect(c.nets.find((net) => net.id === 'mid')).toMatchObject({ label: 'Mid', provenance: { evidence: [{ locator: 'line 3', excerpt: 'R1 in Mid 1k' }] } });
    expect(c.components.map((x) => [x.id, x.label])).toEqual([['v1', 'V1'], ['r1', 'R1'], ['r2', 'R2']]);
    expect(c.components[2]!.value.provenance.evidence).toEqual([{ sourceId: 'netlist.cir', locator: 'line 4', excerpt: 'R2 MID 0 2k' }]);
  });

  it('o prefixo do tipo também não depende das maiúsculas', () => {
    const { circuit: c, unsupported } = importOf(['t', 'v1 a 0 5', 'r1 a 0 1k', 'i1 0 a 1m'].join('\n'));
    expect(unsupported).toEqual([]);
    expect(c.components.map((x) => [x.id, x.kind, x.label])).toEqual([['v1', 'voltage_source', 'v1'], ['r1', 'resistor', 'r1'], ['i1', 'current_source', 'i1']]);
  });

  it('"R1" e "r1" são o mesmo nome: o circuito recusa-se a resolver em vez de ter dois componentes', () => {
    const { circuit: c } = importOf(['t', 'V1 a 0 5', 'R1 a 0 1k', 'r1 a 0 2k'].join('\n'));
    expect(c.components.map((x) => x.label)).toEqual(['V1', 'R1', 'r1']);
    const result = solveDc(c, { clock });
    expect(result.status === 'invalid' && result.issues.map((issue) => issue.code)).toContain('DUPLICATE_ID');
  });
});

describe('SPICE — nomes diferentes que dão o mesmo id', () => {
  const importOf = (text: string) => parseSpiceNetlist(text, { circuitId: 'spice1', sourceId: 'netlist.cir', clock });
  const long = (suffix: string) => `${'n'.repeat(64)}${suffix}`;

  it('dois nós distintos que dão o mesmo id não se fundem: a segunda linha vai para unsupported', () => {
    // "a/b" e "a_b" dão ambos "a_b". Fundi-los ligaria R2 ao nó de R1 sem ninguém o ter dito.
    const { circuit: c, unsupported } = importOf(['t', 'V1 a/b 0 5', 'R1 a/b 0 1k', 'R2 a_b 0 2k'].join('\n'));
    expect(c.components.map((x) => x.id)).toEqual(['v1', 'r1']);
    expect(c.nets.map((net) => [net.id, net.label])).toEqual([['a_b', 'a/b'], ['gnd', 'GND']]);
    expect(unsupported.map((u) => [u.line, u.text])).toEqual([[4, 'R2 a_b 0 2k']]);
    expect(unsupported[0]!.reason).toMatch(/mesmo identificador/);
  });

  it('a linha recusada não cria nenhum dos seus outros nós', () => {
    const { circuit: c, unsupported } = importOf(['t', 'V1 a/b 0 5', 'R1 a_b brand_new 1k', 'R2 brand_new 0 1k'].join('\n'));
    expect(unsupported.map((u) => u.line)).toEqual([3]);
    expect(c.nets.map((net) => net.id)).toEqual(['a_b', 'gnd', 'brand_new']);
    expect(c.components.map((x) => x.id)).toEqual(['v1', 'r2']);
  });

  it('dois nós novos em colisão na mesma linha também são recusados', () => {
    // "a/b" e "a_b" aparecem pela primeira vez na mesma linha: ficaria uma resistência com os dois terminais no mesmo nó.
    const { circuit: c, unsupported } = importOf(['t', 'V1 x 0 5', 'R1 a/b a_b 1k', 'R2 x 0 1k'].join('\n'));
    expect(unsupported.map((u) => u.line)).toEqual([3]);
    expect(c.nets.map((net) => net.id).sort()).toEqual(['gnd', 'x']);
    expect(c.components.map((x) => x.id)).toEqual(['v1', 'r2']);
  });

  it('o mesmo nome escrito de formas diferentes (maiúsculas) não é uma colisão', () => {
    const { unsupported } = importOf(['t', 'V1 A/b 0 5', 'R1 a/B 0 1k'].join('\n'));
    expect(unsupported).toEqual([]);
  });

  it('dois componentes distintos com o mesmo id: a segunda linha vai para unsupported', () => {
    const { circuit: c, unsupported } = importOf(['t', 'V1 a 0 5', 'R/1 a 0 1k', 'R_1 a 0 2k'].join('\n'));
    expect(c.components.map((x) => [x.id, x.label, x.value.value])).toEqual([['v1', 'V1', 5], ['r_1', 'R/1', 1000]]);
    expect(unsupported.map((u) => [u.line, u.text])).toEqual([[4, 'R_1 a 0 2k']]);
    expect(solveDc(c, { clock }).status).toBe('solved');
  });

  it('o corte aos 64 caracteres também conta', () => {
    const { circuit: c, unsupported } = importOf(['t', `V1 ${long('x')} 0 5`, `R1 ${long('y')} 0 1k`].join('\n'));
    expect(c.nets.filter((net) => !net.isGround)).toHaveLength(1);
    expect(unsupported.map((u) => u.line)).toEqual([3]);
  });

  it('"0", "gnd" e "GND" continuam a ser uma única massa, sem colisão', () => {
    const { circuit: c, unsupported } = importOf(['t', 'V1 a 0 5', 'R1 a gnd 1k', 'R2 a GND 1k'].join('\n'));
    expect(unsupported).toEqual([]);
    expect(c.nets.filter((net) => net.isGround)).toHaveLength(1);
  });

  it('um nó chamado como a massa só se funde com ela se for a massa', () => {
    // "g.nd" não é "gnd": tem de ser um nó próprio.
    const { circuit: c, unsupported } = importOf(['t', 'V1 g.nd 0 5', 'R1 g.nd 0 1k'].join('\n'));
    expect(unsupported).toEqual([]);
    expect(c.nets.map((net) => net.id).sort()).toEqual(['g.nd', 'gnd']);
  });
});

