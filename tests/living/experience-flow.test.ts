import { describe, expect, it, vi } from 'vitest';
import { checkFile, checkText, classifyObservation, DemoReconstructionPort, failureMessage, MAX_INPUT_BYTES } from '../../src/living/experience/intake';
import { initialFlow, reduceFlow, type FlowAction } from '../../src/living/experience/flow';
import { insufficientObservation, notIdentifiedObservation, reconstructionFixture } from '../../src/living/experience/reconstruction-fixture';
import { ENGINE_GATE_LABEL, initialReview, labCategory, propertyState, readiness, reduceReview, summarize } from '../../src/living/experience/review';

const run = (actions: FlowAction[]) => actions.reduce(reduceFlow, initialFlow());
const file = { kind: 'drawing' as const, name: 'a.png', size: 10, mime: 'image/png', dataUrl: 'data:image/png;base64,AA' };

describe('intake validation', () => {
  it('accepts PNG/JPEG/WebP up to the server limit and explains every refusal', () => {
    expect(checkFile({ name: 'a.png', size: 100, type: 'image/png' })).toBeNull();
    expect(checkFile({ name: 'a.pdf', size: 100, type: 'application/pdf' })?.code).toBe('UNSUPPORTED_TYPE');
    expect(checkFile({ name: 'big.jpg', size: MAX_INPUT_BYTES + 1, type: 'image/jpeg' })?.message).toMatch(/máximo/);
    expect(checkFile({ name: 'z.png', size: 0, type: 'image/png' })?.code).toBe('EMPTY_FILE');
    expect(checkText('curta')?.code).toBe('TEXT_TOO_SHORT');
    expect(checkText('escavadora de rastos de 20 t')).toBeNull();
  });
  it('classifies an unrecognised machine as not identified, never as a reconstruction', () => {
    const o = classifyObservation(notIdentifiedObservation(), { mode: 'demo', scenario: 'not_identified' });
    expect(o.kind).toBe('not_identified');
  });
  it('maps backend codes to plain language and keeps unknown codes visible', () => {
    expect(failureMessage('MODEL_API_KEY_MISSING').retryable).toBe(false);
    expect(failureMessage('X_42').message).toMatch(/X_42/);
  });
});

describe('demo port', () => {
  it('labels its results as demo and never as the model', async () => {
    vi.useFakeTimers();
    const port = new DemoReconstructionPort('observation', 10);
    const p = port.submit(file, new AbortController().signal);
    vi.advanceTimersByTime(20);
    const o = await p;
    expect(port.mode).toBe('demo');
    expect(o.kind === 'observation' && o.provenance).toEqual({ mode: 'demo', scenario: 'observation' });
    vi.useRealTimers();
  });
  it('can be cancelled', async () => {
    const port = new DemoReconstructionPort('observation', 1000);
    const ac = new AbortController();
    const p = port.submit(file, ac.signal); ac.abort();
    await expect(p).rejects.toThrow(/cancelled/);
  });
});

describe('flow', () => {
  it('empty → selected → waiting → review', () => {
    const s = run([{ type: 'select', input: file }, { type: 'submit', at: 1 }, { type: 'outcome', outcome: { kind: 'observation', observation: reconstructionFixture(), provenance: { mode: 'demo', scenario: 'observation' } } }]);
    expect(s.phase).toBe('review');
    expect(s.observation?.entities.length).toBe(10);
  });
  it('cannot submit without an input', () => { expect(run([{ type: 'submit', at: 1 }]).phase).toBe('empty'); });
  it('cancel returns to the selected input; a late answer is ignored', () => {
    const s = run([{ type: 'select', input: file }, { type: 'submit', at: 1 }, { type: 'cancel' }, { type: 'outcome', outcome: { kind: 'unavailable', reason: 'x' } }]);
    expect(s.phase).toBe('selected');
    expect(s.input).toBe(file);
  });
  it('not identified, failed and unavailable are distinct end states with retry only where it makes sense', () => {
    const base: FlowAction[] = [{ type: 'select', input: file }, { type: 'submit', at: 1 }];
    expect(run([...base, { type: 'outcome', outcome: { kind: 'not_identified', reason: 'grua', provenance: { mode: 'demo', scenario: 'not_identified' } } }]).phase).toBe('not_identified');
    const failedHard = run([...base, { type: 'outcome', outcome: { kind: 'failed', code: 'MODEL_API_KEY_MISSING', message: 'm', retryable: false } }, { type: 'retry', at: 2 }]);
    expect(failedHard.phase).toBe('failed');
    const failedSoft = run([...base, { type: 'outcome', outcome: { kind: 'failed', code: 'TIMEOUT', message: 'm', retryable: true } }, { type: 'retry', at: 2 }]);
    expect(failedSoft.phase).toBe('waiting');
    expect(run([...base, { type: 'outcome', outcome: { kind: 'unavailable', reason: 'sem servidor' } }]).phase).toBe('unavailable');
  });
  it('the lab is entered only from review and returns to review', () => {
    const s = run([{ type: 'select', input: file }, { type: 'submit', at: 1 }, { type: 'outcome', outcome: { kind: 'observation', observation: reconstructionFixture(), provenance: { mode: 'demo', scenario: 'observation' } } }, { type: 'open_lab' }, { type: 'lab_ready' }, { type: 'back_to_review' }]);
    expect(s.phase).toBe('review');
    expect(run([{ type: 'open_lab' }]).phase).toBe('empty');
  });
});

describe('review: correction, unknown properties, gates', () => {
  const obs = reconstructionFixture();
  it('correcting keeps the original interpretation and is labelled as the person\'s', () => {
    const r = reduceReview(initialReview(obs), { type: 'correct', id: 'e_bucket_cyl', correction: { kind: 'unknown', label: 'Tubagem hidráulica' } });
    const item = r.items.find((i) => i.id === 'e_bucket_cyl')!;
    expect(labCategory(item)).toBe('corrected');
    expect(item.label).toBe('Cilindro da caçamba');
    expect(item.status).toBe('hypothesis');
    expect(item.correction).toEqual({ kind: 'unknown', label: 'Tubagem hidráulica' });
  });
  it('an unknown property can take a value from a person, labelled and never confirmed; observed values cannot be overwritten', () => {
    let r = reduceReview(initialReview(obs), { type: 'enter_property', id: 'e_counterweight', name: 'massa', value: '3800 kg' });
    const p = r.items.find((i) => i.id === 'e_counterweight')!.properties.find((x) => x.name === 'massa')!;
    expect(propertyState(p)).toBe('entered');
    expect(p.status).toBe('unknown');
    r = reduceReview(r, { type: 'enter_property', id: 'e_boom', name: 'comprimento entre pinos', value: '9999 mm' });
    expect(r.items.find((i) => i.id === 'e_boom')!.properties.find((x) => x.name === 'comprimento entre pinos')!.value).toBe('5400 mm');
  });
  it('reports insufficient data when the structure for a valid assembly is missing', () => {
    const r = initialReview(insufficientObservation());
    const rd = readiness(r);
    expect(rd.status).toBe('insufficient');
    if (rd.status === 'insufficient') expect(rd.missing).toEqual(['material circulante', 'corpo superior', 'lança', 'braço']);
  });
  it('rejecting a required part makes the reconstruction insufficient; correcting to the right kind can satisfy it', () => {
    let r = initialReview(obs);
    for (const id of ['e_boom_cyl', 'e_stick_cyl', 'e_bucket_cyl']) r = reduceReview(r, { type: 'decide', id, decision: 'confirmed' });
    r = reduceReview(r, { type: 'decide', id: 'e_stick', decision: 'rejected' });
    expect(readiness(r)).toEqual({ status: 'insufficient', missing: ['braço'] });
    r = reduceReview(r, { type: 'correct', id: 'e_linkage', correction: { kind: 'stick', label: 'Braço (corrigido)' } });
    expect(readiness(r).status).toBe('ready_for_engine');
  });
  it('human review never claims engineering validity', () => {
    let r = initialReview(obs);
    for (const id of ['e_boom_cyl', 'e_stick_cyl', 'e_bucket_cyl']) r = reduceReview(r, { type: 'decide', id, decision: 'confirmed' });
    expect(readiness(r).status).toBe('ready_for_engine');
    expect(ENGINE_GATE_LABEL.not_run).toMatch(/motor/);
    expect(summarize(r).confirmed).toBe(3);
  });
});
