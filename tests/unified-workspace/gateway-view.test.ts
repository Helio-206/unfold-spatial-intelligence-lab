import { describe, expect, it } from 'vitest';
import { gatewayPanel, missingHtml, missingLines, sentSummary } from '../../src/living/experience/gateway-view';
import { gateText } from '../../src/living/experience/experience';
import { initialReview, reduceReview } from '../../src/living/experience/review';
import type { HandoffExtra, HandoffHuman, ReviewHandoff } from '../../src/living/experience/integration';
import { observation } from './helpers';

const human = (over: Partial<HandoffHuman> = {}): HandoffHuman => ({ reviewerId: '', familyConfirmed: false, bucketConfirmed: false, bucketWidthM: null, widthBasis: '', ...over });
function handoff(extras: HandoffExtra[], blockers: string[], h = human(), notes: string[] = []): ReviewHandoff {
  return { sync() {}, extras: () => extras, decideExtra() {}, human: () => h, setHuman() {}, blockers: () => blockers, localNotes: () => notes, async submit() { return { kind: 'ignored' }; }, reopen() {}, reset() {} };
}
const extra = (key: string, kind: string, decision?: 'confirm' | 'reject'): HandoffExtra => ({ key, kind, label: key, decision });

describe('what is missing, in plain language', () => {
  it('folds the per-item "sem decisão" lines into one count and keeps every other reason', () => {
    const lines = missingLines(handoff([extra('relation:a', 'relation'), extra('relation:b', 'relation', 'reject')], ['identificação do revisor obrigatória', 'item sem decisão: relation:a', 'A visualização só consegue desenhar uma caçamba com 0,60 a 2,40 m de largura; 3 m não é aceite, e o valor não é ajustado.']));
    expect(lines).toHaveLength(3);
    expect(lines.join('\n')).toMatch(/identificação do revisor/); expect(lines.join('\n')).toMatch(/0,60 a 2,40 m/); expect(lines.join('\n')).toMatch(/1 relação\(ões\) ou afirmação\(ões\) do modelo por decidir/);
  });
  it('says nothing is missing when nothing is', () => {
    expect(missingLines(handoff([], []))).toEqual([]);
    expect(missingHtml([])).toMatch(/Nada falta/);
  });
  it('escapes what it shows', () => { expect(missingHtml(['<img src=x onerror=alert(1)>'])).not.toContain('<img'); });
});

describe('what will be sent, and what the API cannot apply', () => {
  const obs = observation();
  it('counts only decisions on hypotheses and says corrections go as a rejection of the original', () => {
    let ui = initialReview(obs);
    ui = reduceReview(ui, { type: 'decide', id: ui.items[0]!.id, decision: 'confirmed' });
    ui = reduceReview(ui, { type: 'decide', id: ui.items[1]!.id, decision: 'rejected' });
    ui = reduceReview(ui, { type: 'correct', id: ui.items[2]!.id, correction: { kind: 'boom', label: 'Lança' } });
    const text = sentSummary(handoff([extra('relation:a', 'relation', 'reject')], []), ui).join(' ');
    expect(text).toMatch(/3 decisões sobre entidades em hipótese \(1 confirmadas, 1 rejeitadas, 1 correcções enviadas como rejeição/);
    expect(text).toMatch(/1 sobre relações e afirmações do modelo/);
    expect(text).toMatch(/só aplica à montagem a largura da caçamba; nenhuma correcção de texto nem valor introduzido altera a geometria/);
  });
  it('is part of the server step, with the width limits visible before a mistake', () => {
    const html = gatewayPanel(handoff([], ['x']), initialReview(obs), null, false);
    expect(html).toMatch(/Vai ser enviado/); expect(html).toMatch(/de 0,60 a 2,40 m/); expect(html).toMatch(/min="0.6" max="2.4"/);
    expect(html).toMatch(/id="gw-family"(?![^>]*checked)/); expect(html).toMatch(/id="gw-bucket"(?![^>]*checked)/);
  });
});

describe('gate 2 states its scope', () => {
  it('names the solver and limits the claim to the reference pose', () => {
    const ui = initialReview(obs());
    const text = gateText(ui, { status: 'valid', solverId: 'unfold.engineering.forward-kinematics@0.1.0' }).engine;
    expect(text).toMatch(/forward-kinematics@0\.1\.0/); expect(text).toMatch(/só a pose de referência desta montagem/); expect(text).toMatch(/não certifica segurança, resistência, colisões/);
  });
  it('shows the engine\'s reason when it blocks', () => {
    expect(gateText(initialReview(obs()), { status: 'blocked', reasons: ['STROKE_OUT_OF_RANGE: x'] }).engine).toMatch(/STROKE_OUT_OF_RANGE/);
  });
});
function obs() { return observation(); }
