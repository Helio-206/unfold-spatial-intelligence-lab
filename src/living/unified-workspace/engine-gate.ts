import { validateMotionFrame, type Assembly } from '../contracts';
import { assemblyDigest, closeEngineeringSession, createEngineeringSession, sampleEngineeringMotion } from '../engineering';
import type { EngineGate } from '../experience/review';

/**
 * Gate 2. Structural validity (the assembly passed `validateAssembly` and the reviewed contract) is NOT this.
 * This asks the Engineering Engine to solve the reference pose of exactly this assembly and checks the frame it returns.
 * `valid` means "the solver closed the reference pose"; it is not a safety, strength or collision certification.
 */
export type EngineVerdict = Extract<EngineGate, { status: 'valid' | 'blocked' }>;

export function validateWithEngine(assembly: Assembly): EngineVerdict {
  let session: ReturnType<typeof createEngineeringSession> | null = null;
  try {
    session = createEngineeringSession(assembly);
    const frame = sampleEngineeringMotion(session, 0);
    const shape = validateMotionFrame(frame);
    if (!shape.ok) return { status: 'blocked', reasons: shape.issues.slice(0, 3).map((i) => `quadro inválido: ${i.path}`) };
    if (frame.assemblyId !== assembly.id || frame.assemblyDigest !== assemblyDigest(assembly)) return { status: 'blocked', reasons: ['o quadro do motor não corresponde a esta montagem'] };
    if (frame.status !== 'ok' || frame.solver.status !== 'solved') return { status: 'blocked', reasons: [frame.blocked ? `${frame.blocked.code}: ${frame.blocked.message}` : `o motor não resolveu a pose de referência (${frame.solver.status})`] };
    if (frame.parts.length !== assembly.parts.length) return { status: 'blocked', reasons: ['o quadro do motor não cobre todas as peças'] };
    return { status: 'valid', solverId: `${frame.solver.id}@${frame.solver.version}` };
  } catch (error) {
    return { status: 'blocked', reasons: [`o motor recusou a montagem: ${error instanceof Error ? error.message : 'erro desconhecido'}`] };
  } finally { if (session) closeEngineeringSession(session); }
}
