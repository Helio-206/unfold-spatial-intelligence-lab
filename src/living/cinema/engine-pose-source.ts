import { validateMotionFrame, type Assembly, type MotionFrame } from '../contracts';
import { EXCAVATOR_ASSEMBLY_V1 } from '../contracts/fixtures/excavator.assembly.v1';
import { assemblyDigest, commandMove, createEngineeringSession, sampleEngineeringMotion, sessionDurationS, type EngineeringSession } from '../engineering';
import { SCENARIO_STEPS } from '../engineering/scenario';
import { poseSampleFromFrame, type PoseSample, type PoseSource } from './pose-source';

/**
 * Pose source backed by an engineering session (`src/living/engineering`): `sample(t)` IS `sampleEngineeringMotion(session, t)`, a pure function of the
 * instant. The cinema does not blend, resample or smooth these frames (the Visual Foundry's rule 1); each one is validated before it reaches the stage,
 * and an invalid frame is an error, never a half-applied pose.
 */
export class EngineFrameRejected extends Error {
  constructor(readonly path: string, message: string) { super(`Quadro do motor recusado: ${path} ${message}`); this.name = 'EngineFrameRejected'; }
}

export function createEngineSessionSource(session: EngineeringSession, durationS: number, assembly: Assembly = EXCAVATOR_ASSEMBLY_V1): PoseSource {
  const assemblyId = assembly.id; const digest = assemblyDigest(assembly);
  return {
    kind: 'engine-session', assemblyId, durationS,
    sample(timeS: number): PoseSample {
      const t = Math.min(Math.max(timeS, 0), durationS);
      const frame: MotionFrame = sampleEngineeringMotion(session, t);
      const check = validateMotionFrame(frame);
      if (!check.ok) throw new EngineFrameRejected(check.issues[0]!.path, check.issues[0]!.message);
      if (frame.assemblyId !== assemblyId) throw new EngineFrameRejected('$.assemblyId', `é da montagem «${frame.assemblyId}», não de «${assemblyId}».`);
      if (frame.assemblyDigest !== digest) throw new EngineFrameRejected('$.assemblyDigest', 'não corresponde à montagem efectiva em cena.');
      if (frame.worldFrameId !== assembly.root.frameId) throw new EngineFrameRejected('$.worldFrameId', `«${frame.worldFrameId}» não é o referencial da montagem.`);
      return poseSampleFromFrame(frame);
    },
  };
}

/** The demonstration scenario of the engine (raise boom, extend stick, curl bucket, swing), commanded step by step; every step must be accepted. */
export function engineScenarioSession(): { session: EngineeringSession; durationS: number } {
  let session = createEngineeringSession(EXCAVATOR_ASSEMBLY_V1);
  for (const [label, targets] of SCENARIO_STEPS) {
    const result = commandMove(session, { targets });
    if (!result.ok) throw new Error(`Comando «${label}» recusado pelo motor: ${result.code} ${result.message}`);
    session = result.session;
  }
  return { session, durationS: sessionDurationS(session) };
}
