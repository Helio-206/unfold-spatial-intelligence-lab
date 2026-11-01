import type { PropertyProvenance, VerificationState } from './spatial-scene';
import eyeIcon from 'lucide-static/icons/eye.svg?raw';
import waypointsIcon from 'lucide-static/icons/waypoints.svg?raw';
import hourglassIcon from 'lucide-static/icons/hourglass.svg?raw';
import checkIcon from 'lucide-static/icons/circle-check.svg?raw';
import rejectIcon from 'lucide-static/icons/circle-x.svg?raw';

/**
 * Presentation vocabulary for the reconstruction workbench. It only RE-LABELS provenance that the
 * canonical scene already carries; it never promotes a value. A component is `validated` only when the
 * scene itself records `verified` or `corrected`.
 */
export type ReconstructionState = 'observed' | 'inferred' | 'provisional' | 'validated' | 'rejected';

export const RECONSTRUCTION_STATES: readonly ReconstructionState[] = ['observed', 'inferred', 'provisional', 'validated', 'rejected'];

export const RECONSTRUCTION_STATE_LABEL: Record<ReconstructionState, string> = {
  observed: 'Observed', inferred: 'Inferred', provisional: 'Provisional', validated: 'Validated', rejected: 'Rejected',
};

export const RECONSTRUCTION_STATE_MEANING: Record<ReconstructionState, string> = {
  observed: 'Read from the source document or entered by the user; not yet reviewed.',
  inferred: 'Derived by the system or a solver from other values; not yet reviewed.',
  provisional: 'Ambiguous evidence; needs review before it can be relied on.',
  validated: 'Confirmed or corrected by a reviewer.',
  rejected: 'Reviewed and rejected; excluded from the model.',
};

const ICONS: Record<ReconstructionState, string> = { observed: eyeIcon, inferred: waypointsIcon, provisional: hourglassIcon, validated: checkIcon, rejected: rejectIcon };

export function reconstructionState(provenance: Pick<PropertyProvenance, 'source' | 'validation'> | undefined): ReconstructionState | undefined {
  if (!provenance) return undefined;
  const validation: VerificationState = provenance.validation;
  if (validation === 'rejected') return 'rejected';
  if (validation === 'verified' || validation === 'corrected') return 'validated';
  if (validation === 'ambiguous') return 'provisional';
  return provenance.source === 'technical_document' || provenance.source === 'user' ? 'observed' : 'inferred';
}

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));

/** Chip with icon + text label (never colour alone). `detail` is the raw provenance, shown as the tooltip. */
export function reconstructionChip(state: ReconstructionState, detail?: string): string {
  const title = detail ? `${RECONSTRUCTION_STATE_MEANING[state]} (${detail})` : RECONSTRUCTION_STATE_MEANING[state];
  return `<span class="rc-chip" data-state="${state}" title="${escapeHtml(title)}"><span class="rc-icon" aria-hidden="true">${ICONS[state]}</span>${RECONSTRUCTION_STATE_LABEL[state]}</span>`;
}

export function countReconstructionStates(items: Array<ReconstructionState | undefined>): Record<ReconstructionState | 'none', number> {
  const counts: Record<ReconstructionState | 'none', number> = { observed: 0, inferred: 0, provisional: 0, validated: 0, rejected: 0, none: 0 };
  for (const item of items) counts[item ?? 'none'] += 1;
  return counts;
}
