# UNFOLD Phase 10 — Teardown, live Meta, and drawing-to-world

Date: 2026-11-01
Branch: `phase-10-teardown-meta-drawing-acceleration`
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

## Acceptance matrix

| Test | Status | Evidence / limit |
|---|---|---|
| Meta connectivity | PASS | Real provider responses, parsed and contributed to the UNFOLD UI |
| Case B Meta grounding | PASS | Actual plan extracted into semantic document with uncertainties; no coordinates |
| Case A plan-to-3D, dimensions and topology | PASS | Browser scene and independent geometry assertions; opening browser coverage remains partial |
| Case B Meta-to-scene handoff and accepted semantic link | BLOCKED | First handoff screenshot preceded async load; no accepted region mapping recorded |
| Case B complete plan reconstruction | BLOCKED | Four perimeter walls only; no room polygons/relations and two width errors exceed 1% |
| Component inspection, isolate and cutaway | PASS | Correct identity/provenance and render-only state restoration |
| RemoveWall transactional geometry / undo | PASS | Unit tests cover valid merge, invalid polygon blocking and canonical rollback/restore |
| RemoveWall live agent proposal/commit/undo | BLOCKED | Real model requested clarification; no proposal was committed |
| Browser spatial edit / undo / redo | PASS | Wall resize preview/commit/undo/redo and save/restore verified |
| Visual capture and browser console | PASS | Deterministic viewport captures reviewed; 0 browser errors |
| Integrated GPU frame target | BLOCKED | Only SwiftShader p95 sample available |
| SAM 3.1 | NOT RUN | No supported client in this checkout |
| Live provider failure path | NOT RUN | No call budget was spent on a deliberate failure |

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

The two live E2E commands use 3 provider calls total (1 spatial-agent call, then 2 image stages). Their saved evidence must not be reported as successful geometry unless all downstream assertions pass. Current implementation changes are uncommitted unless the repository checkpoint below says otherwise.
