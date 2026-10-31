import { solveFourBar, type AssemblyBranch, type FourBarLengths, type FourBarResult, type Point } from './kinematics';

export const PHASE4A_LENGTHS: FourBarLengths = {
  ground: 100,
  crank: 40,
  coupler: 120,
  rocker: 90,
};

export const PHASE4A_EVIDENCE_STATUS = 'hypothetical_user_design' as const;

export type Phase4AParameterProvenance = {
  source: 'user_provided';
  evidenceStatus: typeof PHASE4A_EVIDENCE_STATUS;
  physicallyVerified: false;
};

export const PHASE4A_PARAMETER_PROVENANCE: Record<keyof FourBarLengths, Phase4AParameterProvenance> = {
  ground: { source: 'user_provided', evidenceStatus: PHASE4A_EVIDENCE_STATUS, physicallyVerified: false },
  crank: { source: 'user_provided', evidenceStatus: PHASE4A_EVIDENCE_STATUS, physicallyVerified: false },
  coupler: { source: 'user_provided', evidenceStatus: PHASE4A_EVIDENCE_STATUS, physicallyVerified: false },
  rocker: { source: 'user_provided', evidenceStatus: PHASE4A_EVIDENCE_STATUS, physicallyVerified: false },
};

export function solvePhase4A(angleDegrees: number, branch: AssemblyBranch = 'plus'): FourBarResult {
  return solveFourBar({
    lengths: { ...PHASE4A_LENGTHS },
    inputAngleRad: angleDegrees * Math.PI / 180,
    branch,
  });
}

export function scenePoint(point: Point, scale = 0.045): { x: number; y: number; z: number } {
  return { x: point.x * scale, y: 0, z: -point.y * scale };
}

export function maxResidual(result: FourBarResult): number | undefined {
  return result.residuals?.maxLengthErrorMm;
}
