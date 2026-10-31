/**
 * Deterministic planar four-bar solver.
 *
 * Coordinate convention: fixedPivotA is (0, 0), fixedPivotB is
 * (ground, 0), and the input crank angle is measured counter-clockwise
 * from the positive x axis. The assembly branch is the sign of the
 * circle-intersection perpendicular; it is deliberately not labelled
 * "open" or "crossed", because those names depend on the mechanism view.
 */

export type BarName = 'ground' | 'crank' | 'coupler' | 'rocker';
export type AssemblyBranch = 'plus' | 'minus';
export type FourBarStatus = 'solved' | 'singular' | 'impossible' | 'degenerate';
export type GrashofClass = 'grashof' | 'change-point' | 'non-grashof';
export type FixedBarBehavior = 'double-crank' | 'crank-rocker' | 'double-rocker' | 'ambiguous' | 'not-applicable';

export type FourBarLengths = Record<BarName, number>;

export type NumericTolerance = {
  absoluteMm: number;
  relative: number;
};

export const DEFAULT_TOLERANCE: NumericTolerance = {
  absoluteMm: 1e-9,
  relative: 1e-12,
};

export type FourBarInput = {
  lengths: FourBarLengths;
  inputAngleRad: number;
  branch: AssemblyBranch;
  tolerance?: Partial<NumericTolerance>;
};

export type Point = { x: number; y: number };

export type FourBarCoordinates = {
  fixedPivotA: Point;
  fixedPivotB: Point;
  crankCouplerJoint: Point;
  couplerRockerJoint: Point;
};

export type FourBarResiduals = {
  groundLengthErrorMm: number;
  crankLengthErrorMm: number;
  couplerLengthErrorMm: number;
  rockerLengthErrorMm: number;
  closureVectorMm: Point;
  closureResidualMm: number;
  maxLengthErrorMm: number;
};

export type GrashofAnalysis = {
  classification: GrashofClass;
  fixedBarBehavior: FixedBarBehavior;
  shortestBar: BarName;
  longestBar: BarName;
  sortedBars: BarName[];
  inequality: { shortestPlusLongest: number; otherTwo: number };
};

export type FourBarResult = {
  status: FourBarStatus;
  branch: AssemblyBranch;
  inputAngleRad: number;
  lengths: FourBarLengths;
  tolerance: NumericTolerance;
  grashof: GrashofAnalysis;
  coordinates?: FourBarCoordinates;
  residuals?: FourBarResiduals;
  reason?: string;
};

export class KinematicsInputError extends Error {
  readonly code = 'INVALID_INPUT';

  constructor(message: string) {
    super(message);
    this.name = 'KinematicsInputError';
  }
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function resolveTolerance(input?: Partial<NumericTolerance>): NumericTolerance {
  const tolerance = { ...DEFAULT_TOLERANCE, ...input };
  if (!Number.isFinite(tolerance.absoluteMm) || tolerance.absoluteMm <= 0 || !Number.isFinite(tolerance.relative) || tolerance.relative <= 0) {
    throw new KinematicsInputError('Tolerâncias devem ser finitas e positivas.');
  }
  return tolerance;
}

function validateInput(input: FourBarInput): void {
  if (!Number.isFinite(input.inputAngleRad)) {
    throw new KinematicsInputError('O ângulo de entrada deve ser finito.');
  }
  if (input.branch !== 'plus' && input.branch !== 'minus') {
    throw new KinematicsInputError('O ramo de montagem deve ser plus ou minus.');
  }
  for (const bar of ['ground', 'crank', 'coupler', 'rocker'] as const) {
    const length = input.lengths[bar];
    if (!Number.isFinite(length) || length <= 0) {
      throw new KinematicsInputError(`Comprimento inválido para ${bar}: deve ser finito e maior que zero.`);
    }
  }
}

export function classifyGrashof(lengths: FourBarLengths, tolerance: NumericTolerance = DEFAULT_TOLERANCE): GrashofAnalysis {
  const bars = (Object.keys(lengths) as BarName[]).sort((a, b) => lengths[a] - lengths[b]);
  const shortestBar = bars[0]!;
  const longestBar = bars[3]!;
  const shortestPlusLongest = lengths[shortestBar] + lengths[longestBar];
  const otherTwo = lengths[bars[1]!] + lengths[bars[2]!];
  const scale = Math.max(...Object.values(lengths));
  const comparisonTolerance = Math.max(tolerance.absoluteMm, tolerance.relative * scale);
  const difference = shortestPlusLongest - otherTwo;
  const classification: GrashofClass = difference < -comparisonTolerance
    ? 'grashof'
    : Math.abs(difference) <= comparisonTolerance
      ? 'change-point'
      : 'non-grashof';

  let fixedBarBehavior: FixedBarBehavior = 'not-applicable';
  if (classification === 'grashof') {
    if (shortestBar === 'ground') fixedBarBehavior = 'double-crank';
    else if (longestBar === 'ground') fixedBarBehavior = 'double-rocker';
    else if (shortestBar === 'crank' || shortestBar === 'rocker') fixedBarBehavior = 'crank-rocker';
    else fixedBarBehavior = 'ambiguous';
  } else if (classification === 'change-point') {
    fixedBarBehavior = 'ambiguous';
  }

  return {
    classification,
    fixedBarBehavior,
    shortestBar,
    longestBar,
    sortedBars: bars,
    inequality: { shortestPlusLongest, otherTwo },
  };
}

function resultWithoutCoordinates(
  input: FourBarInput,
  tolerance: NumericTolerance,
  grashof: GrashofAnalysis,
  status: 'impossible' | 'degenerate',
  reason: string,
): FourBarResult {
  return { status, branch: input.branch, inputAngleRad: input.inputAngleRad, lengths: { ...input.lengths }, tolerance, grashof, reason };
}

export function solveFourBar(input: FourBarInput): FourBarResult {
  validateInput(input);
  const tolerance = resolveTolerance(input.tolerance);
  const lengths = { ...input.lengths };
  const grashof = classifyGrashof(lengths, tolerance);
  const fixedPivotA: Point = { x: 0, y: 0 };
  const fixedPivotB: Point = { x: lengths.ground, y: 0 };
  const crankCouplerJoint: Point = {
    x: lengths.crank * Math.cos(input.inputAngleRad),
    y: lengths.crank * Math.sin(input.inputAngleRad),
  };
  const dx = fixedPivotB.x - crankCouplerJoint.x;
  const dy = fixedPivotB.y - crankCouplerJoint.y;
  const centerDistance = Math.hypot(dx, dy);
  const scale = Math.max(...Object.values(lengths));
  const lengthTolerance = Math.max(tolerance.absoluteMm, tolerance.relative * scale);

  if (centerDistance <= lengthTolerance) {
    if (Math.abs(lengths.coupler - lengths.rocker) <= lengthTolerance) {
      return resultWithoutCoordinates(input, tolerance, grashof, 'degenerate', 'Os centros das duas circunferências coincidem; não existe uma intersecção única.');
    }
    return resultWithoutCoordinates(input, tolerance, grashof, 'impossible', 'Os centros coincidem, mas os raios são diferentes.');
  }

  const minimumDistance = Math.abs(lengths.coupler - lengths.rocker);
  const maximumDistance = lengths.coupler + lengths.rocker;
  if (centerDistance > maximumDistance + lengthTolerance || centerDistance < minimumDistance - lengthTolerance) {
    return resultWithoutCoordinates(input, tolerance, grashof, 'impossible', 'A distância entre os centros está fora do intervalo de intersecção das duas circunferências.');
  }

  const alongCenterLine = (lengths.coupler ** 2 - lengths.rocker ** 2 + centerDistance ** 2) / (2 * centerDistance);
  const heightSquared = lengths.coupler ** 2 - alongCenterLine ** 2;
  const heightToleranceSquared = lengthTolerance * Math.max(1, scale);
  if (heightSquared < -heightToleranceSquared) {
    return resultWithoutCoordinates(input, tolerance, grashof, 'impossible', 'A intersecção das circunferências não é real.');
  }

  const base: Point = {
    x: crankCouplerJoint.x + alongCenterLine * dx / centerDistance,
    y: crankCouplerJoint.y + alongCenterLine * dy / centerDistance,
  };
  const height = Math.sqrt(Math.max(0, heightSquared));
  const sign = input.branch === 'plus' ? 1 : -1;
  const couplerRockerJoint: Point = {
    x: base.x + sign * height * (-dy / centerDistance),
    y: base.y + sign * height * (dx / centerDistance),
  };
  const coordinates = { fixedPivotA, fixedPivotB, crankCouplerJoint, couplerRockerJoint };
  const residuals = calculateResiduals(coordinates, lengths);
  const status: FourBarStatus = heightSquared <= heightToleranceSquared ? 'singular' : 'solved';

  return {
    status,
    branch: input.branch,
    inputAngleRad: input.inputAngleRad,
    lengths,
    tolerance,
    grashof,
    coordinates,
    residuals,
    ...(status === 'singular' ? { reason: 'As circunferências são tangentes; os dois ramos convergem numa configuração de toggle.' } : {}),
  };
}

export function calculateResiduals(coordinates: FourBarCoordinates, lengths: FourBarLengths): FourBarResiduals {
  const ground = distance(coordinates.fixedPivotA, coordinates.fixedPivotB);
  const crank = distance(coordinates.fixedPivotA, coordinates.crankCouplerJoint);
  const coupler = distance(coordinates.crankCouplerJoint, coordinates.couplerRockerJoint);
  const rocker = distance(coordinates.couplerRockerJoint, coordinates.fixedPivotB);
  const closureVector: Point = {
    x: (coordinates.crankCouplerJoint.x - coordinates.fixedPivotA.x)
      + (coordinates.couplerRockerJoint.x - coordinates.crankCouplerJoint.x)
      + (coordinates.fixedPivotB.x - coordinates.couplerRockerJoint.x)
      + (coordinates.fixedPivotA.x - coordinates.fixedPivotB.x),
    y: (coordinates.crankCouplerJoint.y - coordinates.fixedPivotA.y)
      + (coordinates.couplerRockerJoint.y - coordinates.crankCouplerJoint.y)
      + (coordinates.fixedPivotB.y - coordinates.couplerRockerJoint.y)
      + (coordinates.fixedPivotA.y - coordinates.fixedPivotB.y),
  };
  const errors = [
    Math.abs(ground - lengths.ground),
    Math.abs(crank - lengths.crank),
    Math.abs(coupler - lengths.coupler),
    Math.abs(rocker - lengths.rocker),
  ];
  return {
    groundLengthErrorMm: errors[0]!,
    crankLengthErrorMm: errors[1]!,
    couplerLengthErrorMm: errors[2]!,
    rockerLengthErrorMm: errors[3]!,
    closureVectorMm: closureVector,
    closureResidualMm: Math.hypot(closureVector.x, closureVector.y),
    maxLengthErrorMm: Math.max(...errors),
  };
}
