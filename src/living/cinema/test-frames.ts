import { EXCAVATOR_ASSEMBLY_V1 } from '../contracts/fixtures/excavator.assembly.v1';
import referencePose from '../contracts/fixtures/excavator.reference-pose.json';
import type { MotionFrame } from '../contracts';
import { referencePartsFrom } from './pose-source';

/**
 * Transport test frames for the playback pipeline (debug only, loaded with `?debug-cinema`). They are NOT engine output and contain no kinematics:
 * three valid `unfold.motion-frame.v1` records that all carry the reference pose, to prove that validation, timing, status display and the
 * blocked/held-pose path work end to end in the browser. Real motion arrives from the engineering engine.
 */
const hex = (c: string) => c.repeat(64).slice(0, 64);
export function transportTestFrames(): MotionFrame[] {
  const parts = referencePartsFrom(referencePose);
  const base = { schema: 'unfold.motion-frame.v1', assemblyId: EXCAVATOR_ASSEMBLY_V1.id, assemblyDigest: hex('a'), worldFrameId: 'world', parts, joints: [], actuators: [], measurements: [], collisions: { checked: false, shapesChecked: [], shapesSkipped: [], groundPlaneChecked: false, contacts: [] }, evidence: [] } as const;
  const solver = (status: 'solved' | 'blocked') => ({ id: 'transport-test', version: '0', method: 'repetição da pose de referência (sem cinemática)', status, closureResidualM: null, toleranceM: 1e-6, assumptions: ['Quadros de teste de transporte: não são saída do motor.'] });
  return [
    { ...base, inputDigest: hex('1'), index: 0, timestampS: 0, status: 'ok', poseBasis: 'solved', solver: solver('solved'), warnings: [], blocked: null },
    { ...base, inputDigest: hex('2'), index: 1, timestampS: 2, status: 'ok', poseBasis: 'solved', solver: solver('solved'), warnings: [{ code: 'TRANSPORT_TEST', severity: 'info', message: 'Quadros de teste de transporte, sem movimento.', subjectIds: [] }], blocked: null },
    { ...base, inputDigest: hex('3'), index: 2, timestampS: 4, status: 'blocked', poseBasis: 'held_last_valid', solver: solver('blocked'), warnings: [], blocked: { code: 'TRANSPORT_TEST_BLOCKED', message: 'Quadro bloqueado de teste: a pose mostrada é a última válida.', subjectIds: [], firstInvalidTimeS: 3.5 } },
  ] as unknown as MotionFrame[];
}
