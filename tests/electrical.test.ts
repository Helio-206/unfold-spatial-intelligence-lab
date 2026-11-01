import { describe, expect, it } from 'vitest';
import { categoryOf, summarizeReport } from '../src/core';
import { solveDc, solveLinear, verifyDc, type DcResult, type DcSolved } from '../src/domains/electrical';
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
