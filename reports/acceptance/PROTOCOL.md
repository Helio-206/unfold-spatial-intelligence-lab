# Final acceptance test: protocol (written before any paid call)

Frozen code: `04709dca9e151e42e1f9d5873410fd437c09f495` (PR #27 head). No change under `src/`, `server/` or `tests/e2e/` between the three inputs. Only evidence and documentation are added. A blocking error is recorded here before any fix.

## Budget

Hard cap enforced by the backend budget file: **6 Meta calls**. Planned: image 1 (floor plan), image 2 (lungs), text request (phase 2, object given later by the requester) = 3. The other 3 are a reserve for a transient upstream failure on the same input only; a failure is reported, never replaced by a fixture, and no run is repeated to pick a better answer. Cost is the provider's own usage figures (estimated, not a bill).

## Inputs

1. `inputs/floor-plan.jpg`: a labelled architectural floor plan (Portuguese labels, dimensions in cm). Supplied by the requester.
2. `inputs/lungs.webp`: a flat illustration of lungs, trachea and bronchi. Supplied by the requester. WebP, so it also exercises the browser's WebP-to-PNG conversion.
3. Text request: to be supplied after phase 1.

## What the harness decides and what it does not

The harness (`tests/e2e/space-workspace.pw.mjs`, live mode) keeps every proposed component and ticks the acknowledgement: that is an **automatic decision**, not a human review. No component is rejected by the script. A real human review has not been done by anyone in this test; the `humanRecognition` and `humanReview` fields stay empty for a person.

## Recorded per scenario

Request and input hash, model, request id, latency, estimated cost, stored raw response hash, normalised plan (components, provenance, unknowns), screenshots of every step (entry, review, build, orbit, selection, edit preview, edit, colour, isolate, frame, exploded, evidence, leave guard, My Spaces, reopened), video, GPU counters before and after, console errors, idle-frame check, and an assessment against the criteria: visual recognition, structural fidelity to the source, proportions and joins, geometry and materials, cinematic quality, exploration/edit/persistence, observed vs inferred vs approximated, limitations. The assessment is the assistant's, labelled as such.

## Incident log (recorded before any correction)

**Incident 1: both live image runs aborted at the idle-renderer assertion** (`space-workspace.pw.mjs`, «an idle Space must not keep rendering»: 4 frames in 2 s, limit 2), after the paid plan call, build, orbit, selection, edit preview, edit, colour, isolate and frame had completed. Consequence: for both images the steps exploded view, evidence, leave guard, My Spaces save/reopen and the GPU-leak check did **not** run live. Paid calls used: 2 of 6, no upstream failure. Console errors: none. The aborts are the harness's, not a Meta or application error that is yet shown to be one: whether the extra frames are a real idle leak or camera/damping frames of a slower scene under software rendering is **not yet known**. Planned handling, without touching frozen code: (a) a read-only diagnostic that samples frames over a longer idle period on the stored plans (labelled replay, no model call); (b) the remaining steps run as a labelled replay of each image's own stored plan (never one image's plan for the other); (c) the failed assertion stays reported as a failure.

**Incident 1 diagnosis** (read-only diagnostic, labelled replay of each image's own stored plan, no model call; the product code is unchanged). After the build the renderer drew 0 frames in four consecutive 2.5 s windows for both plans; after the *Frame* tool it drew 1 frame in the first window and 0 in the next three. So the renderer does idle: the assertion measured 2 s right after a camera transition that takes longer to finish under software rendering on a heavier scene. It was a harness timing problem, not a leak, but it is reported as a failure of the harness run. Handling: a new harness file `tests/e2e/space-accept.pw.mjs` (the frozen e2e file is untouched) that waits until the renderer has been idle for two consecutive windows before asserting, and records every window.

## Phase 2: text request (fixed before the call)

Exact prompt, sent once and never edited after seeing the result:

> Cria um modelo 3D conceptual e explorável de um microscópio óptico composto de laboratório, com base, braço de suporte, platina para lâminas, tubo ocular, revólver com três objectivas e botões de focagem. Os componentes devem formar um instrumento reconhecível e estruturalmente coerente. Não foram fornecidas medidas físicas.

Single real generation, no manual geometry, no fixtures, no replay for the primary evidence. Budget: 2 of 6 calls already used; this phase plans 1 (the remaining 3 are reserve for a transient upstream failure on this same prompt only). Code frozen (`04709dc`); the harness is `tests/e2e/space-accept.pw.mjs`, which waits for the renderer to settle (two consecutive quiet 2 s windows, up to 40 s) before asserting idle. Review decisions are automatic (keep all, acknowledge), nothing is rejected, and human visual evaluation stays pending. The paid edit-proposal and visual-evaluation routes are not exercised in this run (no extras).
