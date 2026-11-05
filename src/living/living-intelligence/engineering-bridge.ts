/** Ponte estreita para o motor verificado: só reexporta a API pública de `src/living/engineering`. */
export {
  evaluateActuators, evaluateConfiguration, evaluateReferencePose, CLOSURE_TOLERANCE_M,
  referenceConfiguration, solveForwardKinematics, jointLimitViolations,
  createEngineeringSession, evaluateParameterChange, closeEngineeringSession,
  type EngineeringSession, type ParameterPatch,
} from '../engineering';
export { loopResiduals } from '../engineering/forward-kinematics';
