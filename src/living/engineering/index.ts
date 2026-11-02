/**
 * API pública do motor de engenharia. Os visuais e o cinema consomem os quadros daqui; não resolvem relações de engenharia.
 */
export { evaluateConfiguration, evaluateActuators, evaluateReferencePose, assemblyDigest, CLOSURE_TOLERANCE_M, ENGINE_ID, ENGINE_VERSION } from './engine';
export { referenceConfiguration, solveForwardKinematics, validateConfiguration, jointLimitViolations, EngineInputError, type Configuration } from './forward-kinematics';
export { solveActuatorConfiguration, type SolveOutcome, type SolverWarning } from './actuator-solver';
export {
  createEngineeringSession, commandMove, sampleEngineeringMotion, sessionDurationS, closeEngineeringSession, evaluateParameterChange,
  createPlayback, play, pause, seek, advance, samplePlayback,
  type EngineeringSession, type MoveCommand, type MoveResult, type ParameterPatch, type ParameterResult, type Playback,
} from './runtime';
export { primitiveCollisionBackend, boxesOverlap, type CollisionBackend, type CollisionInput, type CollisionReport } from './collision';
export { quatAngle, rigidFromPose, applyRigid, composeRigid, type Rigid } from './transform-math';
