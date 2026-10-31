import type { FourBarLengths } from './kinematics';

export type DemoProject =
  | { status: 'empty' }
  | { status: 'ready'; mechanism: 'four-bar'; evidenceStatus: 'hypothetical_user_design' | 'user_provided' };

export function createEmptyDemoProject(): DemoProject {
  return { status: 'empty' };
}

export function createFourBarDemoProject(source: 'example' | 'manual'): DemoProject {
  return {
    status: 'ready',
    mechanism: 'four-bar',
    evidenceStatus: source === 'example' ? 'hypothetical_user_design' : 'user_provided',
  };
}

export type ManualFourBarParameters = { lengths: FourBarLengths; angleDegrees: number };
export type ManualFourBarParseResult = { status: 'valid'; value: ManualFourBarParameters } | { status: 'invalid'; field: string };

export function parseManualFourBarParameters(input: Record<string, unknown>): ManualFourBarParseResult {
  const lengthNames = ['ground', 'crank', 'coupler', 'rocker'] as const;
  const values = Object.fromEntries(lengthNames.map((name) => [name, Number(input[name])])) as FourBarLengths;
  for (const name of lengthNames) {
    if (input[name] === '' || !Number.isFinite(values[name]) || values[name] <= 0) return { status: 'invalid', field: name };
  }
  const angleDegrees = Number(input.angle);
  if (input.angle === '' || !Number.isFinite(angleDegrees) || angleDegrees < 0 || angleDegrees > 360) return { status: 'invalid', field: 'angle' };
  return { status: 'valid', value: { lengths: values, angleDegrees } };
}
