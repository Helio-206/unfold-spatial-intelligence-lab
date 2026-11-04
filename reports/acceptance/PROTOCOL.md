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
