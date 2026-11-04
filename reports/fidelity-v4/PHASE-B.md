# Spatial Fidelity V4 — Phase B: structural reconstruction

Branch `feat/spatial-fidelity-v4`, on top of the Phase A commit (base `4d38368`, head of PR #31). `main`, `produto` and #28–#31 untouched. No paid call, no external inference, no model installed, no GPU. Assets: only public CC0 meshes whose licence was read in the primary source (below). Nothing here is Meta output unless a row says so.

**Evidence categories (never mixed in a conclusion)**

| | Meaning | Used here for |
|---|---|---|
| **A** | known geometry rendered to calibrated views: independent CC0 meshes (Khronos Lantern, AntiqueCamera) | the only evidence handed to the fitter, and the ground truth for held-out views |
| **B** | real multi-view photographs | **none exist** in the repo or were obtained; nothing is claimed for photographs |
| **C** | plans actually produced by Meta (saved excavator and harp, old repair step) | structure statistics only; they have no ground truth |
| **D** | hand-built or synthetically degraded plans | the plans being fitted (hand-built primitive approximations of A; lungs and microscope reproductions with synthetic errors) |

## 1. P0 — structural assembly constraints

`src/universal-spatial/reconstruction/constraints.ts`, `structural-fit.ts`; tests `tests/reconstruction-constraints.test.ts` (4), `reconstruction-fit.test.ts`, layer tests (3 new).

- **Where a constraint may come from.** `declared`: the plan states it (relation `attached_to`/`connected_to`, constraint `aligned`/`coaxial`) **and** the geometry as given supports it. `detected`: two parts of the plan as given touch or overlap, proposed as a hypothesis with its gap. A declared relation the geometry does not support is **not enforced and not created**; it is reported (`notes`). Parts that do not touch are never joined (tolerance capped at 4 % of the span).
- **Satisfied by construction, not by a penalty.** The attach graph becomes a spanning forest (largest body first). Roots and unconnected parts are free in scale and translation; every other part is free only in scale and its translation is whatever keeps its joint on its parent's joint. Edges that close a cycle are penalised and reported (`maxJointResidualPctSpan`). A silhouette term can therefore not pull a joint apart.
- **Declared limits.** Scale bounds (default 0.6–1.7) and a shift bound (30 % of the span) per part. Parts thinner than 2.5 pixels in the fit views have no usable silhouette and are **frozen** (a chain, a tripod leg): moving them would fit noise.
- **Output.** One scale and one translation per part = one `set-transform` each, basis `inferred`. Hierarchy, ids, shapes and source hash are untouched; nothing is added.
- **Review, provenance, undo.** `PlanSpaceLayer.proposeSolverEdit(operations, label, evidence)` (new, additive, `layer.ts`): the operations are previewed as ONE step in the inspector ("Proposta do solver estrutural (resultado de optimização) · ainda não aplicada"), the plan does not change, a person must authorise, the values become the person's decision with the solver's evidence in the provenance, and one undo reverts all of it. It is categorised as a solver result, not as an AI hypothesis.

## 2. P1 — benchmark with verified ground truth

`scripts/benchmark/v4-benchmark.ts`, `v4-consistent.ts`, `v4-meta-structure.ts`, `fetch-benchmark-assets.mjs`; data in `benchmark/`.

| Asset | Licence (primary source) | sha256 (12) | Parts | Category |
|---|---|---|---|---|
| Khronos **Lantern** | CC0-1.0, `LICENSE.md` + `metadata.json` (sbtron / Microsoft) | a79458c4b02d | pole+base+arm+bracket, chain, lantern | A (+ D plan) |
| Khronos **AntiqueCamera** | CC0-1.0, `LICENSE.md` + `metadata.json` (Maximillan Kamps / UX3D; the UX3D logo is excluded) | ae89695479ad | camera, tripod | A (+ D plan) |

Licence audit: preliminary and technical, from the licence files that ship with each model (copied in `benchmark/assets/`), not from secondary sources and **not a legal approval**. The meshes are test data, are not redistributed in the repository and are never shipped; `fetch-benchmark-assets.mjs` re-downloads them and refuses any file whose hash differs from `assets.json`. Rejected: ToyCar (structure split by material, millimetre scale), CC-BY models (kept the first protocol CC0-only), Buggy (licence file not found).

Protocol: the hand-built plan (D) is fitted to silhouettes of the CC0 mesh from K calibrated views; evaluation uses **12 other views** of the same mesh (never a view used in the fit), so the reference is independent of the plan. Plans were written by hand from the silhouettes (not tuned to the fitter); their errors are the errors of an eyeballed approximation.

## 3. P2 — results

### A + D: hand-built plan vs independent CC0 mesh (6 fit views, 12 held-out views)

| | Held-out IoU | Relation error (% span) | Joints broken | Fit time |
|---|---|---|---|---|
| **Lantern** — input (V3 path) | 0.639 | 1.50 | 0 | — |
| silhouette-only fit | 0.737 | 7.97 | 1 | 446 ms |
| **structural fit (V4)** | **0.699** | 2.01 | **0** | 467 ms |
| **AntiqueCamera** — input | 0.584 | 3.47 | 0 | — |
| silhouette-only fit | 0.727 | 7.75 | 0 | 221 ms |
| **structural fit (V4)** | **0.654** | 4.18 | **0** | 181 ms |

Reading, honestly: the structural fit improves the held-out silhouette (+0.06, +0.07) and keeps every joint, but it is **not better than the input in relations to the real asset** on these two (relation error rises 1.5 → 2.0 and 3.5 → 4.2 % of the span): these hand-built plans already had good relations, so there was nothing to repair, and the cost of constraints is a lower IoU than the unconstrained fit. The silhouette-only fit gains more IoU but damages relations by 4–5× (Lantern body centre 0.3 → 10.4 % of the span) and breaks joints. Rim/uncovered area: Lantern missed 35 → 26.5 %, excess 3.6 → 6.7 %; Camera missed 24 → 26.7 %, excess 30.4 → 12.6 %.

### D/D: mis-proportioned but still-connected input (the lungs and microscope problems)

Ground truth = the hand-authored plan; input = synthetic scale/placement errors **that keep the joints**; 6 fit views, 12 held-out views.

| | Held-out IoU | Relation error (% span) | Joints broken |
|---|---|---|---|
| **Lungs** input | 0.597 | 5.21 | 0 |
| silhouette-only | 0.941 | 7.94 | **1** (the trachea detaches) |
| **V4 structural** | **0.928** | **2.38** | **0** |
| **Microscope** input | 0.523 | 7.72 | 0 |
| silhouette-only | 0.892 | 7.19 | 0 |
| **V4 structural** | **0.863** | **4.02** | **0** |

This is the demonstration requested: V4 **improves the silhouette and the structural relations together** (IoU +0.33 / +0.34, relation error roughly halved) while keeping every joint, selectable components, solver provenance and a one-step undo. The unconstrained fit reaches a slightly higher IoU and is the one that detaches the trachea from the carina (`board-living-structural.png`, first row).

### In `/living` (real renderer, camera, lighting, selection, inspector)

`tests/e2e/v4-structural-living.pw.mjs` — same page and camera for the three left columns of each row; the path is input → preview in the inspector (plan verified unchanged) → authorise → apply (ids, source hash and provenance checked) → **undo by the real button (plan restored exactly)** → next proposal. 4 cases × 2 proposals pass; 0 console errors. Board: `board-living-structural.png`, captures in `living-structural/`. Triangles are those of the product path (3.1–16 k): **no polygon increase**. Run in local-edit mode (no session backend, because the backend rate-limits spatial requests to 20 per minute); the session-synced apply/undo was checked separately on the Lantern (6 operations + 6 undos accepted, plan restored).

### Cost

CPU, offline: fit 0.1–1.4 s for 5–10 parts; heap growth 0–7 MB; no GPU; no extra triangles. Interaction in `/living` is unchanged (the proposal is a handful of `set-transform`s).

## 4. Cases where it fails, and why

1. **Too few views.** 1 view: Lantern held-out IoU **0.448 < input 0.639** (relation error 9.4 %), Camera 0.636 with relation error 10.8 %. A single silhouette says nothing about depth; the fit trades depth for a better outline and is worse from other views. 2–3 views start to help (Lantern 0.692 / 0.677); 6 is the first setting reported above. The proposal must be gated on ≥ 3 independent views.
2. **A missing component cannot be found or invented.** Removing the Lantern's bracket (or the camera's tripod head) and fitting again: no part is added and no warning appears — the uncovered-region metric does not discriminate (largest uncovered blob 12.3 % vs 11.4 % with the part; camera head 15.0 % vs 16.1 %, the wrong way round), because the plan is already inexact elsewhere. The fit compensates by distorting other parts (Lantern held-out IoU 0.685 vs 0.699). Detecting an absent part needs a per-region comparison against an explicit part inventory (Spatial Understanding), not the silhouette residual.
3. **Accidental contacts in a broken assembly.** If every joint is broken but two parts happen to overlap, the layer reports them as `detected` hypotheses and pins them: lungs `disjoint` case, relation error 15.9 → 16.2 % (no gain) while the unconstrained fit reached 11.2 %. A `detected` constraint is a hypothesis about intent; it needs review before enforcement when the assembly is otherwise disjoint.
4. **Thin parts.** The first run let the chain grow 61 → 96 % in size; silhouette noise at one pixel width fits nothing. Now frozen (the chain keeps 61 % size error: **not** fixed, only not worsened).
5. **Hierarchical plans — the main gap before real use.** The saved Meta plans are hierarchical (excavator: 10 of 11 components have a parent; harp: 6 of 7) with declared relations (8 and 5), **but none of those relations is supported by the geometry as given (0 contacts)** and the fitter only handles parentless components (children live in their parent's frame). On category C it can therefore act on almost nothing today, and no fidelity claim is made for them. Extending the fit to parent frames is the next step.

## 5. Coverage lost with the removed Engine Lab, and what replaced it

| Removed test checked | Now covered by |
|---|---|
| photograph plans are `unitless`, "absolute scale unknown" | `tests/universal-spatial-v2-api.test.ts` (already) |
| blank capture is rejected and not sent; frame verified (object not touching the edge) | `tests/universal-spatial-framing.test.ts` (units) + **new in `v4-structural-living.pw.mjs`: `captureSpaceFrame()` verdict ok and object inside the frame, and a hidden-scene capture rejected, on the real `/living` canvas, 4 plans** |
| preview does not change the plan; apply = `user_provided`; undo restores; confirmed values need authorisation | `tests/spatial-space-layer.test.ts` (existing + 3 solver tests) + the e2e above (undo by the real button) |
| detached part found and gap closed by the assembly solver | `tests/spatial-space-layer.test.ts` (`closeGaps`), `tests/universal-spatial-repair.test.ts` |
| selection shows provenance | e2e inspector chips (`posição · introduzido por si`) + `living-workspace-selection-regressions.pw.mjs` |
| live Meta evaluation of the rendered view | not recovered: it needs a paid call; the local capture-verification above is the part that can run offline |

No public route was restored; the e2e is a non-public test script.

## 6. What this does and does not show

Shown: with calibrated silhouettes of an independent CC0 mesh, a structural solver improves held-out silhouette fidelity of a hand-built primitive plan without breaking joints, and, on synthetic mis-proportioned-but-connected inputs, improves silhouette and relations together; it works end to end in `/living` as a typed, reviewable, undoable solver proposal.

Not shown: any gain on photographs (no category B), on real Meta plans (category C: hierarchical, no supported contacts), recovery of missing or wrong primitives, or recognition by people (no panel; no AI judgement is offered in its place). The relation improvement is shown only on the synthetic category D/D input; on the two CC0 objects it is preserved, not improved.

## 7. Next steps (need decisions)

1. Extend the fit to hierarchical plans (parent frames) so category C can be exercised.
2. Obtain category B: several photographs of one object with known or estimated poses (permission needed), CC-licensed or provided by you.
3. A part-inventory check for missing components (Spatial Understanding) and a review step for `detected` constraints.
4. Integration contract with the Presentation Director and scheduler stays out of scope until the above holds; `proposeSolverEdit` is the only touch point proposed in `layer.ts`.
