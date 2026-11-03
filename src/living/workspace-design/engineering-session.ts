import { validateMotionFrame, type Assembly, type MotionFrame } from '../contracts';
import { advance, assemblyDigest, closeEngineeringSession, commandMove, createEngineeringSession, createPlayback, evaluateParameterChange, pause, play, sampleEngineeringMotion, seek, type EngineeringSession, type ParameterPatch, type Playback } from '../engineering';

type Refusal = { ok: false; code: string; message: string };
type Preview = { ok: true; token: string; startS: number; durationS: number; final: MotionFrame } | Refusal;

/** Owns the approved engineering session. A preview cannot change the current session or pose. */
export class WorkspaceEngineeringSession {
  private session: EngineeringSession;
  private playback: Playback;
  private pending: { token: string; session: EngineeringSession; startS: number } | null = null;
  private previous: { session: EngineeringSession; playback: Playback } | null = null;
  private generation = 0;
  private disposed = false;

  private readonly assembly: Assembly;

  constructor(assembly: Assembly) {
    this.assembly = structuredClone(assembly);
    this.session = createEngineeringSession(this.assembly);
    this.playback = createPlayback(this.session);
  }

  private check(frame: MotionFrame, assembly: Assembly = this.session.assembly): MotionFrame {
    const validation = validateMotionFrame(frame);
    if (!validation.ok) throw new Error(`ENGINE_FRAME_INVALID: ${validation.issues[0]?.path}`);
    if (frame.assemblyId !== assembly.id || frame.assemblyDigest !== assemblyDigest(assembly) || frame.worldFrameId !== assembly.root.frameId) throw new Error('ENGINE_FRAME_INCOMPATIBLE');
    if (frame.parts.length) {
      const expected = new Set(assembly.parts.map((part) => part.id));
      const actual = new Set(frame.parts.map((part) => part.partId));
      if (actual.size !== frame.parts.length || actual.size !== expected.size || [...actual].some((id) => !expected.has(id))) throw new Error('ENGINE_FRAME_PARTS_MISMATCH');
    }
    return frame;
  }

  private assertOpen(): void { if (this.disposed) throw new Error('ENGINE_SESSION_CLOSED'); }
  private discardPending(): void { if (this.pending) closeEngineeringSession(this.pending.session); this.pending = null; }
  private finishPrevious(): void { if (this.previous) closeEngineeringSession(this.previous.session); this.previous = null; }

  frame(): MotionFrame {
    this.assertOpen();
    return this.check(sampleEngineeringMotion(this.session, this.playback.timeS));
  }

  state(): { timeS: number; durationS: number; playing: boolean } {
    return { timeS: this.playback.timeS, durationS: this.session.durationS, playing: this.playback.playing };
  }

  preview(actuatorId: string, value: number): Preview {
    if (this.disposed) return { ok: false, code: 'SESSION_CLOSED', message: 'Sessão encerrada.' };
    this.discardPending();
    if (this.playback.timeS < this.session.durationS) return { ok: false, code: 'SESSION_BUSY', message: 'Conclua ou reponha a experiência actual.' };
    const result = commandMove(this.session, { targets: { [actuatorId]: value } });
    if (!result.ok) return result;
    let final: MotionFrame;
    try { final = this.check(sampleEngineeringMotion(result.session, result.session.durationS)); }
    catch (error) { closeEngineeringSession(result.session); throw error; }
    const token = String(++this.generation);
    this.pending = { token, session: result.session, startS: result.startS };
    return { ok: true, token, startS: result.startS, durationS: result.durationS, final };
  }

  /** Compare a hypothetical parameter patch without accepting it or changing the current session. */
  compareParameter(patch: ParameterPatch): { ok: true; before: MotionFrame; after: MotionFrame; maxPartDisplacementM: number | null } | Refusal {
    if (this.disposed) return { ok: false, code: 'SESSION_CLOSED', message: 'Sessão encerrada.' };
    if (this.playback.timeS < this.session.durationS) return { ok: false, code: 'SESSION_BUSY', message: 'Conclua ou reponha a experiência actual.' };
    const result = evaluateParameterChange(this.session, patch);
    if (!result.ok) return result;
    try {
      const before = this.check(result.before); const after = this.check(result.after, result.session.assembly);
      return { ok: true, before, after, maxPartDisplacementM: result.maxPartDisplacementM };
    } finally { closeEngineeringSession(result.session); }
  }

  approve(token: string): { ok: true } | Refusal {
    if (this.disposed || !this.pending || this.pending.token !== token) return { ok: false, code: 'PROPOSAL_STALE', message: 'A proposta já não está disponível.' };
    const pending = this.pending; this.pending = null;
    this.previous = { session: this.session, playback: this.playback };
    this.session = pending.session;
    this.playback = play(seek(createPlayback(this.session), pending.startS));
    return { ok: true };
  }

  reject(token: string): void { if (this.pending?.token === token) this.discardPending(); }

  pause(): void { this.assertOpen(); this.playback = pause(this.playback); }
  resume(): void { this.assertOpen(); this.playback = play(this.playback); }
  seek(timeS: number): void { this.assertOpen(); const next = seek(this.playback, timeS); if (next.timeS !== this.playback.timeS) this.discardPending(); this.playback = next; if (next.timeS >= this.session.durationS) this.finishPrevious(); }
  advance(dtS: number): void { this.assertOpen(); this.playback = advance(this.playback, dtS); if (this.playback.timeS >= this.session.durationS) this.finishPrevious(); }
  cancel(): void {
    this.discardPending();
    if (!this.previous) return;
    closeEngineeringSession(this.session);
    this.session = this.previous.session; this.playback = pause(this.previous.playback); this.previous = null;
  }
  reset(): void {
    if (this.disposed) return;
    this.discardPending(); this.finishPrevious();
    closeEngineeringSession(this.session);
    this.session = createEngineeringSession(this.assembly);
    this.playback = createPlayback(this.session); this.pending = null; this.previous = null; this.generation += 1;
  }
  dispose(): void { if (!this.disposed) { this.disposed = true; this.discardPending(); this.finishPrevious(); closeEngineeringSession(this.session); } }
}
