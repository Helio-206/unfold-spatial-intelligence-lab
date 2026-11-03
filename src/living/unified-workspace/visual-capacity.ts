import type { Assembly } from '../contracts';
import { BUCKET_HALF_WIDTH_RANGE_M, canonicalView } from '../visual-foundry/excavator/canonical';

/**
 * What the Foundry can draw, taken from the Foundry itself so there is one number, not two. The reconstruction API accepts a
 * bucket width of 0.10 to 10 m; the display bucket keeps its hinge ears and a workable mouth, so the Foundry builds 0.60 to
 * 2.40 m and throws outside it. The lab refuses what it cannot draw, before the engine or the workspace see it, and never
 * adjusts the number or swaps in another geometry.
 */
export const BUCKET_WIDTH_VISUAL_RANGE_M = { min: BUCKET_HALF_WIDTH_RANGE_M.min * 2, max: BUCKET_HALF_WIDTH_RANGE_M.max * 2 } as const;

const metres = (value: number) => value.toFixed(2).replace('.', ',');
const RANGE_TEXT = `${metres(BUCKET_WIDTH_VISUAL_RANGE_M.min)} a ${metres(BUCKET_WIDTH_VISUAL_RANGE_M.max)} m`;

/** Why a total bucket width cannot be drawn, or null when it can. */
export function bucketWidthVisualIssue(totalM: number): string | null {
  if (!Number.isFinite(totalM)) return `A largura da caçamba tem de ser um número; a visualização desenha entre ${RANGE_TEXT}.`;
  const half = totalM / 2;
  if (half < BUCKET_HALF_WIDTH_RANGE_M.min || half > BUCKET_HALF_WIDTH_RANGE_M.max) {
    return `A visualização só consegue desenhar uma caçamba com ${RANGE_TEXT} de largura; ${String(totalM).replace('.', ',')} m não é aceite, e o valor não é ajustado.`;
  }
  return null;
}

/** Everything the Foundry would refuse to build from this assembly, as plain-language reasons. Empty means it can be drawn. */
export function visualCapacityIssues(assembly: Assembly): string[] {
  try { canonicalView(assembly).bucketHalfWidthM(); return []; }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const out = /FOUNDRY_BUCKET_WIDTH_OUT_OF_RANGE:([-\d.eE+]+)/.exec(message);
    if (out) return [bucketWidthVisualIssue(Number(out[1]) * 2) ?? `largura fora do intervalo desenhável (${RANGE_TEXT})`];
    if (/NOT_FINITE/.test(message)) return [`A largura da caçamba não é um número finito; a visualização desenha entre ${RANGE_TEXT}.`];
    if (/FOUNDRY_BUCKET_WIDTH_(MISSING|NOT_A_BOX)/.test(message)) return ['A caçamba da montagem não tem a forma (bucket-box) de onde a visualização lê a largura.'];
    return [`A visualização não consegue desenhar esta montagem (${message}).`];
  }
}
