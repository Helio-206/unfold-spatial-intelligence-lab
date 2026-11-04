# Universal Spatial Engine V2 — visual quality recovery

Base: PR #23, SHA `ea4c5229ce9b110386740cedda505cb399a1d876` (stacked, isolated worktree, no merge, industrial Foundry and Engineering Engine untouched).
Dossier: `before-after.png` (contact sheet), `before/`, `after/`, `e2e/`, `fixtures/`. Scripts: `scripts/visual/`. No paid Meta call was made.

## What was wrong (measured, not assumed)

| # | Finding | Evidence |
|---|---|---|
| 1 | The viewport was a strip: `#v2-canvas` kept the default 150 px canvas height inside a 680 px stage. | Canvas 1008×151 at 1440×1000 (`before/*.json`). |
| 2 | The image sent to the evaluator was black. `toDataURL()` ran outside the render task on a context without `preserveDrawingBuffer`. | `before/black-capture-proof.json`: old handler image mean/max luma **0 / 0**; screenshot of the same canvas 19.6 / 133. This is the "uniformly black render" Meta reported (recognizability 0). |
| 3 | Framing was `radius*1.9+1` with near/far fixed at 0.01..1000: no dependence on FOV, aspect or scale. | Objects filled 4.9–9.1% of the stage height. |
| 4 | **Every shape in both saved Meta plans is a generic placeholder**: 15/15 (harp) and 17/17 (excavator) have exactly the fixed "safe" parameters (0.8 cube, 0.3-radius cylinder, straight 0.8 tube). `scripts/visual/generic-nodes.mjs`. | The plan unknowns say the model omitted required fields (e.g. `metalness`, `clearcoat`) and every shape was then replaced as a whole. |
| 5 | The retry loop only matched one error form (`PARAMETERS_INVALID:<path>`); `.bevelM`, `.segments`, `.torus` errors ended in HTTP 422. | Code reading; covered by the new plan-level repair tests. |

Consequence: most of what looked "rudimentary" was not a Meta geometry choice at all, and it cannot be recovered from the saved plans.

## What changed

- **Viewport and framing** (`framing.ts`, `stage-v2.ts`, `harness-v2.css`): canvas fills the stage; camera fitted to real world vertices for any scale/aspect/shot (verified 1e-3…1e3, portrait to ultra-wide); depth range proportional to the object; presentation wrapper normalises size without touching compiled units; six axis shots + a 3/4 hero, animated with the Cinema's `blendPoseOrbital`; "frame selection".
- **Hero direction**: among the four diagonal views, the largest silhouette, tie-broken toward the end with more vertex detail. This is a heuristic: an unknown object has no "front".
- **Verified captures** (`frame-analysis.ts`): shadow-free object mask from a with/without-object pair; the presented frame is read and PNG-encoded in the same task. Black, blank, too small, clipped and off-centre frames are rejected **before** any paid call (browser-tested: step-0 construction reveal is rejected, nothing sent; a valid capture reaches the evaluator route with mean luma 127.7).
- **Field-level repair** (`geometry-repair.ts`, server): keeps every value the model gave, fixes aliases, ranges, unknown keys, negative magnitudes, self-crossing outlines; lists kept / changed / assumed; component becomes `design_approximation` with details in evidence and `unknowns`; unsalvageable shapes get defaults scaled by assembly span. Fuzz over all 11 operators produces contract-valid output every time.
- **Prompt**: subject-free geometry rules (scale 2–10, overlap with neighbours, silhouette first, operator choice, complete parameters). Tested to contain no object names.
- **Assembly solver** (`assembly-analysis.ts`): floating / detached / tiny / approximated findings; nearest-first bounded correction through typed `set-transform` operations in the parent frame; never moves `observed` or `user_provided` positions (reported as blocked); gaps over 60% of the longest side are treated as intentional separation.
- **Materials** (`materials-v2.ts`): bare metal, coated hardware, glossy paint, organic (with sheen), rubber, glass, neutral resolve to distinct bounded values whatever the model proposed.
- **Explorable harness**: component list with provenance and "approximated" badge, selection by click or list, inspector, assembly check, human edits (scale, move, colour) as preview → Apply, authorisation tick for confirmed/observed values, undo, isolate.
- **Cinema reuse**: studio environment (PMREM), contact shadow, `CameraPose` type and orbital blend. Not reused: the machine-specific stage, post chain and shots.

## Before / after, same inputs, same 1440×1000 viewport, same 1010×680 stage

| Input | Object height of stage, before → after | Note |
|---|---|---|
| Harp plan (saved Meta) | 8.7% → 89.6% | still 15 generic shapes |
| Excavator plan (saved Meta) | 9.1% → 89.7% | still 17 generic shapes |
| Aircraft engine (hand-authored fixture) | 6.3% → 89.7% | recognisable turbofan |
| Bicycle (hand-authored fixture) | 4.9% → 89.7% | recognisable |

The 90% is the configured 10% margin, so it measures framing, not quality. Quality is for you to judge in `before-after.png`.

## Honest limits

- **No live Meta run** (no key; paid calls are forbidden in tests). The field-level repair is proven on synthetic and fuzzed input and by the pattern in the saved plans, **not** against the raw invalid output that produced them (it was not saved). Whether a new live run yields recognisable geometry is unproven.
- **The two saved Meta plans still look like cubes and cylinders.** Better light and framing only reveal that. They are not a demonstration of improved generation.
- **The jet engine and bicycle are hand-authored fixtures** (labelled `hand-authored-fixture` in `meta`, provenance `design_approximation`). They show what the pipeline does with a valid plan; I tuned them while looking at renders, so this is **not** a blind test. No blind unexpected-object run was possible without a Meta call.
- The assembly solver works on bounding boxes: a big enclosing part (a cowl) makes everything "connected"; diagonal members can look joined without touching. It is not a contact, collision or structural check. The contract has no `solver` origin, so its output is labelled `inferred` with "Assembly solver" in the evidence.
- Local edits and solver corrections are not synced to the server session; the harness disables server refinement after them.
- No visual evaluation was run on the new captures (paid). Scores from the model remain fallible hypotheses.
- Headless Chromium + SwiftShader only; no AO/bloom post chain; no textures.
- **Hybrid procedural + 3D assets: not pursued.** It needs a new asset node type (contract change), licence/provenance fields, scale calibration and selection mapping, and no licence-clean asset was available to measure a gain. Declining to claim one.

## Validation

`npm test`: 116 files, 2128 tests passed (PR #23 baseline 2078 in 110 files; +50 tests, none skipped or altered). `npm run build` passes (existing chunk-size warning only). Browser E2E `tests/e2e/universal-spatial-v2-visual.pw.mjs`: zero console errors.
