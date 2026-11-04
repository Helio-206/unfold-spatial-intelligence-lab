# Spatial Fidelity V4 — Phase C: hierarchical structural reconstruction

Branch `feat/spatial-fidelity-v4`. `main`, `produto`, PRs #28–#31, scheduler, voice and authentication untouched; V4 is not active by default and nothing is merged. No paid call, no external inference, no image left this machine. Typecheck, build and the full suite pass (150 files, 2446 tests).

Evidence categories as before: **A** rendered views of known CC0 geometry · **B** real photographs · **C** plans produced by Meta · **D** hand-built or synthetically perturbed plans. A row mixing categories says so, and no conclusion crosses them. **Nothing here measures fidelity to an original photograph: no ground truth for any Meta plan exists.**

## 1. P0 — hierarchical transforms (`hierarchy.ts`, `hierarchical-fit.ts`, `engine.ts`)

- **Local is local.** A component's transform is expressed in its parent's frame. `validateHierarchy` composes the world matrix as parent-world × local and the engine checks it against the compiled scene (maximum difference **0** on both saved plans, depth 4 on the excavator). A correction is only ever written back as a local value (`position + d`, `scale × s`, rotation untouched): one `set-transform` per changed part, never a rewrite of geometry.
- **No duplicated parent transform.** World placement is recomputed down the dependency order, so a change to a part moves and scales its whole subtree the way the plan itself does; a child's own correction is separate from its parent's.
- **Several levels.** Depth is unbounded (the chain test has three levels with a rotated middle part; the excavator has five levels counting the root).
- **Joints by construction.** A part that follows a leader at an enforced joint (its hierarchical parent or any other part) gets the translation that keeps the joint exactly where it is; the dependency graph forbids circular following. Joints that cannot be built in are penalised and checked afterwards. Resulting joint residual on the proposals: 0.
- **Invalid structure is reported, never repaired:** duplicate id, self parent, missing parent, cycle, relation naming a missing part or itself, relation contradicting the hierarchy (`contains` of an ancestor), mutual containment, constraint naming a missing part. Any of these refuses the fit.
- **Output** is typed, reversible and reviewed: operations go to `PlanSpaceLayer.proposeSolverEdit` (preview → explicit confirmation → apply → one undo). Before offering a proposal the engine applies the operations to a COPY and verifies that the hierarchy is valid, ids/parents/source are unchanged and the compiled world matrices equal the fitted ones (largest mismatch 2e-6 and 4e-7 on the saved plans).

## 2. P1 — what a relation is (`relations.ts`)

| Status | Meaning | Enforced |
|---|---|---|
| `declared_supported` | the plan declares `attached_to`/`connected_to` and the geometry as given agrees | yes |
| `declared_contradicted` | declared, geometry disagrees (a gap) | **no**, never repaired here; refuses the fit unless a person overrides |
| `detected_hypothesis` | the parts touch, nothing says they should be joined | **no** (default): listed for review |
| `human_confirmed` | the plan marks the relation `user_provided`, or a person confirmed the hypothesis id in review | yes |

Nothing is promoted automatically. On the Phase B cases (D/D) the same inputs now behave as follows:

| | Input held-out IoU | Default (no confirmation) | Half of the hypotheses confirmed | All confirmed | Phase B (detected contacts enforced) |
|---|---|---|---|---|---|
| Lungs | 0.597 | **refused** `NO_STRUCTURAL_SUPPORT`, 6 hypotheses listed | 0.926 | 0.935 | 0.928 |
| Microscope | 0.523 | **refused**, 8 hypotheses listed | 0.810 | 0.828 | 0.863 |

The unconfirmed default refuses because nothing says how the parts hold together. The confirmations here are a decision simulated explicitly by the script (`v4-hypotheses.ts`); **the product has no review UI for confirming relations and the plan contract has no operation to record one** (next step).

## 3. P2 — eligibility: when the engine does NOT fit

Each case returns a reason and leaves the plan as it is (`Outcome.proposal = null`, the input is never edited); all are unit-tested in `tests/reconstruction-hierarchy.test.ts`.

| Condition | Code |
|---|---|
| fewer than 3 independent views (separated ≥ 20°), views nearly coplanar | `TOO_FEW_INDEPENDENT_VIEWS`, `VIEWS_NOT_DISTINCT` |
| no views / no usable calibration / mismatched or empty masks | `NO_VIEWS`, `VIEWS_NOT_CALIBRATED`, `VIEW_MISMATCH`, `EMPTY_EVIDENCE` |
| invalid hierarchy or relations, inconsistent transforms | `HIERARCHY_INVALID`, `TRANSFORM_INCONSISTENT` |
| essential relations missing (several parts, no parent link, no enforced relation) | `NO_STRUCTURAL_SUPPORT` |
| declared relations that the geometry contradicts | `CONTRADICTORY_RELATIONS` (explicit human override available) |
| enforced joints cannot all be kept | `CONTRADICTORY_CONSTRAINTS` |
| no improvement ≥ 0.01 on the given views, or worse on views left out (≥ 4 views: a quarter is held out and fitted without) | `NO_IMPROVEMENT`, `NO_GENERALISATION` |
| cost over evaluation/time limits, too many components | `COST_EXCEEDED`, `TOO_MANY_COMPONENTS` |
| result does not reproduce when applied to a copy | `RESULT_INVALID` |

Parts without usable evidence are not guessed: they are frozen and listed as **unresolved** (`too_thin_for_silhouette`, `never_visible_alone`). They still follow their parent.

## 4. P3 — the saved Meta plans (category C)

`scripts/benchmark/v4-hierarchical.ts`, data in `hierarchical/`.

**Traversal** (the plans as saved):

| | Components | Depth | Hierarchy / world match | Declared relations: supported / contradicted | Contact hypotheses | Default engine outcome |
|---|---|---|---|---|---|---|
| Excavator | 11 | 4 | valid / 0 | 0 / **7** | 8 | no views: `NO_VIEWS`; with evidence: **refused `CONTRADICTORY_RELATIONS`** |
| Harp | 7 | 1 | valid / 0 | 0 / **4** | 1 | no views: `NO_VIEWS`; with evidence: **refused `CONTRADICTORY_RELATIONS`** |

All declared relations of both plans disagree with their own geometry (gaps of 3–18 % of the span: placeholder shapes). So **by its own rules the engine does not fit the real plans by default**, and says why; the plans are untouched. There is also no photograph or view for them (no ground truth), so no fidelity claim is made.

**Mechanics** (category C+D, to test that the solver operates on a real hierarchy without corrupting it): the ground truth is the saved plan itself; the input is the plan with seeded local scale ×0.80–1.25 and local shift up to ±4 % of the span on every component; evidence = 6 rendered views of the truth; held-out = 12 other views; everything is measured on the plan that results (compiled), not on what the solver believes. V4 hierarchical runs with the explicit human override of contradicted relations (they stay unenforced).

| | Held-out IoU | Mean centre error (% span) | Mean local-scale error (log) | Ids / parents / hierarchy kept |
|---|---|---|---|---|
| **Excavator** V3 original (input) | 0.602 | 8.84 | 0.118 | yes |
| V4 non-hierarchical (Phase B engine, roots only) | **0.381** | **23.53** | 0.137 | yes |
| **V4 hierarchical** | **0.906** | **1.93** | 0.064 | yes |
| **Harp** V3 original | 0.520 | 4.71 | 0.112 | yes |
| V4 non-hierarchical | 0.533 | 4.67 | 0.123 | yes |
| **V4 hierarchical** | **0.847** | **1.81** | 0.102 | yes |

The non-hierarchical engine on a hierarchical plan fits only the parentless component and writes its new transform, which also moves and scales every descendant it never saw: the excavator gets **worse than the input** (0.602 → 0.381). The hierarchical engine recovers the placement (centre error 8.8 → 1.9 % and 4.7 → 1.8 % of the span), left-out views included (excavator 0.586 → 0.908, harp 0.608 → 0.837), in 3.5 s and 1.2 s of CPU (353 and 193 evaluations).

**Where it does not improve or does not resolve**
- Default behaviour on the real plans: refused (above).
- Local-scale recovery is modest (excavator 0.118 → 0.064, harp 0.112 → 0.102): scale and shift trade off under silhouettes, so most of the gain is in placement.
- Harp: `harp-neck` is unresolved (too thin for a silhouette) and 3 of 7 parts are left unchanged; the harp remains a set of placeholder shapes, which no placement fit can change.
- No claim of fidelity to the original photographs.

## 5. P4 — real multi-view photographs: what was found and what could not be verified

Two candidate sources, **neither approved**: rights could not be verified from a primary source reachable here.

| | NAVI (Google) | Second candidate |
|---|---|---|
| What it is | real photographs of object instances, 36 object scans, multi-view scenes of ~32 views each, per-image object masks and camera poses | none reachable and verifiable |
| Origin | `github.com/google/navi` (tutorial); data in the `gresearch/navi-dataset` bucket (v1.0 16 GB, v1.5 31 GB) | — |
| Verified directly | structure, by reading the first 40 MB of the tarball: `masks/*.png`, `images/*.jpg`, `annotations.json` per scene; **calibration** per image = quaternion `q`, translation `t`, `focal_length`, `camera_model`, `image_size` (e.g. 3024×4032, focal 3024), 32 images for the scene inspected; the repository's `LICENSE` is Apache-2.0 | — |
| **Rights** | **not verified**: the Apache-2.0 file covers the repository code; neither the README nor the tarball head states a licence for the images, and the project/paper pages (navidataset.github.io, arxiv.org) are outside this session's allowed network, so the data licence could not be read | candidates without a verifiable licence in reach: ETH3D (a secondary listing says CC BY-NC-SA 3.0, primary page not reachable), BigBIRD, OLATverse, DX.GL renders (CC0 but rendered, so category A, not photographs) |
| Limits | 16–31 GB downloads, objects are toys/household items on varied backgrounds, poses are in the dataset's own convention (needs a documented conversion to our view model), masks come from the dataset (not independent of its annotation) | — |

Consequently **no photograph was used, committed or evaluated**, and the calibration conversion was not implemented against data whose rights are unclear. To close P4 I need either permission to reach `navidataset.github.io` (and `arxiv.org`) so the licence can be read from the primary page, or a photo set you hold the rights to.

## 6. P5 — in the real `/living`

`tests/e2e/v4-hierarchical-living.pw.mjs` (excavator and harp; the engine runs **inside the page** on the loaded plan; local-edit mode):

| Check | Excavator | Harp |
|---|---|---|
| default run refuses with `CONTRADICTORY_RELATIONS`, Space unchanged, nothing pending | yes (720 ms) | yes (143 ms) |
| run with human override returns a proposal and still changes nothing (no preview by itself) | yes | yes |
| preview shows the pending solver proposal; plan unchanged | yes | yes |
| **cancel**: nothing pending, plan unchanged | yes | yes |
| apply without explicit confirmation does nothing | yes | yes |
| confirmed apply: ids, parents, source hash kept; changed parts `user_provided` with solver evidence; untouched parts keep their provenance | 10 of 11 changed | 4 of 7 changed |
| V3 integration after apply (product geometry route) | all V2 (policy not eligible) | `continuous_surface` still produced by the Worker (5,184 triangles) |
| 3D selection on the result (real click) and inspector provenance | `bucket-linkage` | `harp-pegs` |
| exploded view on/off: plan unchanged | yes | yes |
| **undo** by the real button: plan restored exactly | yes | yes |
| non-hierarchical comparison applied and undone exactly | yes | yes |
| **dispose** with a proposal pending: nothing pending, nothing offered, no upgrade, 0 console errors | yes | yes |

Board: `board-living-hierarchical.png` (same page and camera per row: V3 original | V4 non-hierarchical | V4 hierarchical). Earlier Phase B e2e still pass; `spatial-space-layer` tests added for cancel and dispose.

## 7. Limits and next steps

- The product has **no review UI to confirm relations** and the plan contract no operation to record the confirmation; today a confirmation is an engine input. Until then, hierarchical plans with unsupported declared relations are refused by default.
- The mechanics test shows the solver operates correctly on real hierarchies; it does not show better fidelity to anything real. Category B is still empty.
- Uniform scale per part plus translation only: no rotation, no non-uniform scale, no primitive changes, no missing-part recovery (the next stage you described).
- Frame behaviour was observed under software rendering only.
