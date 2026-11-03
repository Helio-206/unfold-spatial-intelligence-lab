import { EXCAVATOR_ASSEMBLY_V1 } from '../contracts/fixtures/excavator.assembly.v1';
import scenarioRaw from '../engineering/fixtures/excavator.scenario.motion-sequence.json';
import { assemblyDigest } from '../engineering';
import type { Assembly, MotionFrame } from '../contracts';
import { createEngineSessionSource, engineScenarioSession } from './engine-pose-source';
import { MotionFramePlayer, ReferencePoseSource, StaticFrameSource, referencePartsFrom, type PoseSource } from './pose-source';
import referencePose from '../contracts/fixtures/excavator.reference-pose.json';

/**
 * The motion the cinema can show, every one of them either computed by the engineering engine or the declared reference pose:
 *  - `engine`:   the demonstration scenario commanded on a live engineering session; `sample(t)` is `sampleEngineeringMotion` at exactly `t`.
 *  - `sequence`: the 13 ok frames of the exported scenario (`excavator.scenario.motion-sequence.json`, 15 frames in all), replayed with presentation blending
 *                BETWEEN valid ok frames only; every blended sample says so and carries no measurement.
 *  - `blocked-curso`, `blocked-colisao`: the two blocked examples of the same export, shown one by one as the engine produced them (they sit at t = 0 in the
 *                export, so they are not part of a timeline).
 *  - `reference`: the reference pose.
 * The expected assembly (id, digest of the effective assembly, world frame, part ids) is checked for every one before it can be shown.
 */
export type MotionKey = 'engine' | 'sequence' | 'blocked-curso' | 'blocked-colisao' | 'reference';
export const MOTION_LABEL: Record<MotionKey, string> = {
  engine: 'Motor: cenário em direto', sequence: 'Sequência exportada (13 quadros ok)', 'blocked-curso': 'Bloqueado: curso acima do máximo', 'blocked-colisao': 'Bloqueado: colisão com o chão', reference: 'Pose de referência',
};
type Payload = { schema: string; assemblyId: string; frames: Array<{ label: string; frame: MotionFrame }> };

export function exportedScenario(): Payload { return scenarioRaw as unknown as Payload; }

export function createMotionSources(assembly: Assembly = EXCAVATOR_ASSEMBLY_V1): Record<MotionKey, () => PoseSource> {
  const expect = { assemblyId: assembly.id, assemblyDigest: assemblyDigest(assembly), worldFrameId: assembly.root.frameId, partIds: assembly.parts.map((p) => p.id) };
  const payload = exportedScenario(); const frames = payload.frames.map((f) => f.frame);
  const ok = frames.filter((f) => f.status === 'ok'); const blocked = frames.filter((f) => f.status === 'blocked');
  return {
    engine: () => { const { session, durationS } = engineScenarioSession(); return createEngineSessionSource(session, durationS, assembly); },
    sequence: () => new MotionFramePlayer(dedupeInstants(ok), { ...expect, interpolation: 'blend' }),
    'blocked-curso': () => new StaticFrameSource(blocked[0], expect),
    'blocked-colisao': () => new StaticFrameSource(blocked[1], expect),
    reference: () => new ReferencePoseSource(assembly.id, referencePartsFrom(referencePose)),
  };
}

/** Several frames of the export share an instant (the end of one command is the start of the next). At an instant shared by frames, the LAST one is kept: it is the state after the command. */
function dedupeInstants(frames: MotionFrame[]): MotionFrame[] {
  const byTime = new Map<number, MotionFrame>(); for (const f of frames) byTime.set(f.timestampS, f);
  return [...byTime.values()];
}
