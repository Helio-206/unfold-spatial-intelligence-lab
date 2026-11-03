import { describe, expect, it, vi } from 'vitest';
import { classifyObservation } from '../../src/living/experience/intake';
import { createReconstructionClient, LiveReconstructionPort, outcomeFromFailure, prepareImage, TranscodeError } from '../../src/living/unified-workspace';
import { PNG_1X1, json, observation, proposalBody } from './helpers';

const WEBP = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
const image = (over = {}) => ({ kind: 'image' as const, name: 'foto.png', size: 100, mime: 'image/png', dataUrl: PNG_1X1, ...over });
function portWith(responder: (body: any, init: RequestInit) => Response | Promise<Response>, transcode?: (d: string) => Promise<string>) {
  const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => responder(JSON.parse(init!.body as string), init!));
  const port = new LiveReconstructionPort({ client: createReconstructionClient({ fetchImpl: fetchImpl as unknown as typeof fetch }), transcode });
  return { port, fetchImpl };
}
const live = (extra: Record<string, unknown> = {}) => ({ ...proposalBody(), mode: 'live', meta: { model: 'muse-spark-1.3', requestId: 'req-1' }, ...extra });

describe('LiveReconstructionPort', () => {
  it('is a live port and always asks the server for mode live', async () => {
    const { port, fetchImpl } = portWith(() => json(200, live()));
    expect(port.mode).toBe('live');
    await port.submit(image(), new AbortController().signal);
    expect(JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string)).toMatchObject({ mode: 'live', sourceKind: 'image', sourceReference: 'foto.png' });
  });

  it('returns the observation with live provenance (model, request id) and the server session id', async () => {
    const { port } = portWith(() => json(200, live()));
    const outcome = await port.submit(image(), new AbortController().signal);
    if (outcome.kind !== 'observation') throw new Error(outcome.kind);
    expect(outcome.provenance).toEqual({ mode: 'live', model: 'muse-spark-1.3', requestId: 'req-1' });
    expect(outcome.sessionId).toBe('session-test-1');
    expect(outcome.observation).toEqual(observation());
  });

  it('maps drawings and text to their source kinds', async () => {
    const { port, fetchImpl } = portWith(() => json(200, live()));
    await port.submit(image({ kind: 'drawing' }), new AbortController().signal);
    await port.submit({ kind: 'text', text: 'Escavadora de rastos com caçamba' }, new AbortController().signal);
    expect(fetchImpl.mock.calls.map((c) => JSON.parse(c[1]!.body as string))).toMatchObject([{ sourceKind: 'technical_drawing' }, { sourceKind: 'text', instruction: 'Escavadora de rastos com caçamba', sourceReference: 'user-instruction' }]);
  });

  it('never presents an offline (fixture) answer to a live request as the model', async () => {
    const { port } = portWith(() => json(200, proposalBody()));
    expect(await port.submit(image(), new AbortController().signal)).toMatchObject({ kind: 'failed', code: 'RECONSTRUCTION_INVALID_RESULT' });
  });

  it('classifies an answer with no entities as not identified, with no review session kept for it', async () => {
    const obs = observation(); obs.entities = []; obs.relations = []; obs.dimensions = [];
    const { port } = portWith(() => json(200, live({ observation: obs })));
    const outcome = await port.submit(image(), new AbortController().signal);
    expect(outcome.kind).toBe(classifyObservation(obs, { mode: 'live', model: 'x', requestId: null }).kind);
    expect(outcome.kind).toBe('not_identified');
    expect('sessionId' in outcome).toBe(false);
  });

  it('a generic RECONSTRUCTION_FAILED (what the server answers for a non-excavator source) is a failure, never "not identified"', async () => {
    const { port } = portWith(() => json(502, { error: { code: 'RECONSTRUCTION_FAILED', message: 'A proposta de reconstrução não foi aceite.' } }));
    const outcome = await port.submit(image(), new AbortController().signal);
    expect(outcome).toMatchObject({ kind: 'failed', code: 'RECONSTRUCTION_FAILED', retryable: false });
    if (outcome.kind === 'failed') expect(outcome.message).toMatch(/outra fonte/);
  });

  it.each([
    [503, { error: { code: 'MODEL_API_KEY_MISSING', message: 'x' } }, 'unavailable'],
    [403, { error: { code: 'INVALID_ORIGIN', message: 'x' } }, 'unavailable'],
    [429, { error: { code: 'META_CALL_BUDGET_EXHAUSTED', message: 'x' } }, 'failed'],
    [429, { error: { code: 'RECONSTRUCTION_RATE_LIMITED', message: 'x' } }, 'failed'],
    [502, { error: { code: 'RECONSTRUCTION_SCHEMA_INVALID', message: 'x' } }, 'failed'],
    [503, { error: { code: 'RECONSTRUCTION_SESSION_CAPACITY', message: 'x' } }, 'failed'],
    [400, { error: { code: 'INVALID_RECONSTRUCTION_REFERENCE', message: 'sourceReference inválido.' } }, 'failed'],
  ])('maps HTTP %i %j to %s', async (status, body, kind) => {
    const { port } = portWith(() => json(status as number, body));
    const outcome = await port.submit(image(), new AbortController().signal);
    expect(outcome.kind).toBe(kind);
    if (outcome.kind === 'failed') expect(outcome.code).toBe((body as any).error.code === 'INVALID_RECONSTRUCTION_REFERENCE' ? 'INVALID_INPUT' : (body as any).error.code);
  });

  it('keeps the failure code visible and says whether it can be retried', () => {
    expect(outcomeFromFailure({ kind: 'upstream', status: 502, code: 'RECONSTRUCTION_META_FAILED' })).toMatchObject({ kind: 'failed', code: 'RECONSTRUCTION_META_FAILED', retryable: true });
    expect(outcomeFromFailure({ kind: 'budget_exhausted' })).toMatchObject({ kind: 'failed', retryable: false });
    expect(outcomeFromFailure({ kind: 'network', message: 'tempo esgotado' })).toMatchObject({ code: 'TIMEOUT', retryable: true });
    expect(outcomeFromFailure({ kind: 'network', message: 'fetch failed' })).toMatchObject({ code: 'NETWORK' });
    expect(() => outcomeFromFailure({ kind: 'aborted' })).toThrow(/cancelled/);
  });

  it('cancel aborts the request, rejects with AbortError, and ignores the late answer', async () => {
    let release!: (r: Response) => void;
    const fetchImpl = vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((resolve, reject) => { release = resolve; init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); }));
    const port = new LiveReconstructionPort({ client: createReconstructionClient({ fetchImpl: fetchImpl as unknown as typeof fetch }) });
    const controller = new AbortController();
    const pending = port.submit(image(), controller.signal);
    await Promise.resolve(); await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    release(json(200, live()));
    await Promise.resolve();
    expect(port.session.state.phase).toBe('idle');
  });

  it('does not touch the network when already cancelled', async () => {
    const { port, fetchImpl } = portWith(() => json(200, live()));
    const controller = new AbortController(); controller.abort();
    await expect(port.submit(image(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a source the server would refuse, without sending it', async () => {
    const { port, fetchImpl } = portWith(() => json(200, live()));
    const outcome = await port.submit(image({ dataUrl: 'data:image/gif;base64,AAAA' }), new AbortController().signal);
    expect(outcome.kind).toBe('failed');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('WebP versus the JPEG/PNG API', () => {
  it('passes PNG and JPEG through untouched', async () => {
    const transcode = vi.fn();
    expect(await prepareImage(PNG_1X1, transcode)).toEqual({ dataUrl: PNG_1X1, mime: 'image/png', transcodedFrom: null });
    expect(transcode).not.toHaveBeenCalled();
  });

  it('re-encodes WebP to PNG before it is sent, and the request carries the PNG', async () => {
    const transcode = vi.fn(async () => PNG_1X1);
    const { port, fetchImpl } = portWith(() => json(200, live()), transcode);
    const outcome = await port.submit(image({ name: 'foto.webp', mime: 'image/webp', dataUrl: WEBP }), new AbortController().signal);
    expect(outcome.kind).toBe('observation');
    expect(transcode).toHaveBeenCalledWith(WEBP, expect.anything());
    expect(JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string).imageDataUrl).toBe(PNG_1X1);
  });

  it.each([
    ['conversion yields something else', async () => 'data:image/jpeg;base64,AAAA'],
    ['conversion throws', async () => { throw new TranscodeError('não foi possível descodificar o WebP'); }],
  ])('reports a clear failure when %s, and sends nothing', async (_n, transcode) => {
    const { port, fetchImpl } = portWith(() => json(200, live()), transcode);
    const outcome = await port.submit(image({ name: 'foto.webp', mime: 'image/webp', dataUrl: WEBP }), new AbortController().signal);
    expect(outcome).toMatchObject({ kind: 'failed', code: 'IMAGE_CONVERSION_FAILED', retryable: false });
    if (outcome.kind === 'failed') expect(outcome.message).toMatch(/PNG ou JPEG/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a converted PNG that exceeds the API limits instead of sending it', async () => {
    const huge = (() => { const b = Uint8Array.from(atob(PNG_1X1.split(',')[1]!), (c) => c.charCodeAt(0)); new DataView(b.buffer).setUint32(16, 12000); let s = ''; b.forEach((x) => { s += String.fromCharCode(x); }); return `data:image/png;base64,${btoa(s)}`; })();
    const { port, fetchImpl } = portWith(() => json(200, live()), async () => huge);
    const outcome = await port.submit(image({ name: 'x.webp', mime: 'image/webp', dataUrl: WEBP }), new AbortController().signal);
    expect(outcome).toMatchObject({ kind: 'failed', code: 'INVALID_INPUT' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
