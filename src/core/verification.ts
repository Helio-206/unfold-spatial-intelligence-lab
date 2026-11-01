import type { Unit } from './field';
import type { FieldRef, Origin, Validation } from './provenance';

/** Uma verificação determinística. 'unknown' exige sempre um motivo. */
export type Check = {
  id: string; //         'electrical.kcl.n2', 'arch.rooms.closed'
  status: 'pass' | 'fail' | 'unknown';
  subject: string[]; //  ids das entidades verificadas
  measured?: number;
  expected?: number;
  tolerance?: number;
  unit?: Unit;
  reason: string;
};

export type VerificationReport = {
  domain: string;
  subjectId: string;
  revisionId: string;
  generatedAt: string;
  checks: Check[];
  assumptions: string[];
  inputs: Array<FieldRef & { origin: Origin; validation: Validation }>;
};

export type ReportSummary = { pass: number; fail: number; unknown: number; status: 'pass' | 'fail' | 'unknown' };

/** Um relatório só passa se todas as verificações passarem; qualquer falha prevalece sobre o desconhecido. */
export function summarizeReport(report: Pick<VerificationReport, 'checks'>): ReportSummary {
  const count = (status: Check['status']) => report.checks.filter((check) => check.status === status).length;
  const pass = count('pass');
  const fail = count('fail');
  const unknown = count('unknown');
  return { pass, fail, unknown, status: fail > 0 ? 'fail' : unknown > 0 || pass === 0 ? 'unknown' : 'pass' };
}
