# Spatial Fidelity V4 — Phase A: diagnosis, alternatives, architecture, first proof of concept

Branch `feat/spatial-fidelity-v4`, created from **`4d383683dbdf5612f25531c44c3d536ea24500ec`** = head of `integration/produto-v3-voice` (PR #31, draft, base `produto@5dbc53a`), confirmed on the remote and on the PR before branching. V3 stabilised (#28) is inside it as `e39173e`. Nothing from #31 is synchronised automatically; `main`, `produto`, #28–#31 and the other worktrees were not touched. No scheduler, voice, auth or Spatial Evidence file was modified. Nothing paid was run, nothing was installed, no image left this machine.

Evidence labels used everywhere: **[plan-saved-Meta]** real plan saved from a Meta call (old repair step, placeholder shapes); **[hand-authored]** reproduction written by us from the acceptance report; **[source image]** an image a person supplied; **[synthetic]** built here to control an experiment. None of the first results below is a new Meta inference.

## 1. What V3 really did, and where it stops

| Finding | Evidence |
|---|---|
| V3 only redraws the plan's own primitives (signed distance fields of boxes, spheres, tubes…). It cannot add a part, move a mis-placed one or fix a wrong proportion. It is a **surface** upgrade, not a reconstruction. | `sdf.ts`/`router.ts`: no input other than the plan |
| Against the **source image**, V3 does not move the object closer to it. Lungs: silhouette IoU with the illustration 0.742 (V2) vs 0.744 (V3). | E1 below [hand-authored plan, source image] |
| More triangles, same structure: 5–50× triangles (excavator 5,148 → 251,822) with no change in recognisability. | `reports/fidelity-v3/STABILISATION.md` |
| Placeholder plans stay placeholders. Saved harp and excavator plans: no visible gain, blobs where thin parts touch. | `board-real-meta-plans.png` [plan-saved-Meta] |
| In the product (#31) the V3 policy is deliberately narrow (single tubes/tori, ≤ 32 components), so in the normal flow it changes almost nothing. | `reports/product-integration/REPORT.md` |
| Joins between boxes keep creases (revolver/arm p90 86°). | `reports/fidelity-v3/metrics.json` |
| **Nothing in the loop compares the drawing with the source.** The plan is never checked against the image after it is made. | architecture review |
| Evidence hygiene gap: the excavator **source photograph was not kept** (only the plan), so that case cannot be verified against its source today. Sources with an image: lungs illustration, floor plan. | `reports/acceptance/inputs/` |
| The floor plan is not an object-reconstruction problem (walls, doors, relations); it belongs to the architecture path and needs its own ground truth (room topology, dimensions), not a mesh generator. | V3 `COMPARISON.md`, kept |

Conclusion: the quality ceiling is set upstream of geometry — in interpretation and structure — and V3 has no lever there. V4 needs (a) a way to *estimate structure from evidence*, (b) engines that can draw what primitives cannot, (c) a verification stage against the source.

## 2. Alternatives (A–F)

Status of the evidence column: **measured** here, **desk** (documentation/secondary sources, 2026-11 search, not verified), **none**.

| | What it is | Expected quality (honest) | Keeps components, ids, provenance | Resources / licence / privacy | Evidence | Role in V4 |
|---|---|---|---|---|---|---|
| **A** Procedural + parametric CAD | Engines with real profiles: revolve/loft/sweep with varying section, extrude with bevels and holes, CSG, patterns. CAD kernels (OpenCascade WASM) for mechanical parts. | High for mechanical and architectural parts *if the parameters are right*; says nothing about the real object | **Yes by construction** (one component = one parametric body) | CPU only, no data leaves; kernel licences to verify (OCCT is LGPL-2.1 with exception — desk, check) | none yet | Core geometry engine; widens what a plan can say |
| **B1** TRELLIS.2 (self-hosted) | Image-to-3D, PBR mesh | Plausible full objects; unknown for fidelity to the photo | **No** native split; mapping to components is ours | MIT (desk, several secondary sources agree); VRAM figures conflict: 16 / 24 / 40–80 GB, Linux only; data stays local ([sources](https://huggingface.co/nitesh-ml/TRELLIS.2-4B-nb-3D), [guide](https://www.codesota.com/news/trellis-2-3d-generation)) | none: no GPU here | Optional *shape prior / per-part generator*; not the base |
| **B2** SAM 3D Objects | single image + mask → textured mesh or splat | Reported strong on in-the-wild objects; scale is normalised, not metric | No component split documented | "SAM License" (custom; read it), derived datasets are non-commercial; hosted or GPU ([model card](https://huggingface.co/facebook/sam-3d-objects/blob/refs%2Fpr%2F3/README.md)) | none | Candidate prior; licence review first |
| **B3** Hunyuan3D 2.1 | open image-to-3D | — | No split | Community licence **excludes EU/UK/South Korea** territory | desk | **Rejected** for UNFOLD |
| **B4** Hosted APIs (Meshy, Tripo, Rodin) | paid image-to-3D | Varies; no fidelity guarantee | Tripo lists a segmentation endpoint (40 credits, desk) — would need a trial; Meshy has none | Image leaves UNFOLD; credits; free-tier outputs are non-commercial or CC BY 4.0 ([comparison](https://www.3daistudio.com/blog/best-3d-model-generation-apis-2026)) | none | Optional adapter behind consent + budget, never default |
| **C** Multi-view reconstruction | Silhouette carving, photogrammetry, NeRF/Gaussians | Accurate **if** many calibrated views; users rarely have them | Blob without identity unless fitted to a plan | CPU for carving; photogrammetry needs ≥ tens of photos | **measured (E2)** | Source of constraints for fitting, not a mesh producer |
| **D** Implicit / SDF / remesh / booleans | What V3 did | Smoother; no new structure | Yes | CPU | **measured (V3)** | Finishing + junctions only |
| **E** Approved external assets | Licensed meshes mapped to components | Excellent *when the object matches*; says nothing about the user's object | Needs explicit mapping + approval (built in V3) | Licence verification per asset | **measured (camera, V3)** | Library path for known categories; always declared |
| **F** Hybrid | AI names components and relations; engines (A, B, D, E) make each part; verification compares with the source | Best expected ceiling; every part has a declared basis | **Yes** | Mixed, each engine optional | architecture; pieces measured | **The V4 architecture** |

Rule kept from V3: **no provider is trusted for fidelity, editable components or semantic topology until measured on our own references.** B/C numbers above are documentation claims, not results.

## 3. Architecture: Adaptive Reconstruction Engine

Six stages, each proposing and none writing the plan (types in `src/universal-spatial/reconstruction/types.ts`):

1. **Spatial Understanding** — source (photo, views, drawing, text) → components, relations, uncertainty. Today: Meta/Muse Spark plan. Unchanged contract.
2. **Structural Reconstruction** — estimates proportions, orientation, placement from evidence (silhouettes from one or several views; later model priors). Output: `StructuralProposal` = typed `SpatialOperationV2` operations + evidence, basis `inferred`/`approximate`.
3. **Geometry Generation** — router per component among engines: V2 primitives, V3 surface, **new parametric bodies (A)**, approved external mesh (E), optional generated part (B). V2 always the return path.
4. **Visual Refinement** — normals/tangents, PBR, detail; presentation only, never hides a reconstruction defect.
5. **Visual Verification** — renders the result from the source's own views and compares: objective metrics (silhouette IoU, held-out views, junction/artefact metrics) kept apart from perceptual judgements (model or person). A model's judgement never replaces human recognition.
6. **Spatial Integration** — selectable, identifiable, editable components in the SpatialWorkspace: stable ids, inspector, exploded view, Presentation Director, undo, cancellation, V2/V3 fallback. Reuses the V3 worker/cache/ownership contracts; adds nothing to the scheduler.

Geometry basis, per component, never promoted without evidence: `generated` (exact to the parameters, silent about the real object) · `inferred` (a fit or a model's guess) · `external_asset` (made elsewhere, approval + licence) · `validated` (checked against stated evidence) · `approximate` (stand-in with a reason). A detail that is invented is `inferred` with its source, never "reconstruction".

## 4. First experiments (no external resource)

Script `scripts/benchmark/v4-baseline.ts`, data `baseline-results.json`, tests `tests/reconstruction-silhouette.test.ts`.

**E1 — does V3 get closer to the source image?** [hand-authored plan vs lungs illustration] silhouette IoU after fitting by height, best of 91 views: V2 **0.742**, V3 **0.744**. V3 does not touch the structural error (the lobes are ellipsoids; the source's are not).

**E2 — what multi-view carving recovers, against ground truth.** [ground truth = each plan's own solid: hand-authored lungs and microscope; saved Meta excavator and harp plans used only as *known solids*, not as real objects] volumetric IoU of the visual hull:

| Calibrated views | 1 | 3 (axes) | 6 | 12 | 24 |
|---|---|---|---|---|---|
| Lungs | 0.32 | 0.85 | 0.91 | 0.95 | 0.96 |
| Microscope | 0.14 | 0.72 | 0.65 | 0.81 | 0.88 |
| Excavator plan | 0.16 | 0.62 | 0.69 | 0.81 | 0.89 |
| Harp plan | 0.12 | 0.86 | 0.84 | 0.90 | 0.93 |

Reading: one view says almost nothing about depth (hull = prism, +215…730 % volume); three well-chosen views already recover most compact shapes; mechanical assemblies with concavities and thin parts need ≥ 12 views and still carry 8–10 % excess volume at 24. Axis-aligned views beat evenly spread ones at small K (microscope 3 vs 6). The hull has **no components**: it cannot replace the plan, only constrain it. Limits of the test: silhouettes are rasterised from the V2 mesh while the solid is the SDF, so IoU 1.0 is not reachable; parts thinner than ~2 voxels are not scored.

**E3 — silhouette-driven refinement of placement (analysis by synthesis), one view.** [hand-authored lungs plan, source illustration] IoU 0.742 → **0.782** by scaling/moving four components (largest: carina ×1.3). The same plan seen from two other views changes by 9–12 % IoU, and nothing says whether that is better or worse, because a single illustration cannot judge depth. **Weak evidence: a single view under-constrains the problem.** It is a proposal (basis `inferred`), never applied silently.

What this tells us: single-image fitting of a given plan is insufficient; fidelity needs either several views or a strong shape prior; and any improvement must be judged on **held-out views**, not on the view used to fit.

## 4b. Phase B first result, validated in the real product workspace (`/living`)

Correction of method: validation of V4 happens in `/living` (the real SpatialWorkspace: product renderer, camera, lighting, framing, selection, inspector), not in an Engine Lab. The old `/universal-spatial-v2` page and its harness, stage and e2e tests were removed from this branch on request; the isolated geometry harness is kept only for geometry tests. Captures: `reports/fidelity-v4/living/`, board `board-living.png`, script `tests/e2e/v4-living.pw.mjs`, data `living/results.json`. The plan endpoint is a local file; **no Meta call, no external inference**.

**What was run** (`scripts/benchmark/v4-fit.ts`, `src/universal-spatial/reconstruction/fit.ts`, tests `reconstruction-fit.test.ts`): ground truth = hand-authored lungs and microscope plans; input = the same plans with **synthetic** placement errors (scale ×0.72–1.30, shifts up to ±10 % of the span, seeded); evidence = K calibrated silhouettes of the ground truth; the fitter estimates a scale and a translation per root component and applies them as typed `set-transform` operations with provenance `inferred`. Ids, hierarchy and source hash are preserved (checked per run).

| Held-out silhouette IoU (10 views never used in the fit) | degraded input | 3 views | 6 views | 12 views |
|---|---|---|---|---|
| Lungs | 0.61 | 0.86 | 0.92 | 0.94 |
| Microscope | 0.53 | 0.79 | 0.91 | 0.91 |

Mean position error (% of span): lungs 9.9 → 6.5 / 5.6 / 3.8; microscope 9.8 → 4.0 / 1.6 / 1.7. Scale error improves little (scale and shift trade off under silhouettes). Cost: 0.25–2.1 s on CPU, offline.

**In `/living`** (1440×900, same camera, lighting and framing for every column; object occupies 0.25–0.48 of the width and 0.69–0.74 of the height; every variant has all components selectable, a click selects a component and the inspector shows `posição · inferido` for fitted components):
- Microscope: the V4 plan is visually almost the ground truth (object box within 1 px of it); the degraded input has detached, floating parts.
- Lungs: better, still wrong — the silhouette constraint does not force contact, so the trachea stays detached from the carina and the vessels are displaced. Assembly relations are a separate constraint (the existing assembly solver is the natural next stage); this is a visible limit, not a success.
- Triangles are those of the product path (V3 policy leaves most parts on V2): **this gain is structural, not more polygons**.

What this does and does not show: it shows that, with several calibrated views, placement errors of a plan can be reduced and checked on held-out views while preserving identity and provenance, and that the result behaves correctly in the real workspace. It does **not** show that it works on Meta's actual errors (wrong primitives, missing parts, not just misplacement), on photographs (no calibrated views or masks yet), on parts with parents (not fitted), or that people recognise the object better (no human panel yet).

## 5. First proof of concept (Phase B) — choice

**Plan-constrained multi-view fitting with held-out verification (F-lite), controlled by ground truth.**

- Input: a plan with identities and provenance (e.g. degraded: placeholder-like proportions, ±30 % scale/position errors) and K ≥ 3 calibrated silhouettes of the true object.
- Structural Reconstruction: fit per-component transform and primitive parameters to the K silhouettes under the plan's hierarchy and bounds → `StructuralProposal`s.
- Verification: IoU on **held-out views** and against ground-truth volume; report per-component recovery.
- Reason: it is the only candidate whose result can be *measured against ground truth with resources available now*, it keeps ids/provenance/edit/undo, it exercises the verification stage every other engine will need, and it is engine-agnostic (any generator can replace the primitives later).
- Second objects of a different nature: mechanical (microscope) and organic (lungs), plus the real saved plans as *degraded starting points*, clearly labelled [synthetic degradation].
- In parallel: engine **A** (revolve/sweep with profile curves) for parts primitives cannot express (harp neck and soundbox, rims, hydraulic cylinders) — implemented as ordinary plan operators, so the router/worker/disposal contracts apply.
- Not run, only prepared (adapter + local test with a counting mock, no result simulated): TRELLIS.2 / SAM 3D as optional **per-part generators or shape priors**, behind consent per image and an approved budget.

Why not start with a provider: no GPU here, conflicting VRAM figures, no component separation documented, EU/privacy/licence conditions unresolved; a result from one would not tell us if the *pipeline* works.

## 6. Cost and requirements (estimates, not measurements)

| Item | Requirement | Cost | Status |
|---|---|---|---|
| F-lite + engine A | CPU, Node/browser, 1–2 weeks of work | none external | can start now |
| Visual Verification (silhouette, held-out) | CPU; rendering via existing Chromium harness | none | can start now |
| TRELLIS.2 self-hosted | NVIDIA GPU ≥ 24 GB (conservative reading), Linux, weights download | GPU hours (cloud 24 GB-class hourly rate not verified here) | **needs approval and a GPU** |
| SAM 3D Objects | licence review; GPU or hosted | unknown | **needs licence reading first** |
| Hosted APIs (Meshy/Tripo) | key server-side only, per-image consent, approved budget; free tiers are CC BY / non-commercial | credits (≈ 20–40 per image–model call, desk) | **needs approval** |
| Human recognition panel | ≥ 5 independent people, blinded, same camera/scale/light for V2/V3/V4 | people time | needed for any perceptual claim |

## 7. Validation plan

Objects: excavator, harp, microscope, lungs, floor plan. For each: a **source with the real image kept** (hash + file, with permission), V2/V3/V4 from the same camera, scale and lighting, and separate columns.

| Metric | Type | Method |
|---|---|---|
| Silhouette fidelity | objective | IoU vs source image(s) after fitting; **held-out** views vs ground truth where it exists |
| Proportions, structure | objective | bounding-box ratios, component placement error vs ground truth solid (synthetic cases) |
| Component integrity | objective | per-component retention/recovery; ids and provenance preserved (tests) |
| Junctions, artefacts, thin parts | objective | V3 metrics (`metrics.json`) + thin-part retention |
| Cost | objective | triangles, bytes, generation/load time, frame behaviour (software GPU flagged) |
| Interaction | objective | selection, edit, undo, cancel, dispose (existing cycle script) |
| Recognition | **perceptual, human** | blinded panel; model judgement logged separately, never substituting it |

Ground truth: (1) synthetic — known solids rendered to views (done in E2, extend with real GLB assets such as the CC0 camera, only as *test objects*); (2) real — need photographs with several views or measurements; **none exist in the repo today**. Asking for them is the first dependency. The floor plan needs its own truth (room count/adjacency, dimensions), checked on the architecture path.

Acceptance (kept from the brief): V4 is not "done" by more triangles, smoothing, reflections, shadows or undeclared prefabricated models. A claimed gain must show on held-out views or ground truth, with the geometry basis declared per component.

## 8. Decisions needed from you

1. Photographs/multi-view sets (and permission to keep them in the repo or an excluded folder) for at least two of the five objects, to serve as real ground truth.
2. Whether a GPU (or a budget and per-image consent) may be used for TRELLIS.2 / SAM 3D / a hosted API in Phase B2. Without it, Phase B is F-lite + engine A only.
3. Licence review owner for SAM 3D Objects and the CAD kernel before they are considered.
