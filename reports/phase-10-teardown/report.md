# UNFOLD Phase 10 — Teardown, live Meta, and drawing-to-world

Date: 2026-11-01
Branch at Phase 10 recovery: `phase-10-teardown-meta-drawing-acceleration`
Base: `62fe7eb118067d35140c02ed7410cf37f7e85c47`

## Result

**PARTIAL; Phase 10 acceptance remains open.** `spatial_scene.v1` remains canonical. Case A passes dimension and topology checks. The real Case-B image was analysed by Muse Spark, and a separate manual tracing run built four perimeter walls, but its dimensional errors exceed 1% for two comparisons and it has no room polygons or room-wall relations. The live spatial agent returned a safe clarification, so the requested natural-language `RemoveWall` was not committed through Meta. Component inspection, isolate/cutaway, local transactional wall-removal tests, and browser wall resize/undo are verified. Hardware GPU performance is unverified.

## Repository recovery

- Active project: `unfold-spatial-intelligence-lab`; this worktree: `unfold-phase-10-teardown-meta-drawing-acceleration`.
- At recovery, branch `phase-10-teardown-meta-drawing-acceleration` was at `2e49722e360f631037f0c942f90a2516541b7141`; this is the verified starting commit for this implementation. The historical checkpoint `b76debea4bb7adae65492bf946be3ff4d61a9ddd` remains in another worktree. It and other stabilization worktrees were not reset or modified.
- Earlier clean-base test count was 42 files / 238 tests. The current implementation passed 43 files / 245 tests. Node `v24.22.0`, npm `11.19.1`; locked dependencies are installed. No production infrastructure changed.
- `.env` was checked for a configured, non-empty `MODEL_API_KEY` without printing its value. It is ignored by Git.

## Teardown source review

- Upstream: [`elvarofficial/teardown`](https://github.com/elvarofficial/teardown), exact commit `a91262ac1109051e014662d42ecb0b7bc1f113b1` (`main` at clone time).
- MIT-licensed. The upstream notices attribute code to elvarofficial and whaleyxbt; `SKILL.md` records `whaleyxbt/claude-motion` and CC0 sound samples. No Teardown code or assets were copied. Keep upstream notices if code is reused later.
- Locked direct dependencies: `three@0.186.1`, `playwright@1.58.2`, `esbuild@0.28.1`, `@fontsource-variable/inter@5.3.0`, `@fontsource/jetbrains-mono@5.3.0`. Node 18+; build `node sims/build.mjs`; browser capture `node sims/capture.mjs`; Chromium required, ffmpeg for MP4, Python for sound scoring. GPU shaders need WebGL; Chromium may use SwiftShader.
- Inspected `sims/kit/{runtime,stage3d,warm,director,util,hud}.js`, `sims/build.mjs`, `sims/capture.mjs`, `sims/v8-shared/`, `sims/cessna-shared/`, `sims/strandbeest-shared/`, `SKILL.md`, `LICENSE`, dependency lockfiles, and model/stage/animation/quality/section/live-control modules.
- Built all six examples. Captured and reviewed `v8-film` at 2.5 seconds, 960×600, DPR 1. Its procedural model and instrumentation use the same mathematical state. `v8-live` does not expose the capture script's `SIM.render(t)` readiness contract; the dedicated deterministic film example does.
- Confirmed patterns: procedural geometry, state-derived animation, seeded deterministic utilities, `render(t)`, clipping/stencil caps, component isolation, guided camera framing, PBR/studio lighting, shader warm-up, manually selected GPU tiers, fixed-frame browser capture, visual review and standalone offline HTML.
- Rejected engine-specific mechanics, music-driven cinematic direction, fixed 1600×900 assumptions and Teardown's post-processing stack for this architecture editor. They either conflict with responsive UNFOLD state or add cost without improving plan fidelity.

## Implementation

- Added transactional `RemoveWall` to the existing spatial command and `spatial_scene.v1` model. It resolves a shared wall between exactly two related rooms, validates simple polygons and the merged boundary, removes dependent wall/opening nodes, updates area/provenance and exposes explicit unknown structural implications. The operation is atomic and undo/redo restores canonical state.
- Added deterministic fixture A (`case-a-floor-plan.svg`, PNG and independent `case-a-ground-truth.json`) outside the geometry builder. Added test coverage for snapping, scale, polygon topology, adjacency, shared-wall union, rejection and rollback, plus opening placement.
- Added render-only isolate and x-axis cutaway to the existing editor. Component identity, dimensions and provenance remain in the inspector. Neither transient view changes serialized scene data; exiting/rebuilding restores model state.
- Added `RemoveWall` to the spatial-agent and command protocol. The natural-language action still requires an explicit room target and explicit commit; no structural-safety assertion is made.
- Adapted the Case-B CDP test to accept fixture, evidence directory, image dimensions and CDP port. Added a live image-analysis browser E2E and a reproducible screenshot contact-sheet script.
- No replacement of UNFOLD Core, renderer-owned truth, canonical graph or Meta provider was made.

## Verification

- `npm test -- --reporter=dot`: **PASS**, 43 files / 245 tests.
- `npm run build`: **PASS**; existing warning remains for the 586.26 kB minified `OrbitControls` chunk.
- `git diff --check`: final status recorded below.
- Browser: real UNFOLD app at `http://127.0.0.1:5191/demo`, Chromium 155, controlled 1440×1000 viewport, DPR 1. The dedicated backend was bound to port 8798, allowed only origin `http://127.0.0.1:5191`, and capped at 3 Meta provider calls. A first request against an unrelated sibling backend was rejected with `INVALID_ORIGIN` before Meta; that process/worktree was left untouched and no provider call was spent.
- Case A: uploaded the 1200×800 raster in the editor, switched to tracing view, manually traced 7 unique wall candidates, selected 2 wall-supported room candidates, calibrated 1000 px to 10 m and assembled 2 rooms / 7 walls. Measurements: 6×5 m and 4×5.00000025 m, each under 0.00001% relative error against fixture truth and inside the 1% tolerance. Eight `bounded_by` room-wall relations passed. Browser selection resolved the shared wall and showed dimensions/provenance. Isolate and cutaway screenshots were taken; serialized `spatial_scene.v1` exactly matched before and after. E2E JSON: [Case A](evidence/case-a/case-a-e2e.json).
- Case A door limitation: the raster/ground truth includes a 1.12 m door in the shared wall. The browser scene did not place the door; unit tests exercised its parametric opening placement, then wall merge and exact undo. Do not claim browser reconstruction of the opening.
- Case B manual geometry: four hand-traced perimeter walls produced four wall boxes in revision 10, no room nodes, polygons or relations. Selected calibration: top `50′-3½″` = 15.3289 m. The top traced wall measured 15.828900 m (+3.26%); the bottom traced wall was 15.328900 m against the separate `51′-0″` = 15.5448 m (−1.39%); a side wall was 8.270787 m against printed `27′-4½″` = 8.3439 m (−0.88%). The 2.72 m height and 0.15 m wall thickness are explicit test assumptions. Mapping validation remains `unreviewed`. Geometry JSON: [Case B scene](evidence/case-b-manual/plan-1d78e739dad5.spatial-scene.json); run: [Case B browser E2E](evidence/case-b-manual/second-plan-e2e.json).
- Case B browser tests also passed the existing wall length preview → commit → undo/redo, persistence restore, GLB HTTP 200, Four-Bar regression and viewport overflow checks. Touch was emulated in Chromium, not tested on a physical phone. Browser console errors: 0.
- Performance: 91 animation-frame intervals, mean 16.44 ms, p50 16.7 ms, p95 16.7 ms. Renderer string is `ANGLE … SwiftShader …`; this is software, not integrated-GPU evidence. The app readout concurrently showed 25 FPS. No hardware performance acceptance is claimed.
- Captures were reviewed as a contact sheet: [Phase 10 contact sheet](evidence/phase-10-contact-sheet.png). The images are visual review evidence, not a GPU-independent pixel-equality assertion.

## Real Meta evidence

Configured provider: Muse Spark `muse-spark-1.3`, endpoint `https://api.meta.ai/v1/responses`. No request was retried. Current capped run consumed exactly 3/3 calls:

| Call | Provider request ID | Result | Latency | Usage | Estimated cost |
|---|---|---|---:|---:|---:|
| Spatial command, `RemoveWall` prompt | `7cd7bcef-e209-4582-a19a-79b640092b89` | HTTP 200, parsed `REQUEST_CLARIFICATION`; no action | 18,900 ms | 758 in / 2,849 out | $0.01305575 |
| Case B recognition | `4f811004-40d4-4fa9-86e1-7aa83f14c959` | HTTP 200, parsed | 5,956 ms | 4,187 in / 295 out | $0.00648750 |
| Case B extraction | `6b8f2db5-5889-4b0b-b05d-60f91706f30e` | HTTP 200, parsed to architectural technical document | 42,145 ms | 4,323 in / 6,681 out | $0.03379800 |

Current-run total: 9,268 input / 9,825 output tokens; estimated `$0.05334125`, from project rate calculation, not a billing statement. This cap is a local per-process ceiling and does not imply available account quota. [Official Meta pricing and rate limits](https://dev.meta.ai/docs/pricing-rate-limits).

The live Case-B UI showed ROOM A–D, central HALL, two PORCH regions, stairs, doors/windows and inferred adjacencies. It preserved uncertainty around fractions, porch orientation, openings and wall material notes, and did not produce measured room areas or calibrated coordinates. Analysis evidence: [Case B live E2E JSON](evidence/case-b/case-b-live-e2e.json), [browser screenshot](evidence/case-b/03-meta-analysis.png). The click to transfer the document to the editor occurred, but the first screenshot was taken before async IndexedDB source loading completed; the semantic-map handoff and human acceptance of a room-region link are therefore **not verified**.

Historical Meta calls are reported separately in the preceding Phase 10 checkpoint and are not included in this run's 3/3 cap or cost. SAM 3.1 was not called: the checked-in provider client does not expose it. No live provider-failure test was run.

## Case B source and attribution

Image: Library of Congress, Prints & Photographs Division, Historic American Buildings Survey, Amoureaux House, HABS MO-1113, first-floor plan, sheet 3/10; 3700×2996 PNG, SHA-256 `1d78e739dad5...`. The LOC record states no known restrictions for images made by the U.S. Government and cautions that content copied from other sources may have restrictions. Attribution is retained here and in the live E2E artifact. [Sheet 3/10](https://www.loc.gov/resource/hhh.mo0247.sheet/?sp=3), [LOC item record](https://www.loc.gov/pictures/item/mo0247/).

The two printed overall widths (`50′-3½″` north and `51′-0″` south) are kept separate. Calibration used the north dimension; no model-inferred dimensions were used as coordinates. Only the four explicitly traced perimeter walls were assembled. Untraced rooms, stairs, windows and doors are not represented in the Case B scene.

## Open-source geometry acceleration checkpoint

Research ran in isolated checkouts under `/tmp/unfold-phase10-research`; no external frontend, pretrained weights or runtime dependency was copied into UNFOLD.

| Project / source revision | License and dependencies | Verified behavior and decision |
|---|---|---|
| [OpenPlan3D](https://github.com/laanlabs/openPlan3D), `98f9cb467e4045c6abc5d9880ada1f03dff50c68` | MIT; SvelteKit 2, Svelte 5, TypeScript, Three.js 0.182.0 | `src/lib/utils/roomDetection.ts:22-128,164-317` splits intersections, forms an angular half-edge graph, traces faces and rejects exterior cycles; upstream tests `tests/overlapping-rooms.test.ts` and `tests/rooms.test.ts` cover overlap, dividers, closure and nesting. Inputs are already vectorized; fixed 5 cm tolerance and `Date.now()` IDs (`roomDetection.ts:299-307`) are unsuitable for direct use. `roomplanImport.ts` handles structured Apple RoomPlan data, not raster drawings. Reused as an algorithmic comparison; no duplicate face-tracing port because UNFOLD already has intersection splitting, T-junction snapping and bounded-face tracing. |
| [R2V-to-Plan2Scene](https://github.com/3dlg-hcvc/r2v-to-plan2scene), `5f6d68d2e57c68953205567fd00d3ccd42d80f99` | MIT; legacy SciPy/Shapely/Pillow/NumPy stack | `convert.py:18-56` accepts vector candidates, then splits walls, detects rooms, assigns openings and derives room-door-room relations; cycle tracing is in `code/src/r2vstk/util.py:34-95`, room-door incidence in `house.py:243-260`. These informed the new canonical relations below. It does not supply raster coordinates; exterior heuristics and Manhattan-only split tolerances were not transplanted. Converter was not run because Shapely is absent and the available SciPy/NumPy versions conflict. |
| [FloorplanTransformation](https://github.com/art-programmer/FloorplanTransformation), `929e7a309e300fbf1d8c77fb2277e5744cdca43e` | MIT; Torch7/Python 2/CUDA 8/Gurobi original; legacy PyTorch fork pins Torch 1.0 and old dependencies | `pytorch/IP.py:1171-1294,1340-1365,1458-1488,1626-1678` formulates binary junction/edge/opening/semantic-label selection with conflict exclusion and door-to-selected-wall incidence. Useful as a global constraint reference, but it depends on trained heatmaps and axis-aligned candidate classes; not integrated as runtime. |
| [Raster2Seq](https://github.com/Cornell-VAILab/Raster2Seq), `d938188027cd4f2bed9f95c883e5cc6d80b507f5` | Source MIT; published weights separately CC BY-NC 4.0 | `engine.py:854-951` emits room polygon sequences, not walls, shared topology, metric scale or room-door connectivity. Runtime requires PyTorch, compiled extensions and CUDA-oriented code; this environment lacks PyTorch/CUDA. Weights were not downloaded or used because their noncommercial license is incompatible with commercial distribution. Deferred. |

OpenPlan3D and R2V both confirm that topology operates on already-vectorized geometry; neither recovers the absent Case-B wall coordinates from the existing Meta document. OpenPlan3D's wall profiles and RoomPlan-specific import/validation are not imported: UNFOLD already has parametric walls/openings in metres and an existing canonical transaction model. Floorplan3D, Plan2Scene, That Open, RoomFormer, react-planner, FloorplanToBlender3d and CubiCasa5K were not cloned in this increment: they do not address the observed missing raster coordinates more directly. In particular, GPL-3.0 code and CC BY-NC datasets/weights were not integrated.

### UNFOLD adaptation and measured Case-B candidate result

- Added canonical `adjacent_to` relations when two generated room polygons share a wall. Adding an explicit door to that wall adds bidirectional `connected_to` edges between each room and the door, yielding a room → door → room path. Relations are marked derived/unreviewed. Existing `RemoveWall` transaction removes the shared wall, door and now-invalid relations; undo restores the original node and relation arrays.
- Case A assertions cover the shared-wall adjacency, room-door connectivity and relation cleanup on wall merge. This adapts R2V's room-door incidence concept to `spatial_scene.v1`; it does not import its scene format.
- New browser E2E: `tests/e2e/phase-10-case-b-detection.cdp.mjs`. On the real HABS raster, UNFOLD detected 162 wall-line candidates, selected 36, proposed 3 orthogonal rectangles (IDs `room-782-742-1679-1357`, `room-782-1391-1679-1881`, `room-1911-742-2925-1357`), excluded 11 low-quality faces, traced 0 exact graph cycles and proposed 9 ambiguous opening candidates. The first/third rectangles cross visible internal divisions and the fourth labelled room is absent. The candidates were rejected as room reconstructions; no Case-B polygons were committed. Browser evidence: [candidate report](evidence/case-b-detection/case-b-detection.json), [detected overlay](evidence/case-b-detection/02-detected-regions.png).
- Compared with the prior 4-wall perimeter-only canonical scene, the current raster detector can now surface three unreviewed room-shaped candidates, but it does not improve validated room count (still 0), confirmed opening count (0), or dimension error. This is a measured candidate-generation result, not a complete Case-B reconstruction.
- No real Meta calls were made in this increment. The previous 3-call result is reused as evidence; configured provider quota/capacity was not re-authorized or inspected for a new call. Historical request IDs and usage remain as recorded above.

### Reuse assessment

- Adapted into working UNFOLD code: one R2V-inspired room/door relation builder over the existing wall/room nodes; tests cover derive, remove and undo behavior.
- Already present in UNFOLD, so not duplicated: line consolidation, intersection detection, endpoint/T-junction snapping, half-edge face walks, exterior/sliver filters, room polygons, parametric openings and transactional geometry edits.
- Deferred: external OpenPlan3D face-tracer port, R2V converter, FloorplanTransformation solver, Raster2Seq inference, BIM fragment engine and texture/CAD pipelines. External algorithms either require vectors unavailable from Meta, duplicate the current graph, carry incompatible assumptions, or impose dependency/license costs.
- Estimated engineering time avoided: approximately 1–3 engineer-hours for room-door relationship derivation and its basic graph cases, assuming direct MIT code reuse would still require unit conversion, stable IDs, provenance and transaction integration. This is a bounded estimate, not a project-wide reduction claim. The adaptation itself took less than one focused implementation pass; maintenance risk is low because no external runtime dependency or copied source is present.
- External code copied: zero lines. License attribution is documented here; UNFOLD owns the adapter and canonical serialization.

## Acceptance matrix

| Test | Status | Evidence / limit |
|---|---|---|
| Meta connectivity | PASS | Real provider responses, parsed and contributed to the UNFOLD UI |
| Case B Meta grounding | PASS | Actual plan extracted into semantic document with uncertainties; no coordinates |
| Case A plan-to-3D, dimensions and topology | PASS | Browser scene and independent geometry assertions; opening browser coverage remains partial |
| Case B Meta-to-scene handoff and accepted semantic link | BLOCKED | First handoff screenshot preceded async load; no accepted region mapping recorded |
| Case B raster candidates | PARTIAL | 210 raw → 162 fused line candidates; four room-shaped proposals visually align with Rooms A–D but remain unreviewed; 110 rejected faces/rectangles diagnosed; 0 exact cycles; 9 ambiguous opening candidates |
| Case B complete plan reconstruction | BLOCKED | Canonical scene remains the earlier four-wall tracing; no Case-B room polygons or openings committed; central hall unresolved; two prior width errors exceed 1% |
| Component inspection, isolate and cutaway | PASS | Correct identity/provenance and render-only state restoration |
| RemoveWall transactional geometry / undo | PASS | Unit tests cover valid merge, invalid polygon blocking and canonical rollback/restore |
| RemoveWall live agent proposal/commit/undo | BLOCKED | Real model requested clarification; no proposal was committed |
| Browser spatial edit / undo / redo | PASS | Wall resize preview/commit/undo/redo and save/restore verified |
| Visual capture and browser console | PASS | Deterministic viewport captures reviewed; 0 browser errors |
| Integrated GPU frame target | BLOCKED | Only SwiftShader p95 sample available |
| SAM 3.1 | NOT RUN | No supported client in this checkout |
| Live provider failure path | NOT RUN | No call budget was spent on a deliberate failure |

## Increment verification and Git checkpoint

- Focused geometry test: **PASS**, 12 tests in `tests/plan-reconstruction.test.ts`.
- Full unit suite: **PASS**, 43 files / 245 tests.
- Production build: **PASS**, with the existing 586.26 kB `OrbitControls` chunk warning.
- Browser Case B detection E2E: **PASS_CANDIDATES_ONLY**, Chromium 1440×1000, DPR 1, 0 browser errors, 0 Meta requests. It intentionally fails the room-reconstruction acceptance because proposed rectangles contradict visible partitions.
- Existing Case-B browser flow rerun: **PASS** for four-wall manual-trace, edit/commit/undo/redo, persistence, GLB loading and Four-Bar regression; no Meta calls; 0 browser errors. Performance was p95 16.7 ms only under SwiftShader and is not GPU evidence.
- Browser screenshot review: candidate detector misses the fourth room and produces rectangles crossing partitions. No new semantic link, wall trace, scale confirmation or canonical Case-B commit was made.
- Working branch: `phase-10-open-source-geometry-acceleration`, created from verified `46c72ce0b18b48dbbb136062fc64396b804b09e8`; commit SHA is recorded after this report update.
- Reproduction: `UNFOLD_E2E_URL=http://127.0.0.1:5192 UNFOLD_CDP_PORT=9227 UNFOLD_EVIDENCE_DIR=reports/phase-10-teardown/evidence/case-b-detection node tests/e2e/phase-10-case-b-detection.cdp.mjs`; the pre-existing Case-B interaction test is `node tests/e2e/phase-8d-second-plan.cdp.mjs` with `UNFOLD_PLAN_FIXTURE`, `UNFOLD_PLAN_WIDTH`, `UNFOLD_PLAN_HEIGHT` set as above.

## Remaining work

1. Fix the Case-B handoff E2E to wait for source image and document context before capture, accept a human-reviewed semantic link, and build a reviewed set of room polygons/openings. Reconcile errors against the two distinct printed widths.
2. In a fresh explicitly capped session, resolve the target room in the natural-language request and execute one live `RemoveWall` inference that returns a valid proposal; then browser-test preview, explicit commit and exact undo/redo. Do not assert structural safety.
3. Measure 91 frames on actual integrated-GPU hardware. Keep the current SwiftShader sample labelled software-only.
4. Wire SAM only if the official Meta API and configured credentials support it; otherwise keep it `NOT RUN`.

## Reproduction

Unit/build and local browser commands:

```sh
npm test -- --reporter=dot
npm run build
UNFOLD_BACKEND_PORT=8798 UNFOLD_ALLOWED_ORIGINS=http://127.0.0.1:5191 UNFOLD_ACCEPTANCE_MAX_META_CALLS=3 node --env-file=.env --import tsx server/index.ts
UNFOLD_API_TARGET=http://127.0.0.1:8798 npm run dev -- --host 127.0.0.1 --port 5191
UNFOLD_CDP_PORT=9227 node tests/e2e/phase-10-case-a.cdp.mjs
UNFOLD_CDP_PORT=9227 UNFOLD_PLAN_FIXTURE=reports/phase-10-teardown/fixtures/amoureaux-house-plan.png node tests/e2e/phase-10-case-b-live.cdp.mjs
UNFOLD_CDP_PORT=9227 UNFOLD_PLAN_FIXTURE=reports/phase-10-teardown/fixtures/amoureaux-house-plan.png UNFOLD_PLAN_WIDTH=3700 UNFOLD_PLAN_HEIGHT=2996 UNFOLD_EVIDENCE_DIR=reports/phase-10-teardown/evidence/case-b-manual node tests/e2e/phase-8d-second-plan.cdp.mjs
python3 reports/phase-10-teardown/create-contact-sheet.py
```

The two live E2E commands above used 3 provider calls total (1 spatial-agent call, then 2 image stages). Their saved evidence must not be reported as successful geometry unless all downstream assertions pass. The later Spatial Evidence Debugger increment and its checkpoint are recorded below.

## Spatial Evidence Debugger increment (2026-11-01)

This increment attacks raster evidence extraction and its diagnostics. It does not close Case B.

- Added crop, deskew (±15°) and user-selected rectangular annotation masks on an analysis-only raster. The original image stays byte-identical. A derived-to-source coordinate map returns every detected endpoint to the original pixel frame before topology or Scene Graph construction.
- Added a raw-vs-fused line overlay. Browser evidence for the unprocessed HABS image: **210 raster segments → 162 fused candidates**. Fused candidate IDs retain contributing source segment IDs.
- Added individual face rejection codes (`area_below_minimum`, `low_compactness`, `too_few_boundary_edges`, `self_intersection_or_degenerate_edge`, `crosses_supported_partition`) and displays the rejected polygon, IDs, intersections/junction type, ambiguous opening reason, and source line provenance in the overlay/debug list. Automatic regions and walls are no longer preselected for construction.
- Multi-dimension calibration fits pixels/metre by least squares and reports each residual, RMS, maximum residual, and inter-scale spread. Construction is blocked when either residual or scale spread exceeds 1%. The browser E2E used two explicitly synthetic contradictory inputs (100 px for 10.0 m, then 100 px for 10.5 m): maximum residual 2.56%, inter-scale spread 4.76%, and the UI blocked the build. These values are a test fixture, not HABS measurements.
- HABS diagnostic run, viewport 1440×1000, DPR 1: 210 raw raster segments fused to 162 candidates, 110 individually listed rejected faces/rectangles, 151 intersection/snap markers, 9 ambiguous opening candidates, 4 unreviewed orthogonal proposals, and zero exact cycles. None was preselected or committed. The four proposal outlines align visually with labelled Rooms A–D in the source; the central hall/corridor remains unresolved, and semantic associations, dimensions, doors and adjacency are not yet accepted.
- Applying crop `(600,600,2900,2100)` and deskew `0.5°` retained the original 3700×2996 raster and mapped coordinates back to the original frame. It raised the candidate count from 162 to **209**. No precision gain was established; preprocessing is an operator-controlled option and these settings should not be treated as a recommended HABS crop.
- No Meta request was made. Existing Muse Spark output was reused; it supplies room semantics/dimension ambiguity, not wall coordinates. The actual HABS cotas were not calibrated in this browser run, so the two prior >1% dimension errors remain unresolved. Door-to-wall placement and complete room adjacency are not verified.
- Screenshots and machine-readable result are under `evidence/case-b-debugger/`: `01-uploaded-source.png`, `02-detected-regions.png`, `03-expanded-evidence-debugger.png`, `04-preprocessed-evidence-overlay.png`, `case-b-detection.json`. The HABS source credit and source SHA remain recorded above.

Verification for this increment:

- Focused geometry tests: **PASS**, 15 tests in `tests/plan-reconstruction.test.ts`.
- Full unit suite: **PASS**, 43 files / 248 tests.
- Production build: **PASS**, existing 586.26 kB OrbitControls chunk warning remains.
- Browser E2E: **PASS_CANDIDATES_ONLY**, Chromium DevTools, 1440×1000, DPR 1, no browser errors; checks raw/fused lines, 110 rejection diagnostics, expanded debugger width of 1080 CSS px, crop/deskew coordinate mapping, unchanged source dimensions, and inconsistent scale refusal. It does **not** pass Case B reconstruction.
- Real Meta inference: **NOT RUN** in this increment; no newly verified quota/call budget was available.
- Case B accepted room polygons, openings, dimensional calibration, wall edit/undo against a completed Case B model: **BLOCKED** by unresolved raster segmentation and the absent human-reviewed geometry associations.

Reproduction for this increment:

```sh
npm test -- --reporter=dot
npm run build
npm run dev -- --host 127.0.0.1 --port 5192 --strictPort
UNFOLD_E2E_URL=http://127.0.0.1:5192 UNFOLD_CDP_PORT=9227 UNFOLD_EVIDENCE_DIR=reports/phase-10-teardown/evidence/case-b-debugger node tests/e2e/phase-10-case-b-detection.cdp.mjs
```

Git checkpoint for the implementation and captured E2E evidence: branch `phase-10-open-source-geometry-acceleration`, commit `0d43e0c` (`Improve floor plan evidence debugging and calibration`). Changed files: `src/plan-reconstruction.ts`, `src/plan-scene.ts`, `src/spatial-editor.ts`, `src/spatial-editor.css`, `tests/plan-reconstruction.test.ts`, `tests/e2e/phase-10-case-b-detection.cdp.mjs`, this report, and five HABS browser evidence artifacts under `evidence/case-b-debugger/`. No Meta credentials or new API calls are part of this commit.
