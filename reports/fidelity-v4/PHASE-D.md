# Spatial Fidelity V4 — Phase D: structural geometry recovery

Branch `feat/spatial-fidelity-v4`. `main`, `produto`, PR #31, voice and scheduler untouched; V4 is not active by default; nothing merged. No paid call, no external inference. Typecheck, build and the full suite pass (150 files, 2452 tests).

Evidence categories, never mixed: **A** rendered views of independent CC0 geometry · **B** real photographs (none available) · **C** plans produced by Meta · **D** hand-built or synthetic plans. A row that combines two says so. **Where a Meta plan is used (C+D), it is only the geometry basis of a mechanics test: there is no ground truth for the original photograph and no fidelity to it is claimed.**

## What was built

| Capability | Module | What it does | What it never does |
|---|---|---|---|
| Local rotation correction | `hierarchical-fit.ts` (engine option `rotation`, default on) | corrects a part's rotation in its parent's frame about its own origin; coarse probes per axis then refinement; deepest parts first so a parent does not absorb a child's error; joints stay exact by construction (the translation is derived); output is `rotationRad` in the local transform | change hierarchy, ids or source; use world values as local |
| Unexplained regions + missing-part flags | `unexplained.ts` (in every engine outcome) | per view, connected pixels the source shows and the drawing does not; blobs seen in ≥ 3 independent views whose rays meet are reported as candidates with place, rough size, supporting views, nearest parts, confidence `low`/`medium` | add, connect or name a component |
| Primitive alternatives | `shapes.ts` | for a part, tries box / ellipsoid / cylinder (3 axes) / cone with parameters taken from the part's own extent; keeps one only if silhouettes agree better on the views given AND no worse on views left out; one `set-geometry` on the same node (same key, transform, material), basis `inferred` | add a component, add detail, raise triangles (it replaces one primitive by another) |
| What transforms cannot fix | `diagnose.ts` | from the plan alone: for each declared relation the plan's own geometry contradicts, searches the best allowed placement (scale 0.6–1.7, rotation ≤ 0.6 rad, shift ≤ 15 % of the span, subtree follows) and says whether it closes the gap | apply anything; force a contradicted relation shut |

Also: `evidence.ts` (`renderedEvidence`, plain-data `evidenceToJSON/FromJSON`), layer: the solver preview now names what changes (`posição, rotação e escala` / `geometria`), and a real bug found by the e2e is fixed: a long solver evidence text plus the authorisation note exceeded the 500-character provenance limit and the apply was silently blocked; the evidence is now cut to fit (unit test).

## Experiments

### R — rotation (held-out silhouette IoU on 12 views never used; engine run with 6 views)

| Basis | Part(s) rotated (local rotZ) | Input | Translation + scale only (Phase C) | **With rotation** | Rotation error of the perturbed parts (rad, before → after) |
|---|---|---|---|---|---|
| Lungs (D/D) | trachea +0.50, lung-left +0.45 | 0.875 | refused `NO_GENERALISATION` | refused `NO_GENERALISATION` | — |
| Microscope (D/D) | arm +0.50, stage −0.50 | 0.919 | refused `NO_GENERALISATION` | **0.978** | stage 0.50 → 0.012; **arm 0.50 → 0.50 (not recovered)** |
| Excavator (C+D) | boom +0.50, bucket −0.50 | 0.800 | 0.875 | **0.984** | boom 0.50 → 0.012; **bucket 0.50 → 0.574 (worse)** |
| Harp (C+D) | harp-pillar +0.50, harp-base −0.40 | 0.846 | 0.937 | **0.994** | pillar 0.50 → 0.079, base 0.40 → 0.002 |
| Lantern, independent CC0 mesh (A+D) | crossbar +0.40 | 0.559 | 0.612 | 0.630 | crossbar 0.40 → 0.29 (partial; joint residual 0.26 % of the span) |

World matrices of the proposals reproduce the fitted placement to 2e-6, ids/parents/source preserved, joint residual 0 on the Meta-plan bases. Cost 1.6–8.3 s CPU, no GPU, no triangle change.

**Where it fails or is not enough:** lungs (ellipsoids are nearly rotation-symmetric, the silhouettes cannot see the angle, the engine refuses: correct); the microscope arm and the excavator bucket angles are not recovered even though the silhouette improves (box silhouettes are ambiguous in angle; IoU improves by moving other things); the CC0 crossbar is only partly recovered against a real mesh, where rotation and the hand-built primitives' mismatch interact.

### S — primitive alternatives (A+D, independent CC0 mesh as evidence)

- **Lantern**: held-out IoU 0.745 → **0.810** with two proposals (`base`: cylinder → box; `lantern`: box → cone). Honest reading: the primitives I had called "degraded" (box pole, box lantern) were not worse than the original hand-built plan (0.639) in silhouette terms; the engine found alternatives that agree better with the mesh. Triangles 1,756 → 1,708. The proposals are what the silhouettes support, not a statement about what the object "is": a box and a cylinder pole look alike from the sides, so silhouettes alone do not decide that pair (the pole was left as it was).
- **AntiqueCamera**: no proposal. A box for the camera body improved the given views but was worse on the views left out; the gate refused it (0.583 unchanged).
- Candidate tables are returned for every part, proposed or not (`geometry-results.json`).

### M — missing-component flags (leave one leaf part out of the plan; evidence from the complete plan; hit = a candidate within the removed part's box grown by 25 % of its diagonal)

| Basis | Leaves tested | Top candidate correct | Any candidate correct | Candidates on the COMPLETE plan |
|---|---|---|---|---|
| Lungs (D/D) | 7 | 4 | 4 | 0 |
| Microscope (D/D) | 10 | 7 | 7 | 0 |
| Excavator (C+D) | 7 | 7 | 7 | 0 |
| Harp (C+D) | 6 | 6 | 6 | 0 |

Missed: lungs trachea-ring and both bronchial trees (thin, 16–57 % of the span in length but a few pixels wide); microscope objectives, focus knob, illuminator (small, 10–21 %). Plans are exact copies of the truth minus one part, so these numbers are an upper bound for real plans, and the criterion is generous. Nothing is added; a candidate only says "something is shown here that the plan does not draw".

### X — the saved Meta plans: what transforms alone cannot fix (plans only, no evidence)

| | Declared relations contradicted by the plan's own geometry | Closable by an allowed transform | **Not closable by any allowed transform** |
|---|---|---|---|
| Excavator (C) | 7 (gaps 3–52 % of the span) | 4: left/right track, upper frame, cab (best residual ≤ 0.07 % of the span) | **3: boom** (best 6.2 %), **stick** (25.9 %), **bucket** (35.3 %) |
| Harp (C) | 4 (gaps 9–18 %) | 4 (neck, pillar) | 0 |

The excavator's boom/stick/bucket chain is not a placement problem: even the best allowed placement leaves them 6–35 % of the span away from what they are declared attached to, so the shapes or sizes cannot meet, or a connecting part is missing. For the harp every declared gap *could* be closed by transforms, but nothing in the plan or any evidence says the declared relations are right, so none is applied. The engine still refuses these plans by default (`CONTRADICTORY_RELATIONS`); relations stay unenforced and are never forced shut. In the mechanics tests and the `/living` PoC below the refusal is overridden explicitly by a person-level option (`allowContradicted`), which still leaves them unenforced.

## `/living` validation (real renderer, camera, materials and lighting; same page and camera within each row)

`tests/e2e/v4-geometry-living.pw.mjs`, board `board-living-geometry.png`, captures in `living-geometry/`:

1. **Excavator, rotation** (C+D mechanics). V3 original input | V4 translation + scale only | **V4 with local rotation.** The engine runs in the page, changes nothing by itself, then the proposal goes through preview (plan verified unchanged) → explicit authorisation → apply (ids, parents, source hash kept; changed parts `user_provided` with the solver evidence; 4 of 11 parts) → undo by the real button (plan restored exactly). The rotated boom/bucket are visibly back in line in the third column; the second column (what Phase C could do) leaves them tilted.
2. **Lantern, primitives** (A+D). Input | **V4 primitive alternatives (`set-geometry`)**: the base becomes a box pedestal and the lantern a cone; the V3 route still produces the tube surface through the Worker (`procedural_v2` + `continuous_surface`); undo exact; geometry provenance `user_provided` for the two parts.

The proposals, previews and undo are the same typed, authorised path as Phases B and C.

## Not done / limits

- No photograph (category B) was used; nothing here says the engine recognises anything better than before on real pictures. Rotation is recovered from silhouettes of known plans and one CC0 mesh only.
- The missing-component flag is evaluated on plans that are exact minus one leaf; real plans have wrong primitives and shifted parts too. A flag cannot name or place the missing part precisely (radius is rough), and orthographic views are assumed (photographs need intrinsics).
- Primitive alternatives choose among five forms by silhouette agreement; silhouettes do not determine a primitive's identity.
- Boom/stick/bucket of the saved excavator, and the harp as a whole, still need shape or structure work that is not a transform; this phase identifies them and stops there.
- There is still no review UI to confirm relations or to see candidate flags in the product; they are in the engine outcome and the reports.
