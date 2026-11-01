# UNFOLD Phase 10 — Teardown, live Meta, and drawing-to-world

Date: 2026-11-01
Branch: `phase-10-teardown-meta-drawing-acceleration`
Base: `62fe7eb118067d35140c02ed7410cf37f7e85c47`

## Result

**PARTIAL; vertical slice acceptance remains blocked.** The existing UNFOLD architecture was preserved. A render-only exploded view was added to the existing spatial editor and exercised in Chromium. A wall resize was previewed, committed to `spatial_scene.v1`, and undone. Teardown examples built and one deterministic frame was rendered. After the initial checkpoint, the local key was configured and three real Muse Spark calls succeeded, including image recognition and structured extraction of Case B. The image result still contains no coordinates and has not produced a calibrated scene. This report does not claim mission completion.

## Repository recovery

- The active project is `unfold-spatial-intelligence-lab`, not the parent directory. The current base observed at start was `62fe7eb` on `phase-10-grounded-spatial-intelligence`, with pre-existing untracked `reports/phase-10-1/`.
- The historical `b76debea4bb7adae65492bf946be3ff4d61a9ddd` checkpoint still exists in `unfold-spatial-intelligence-lab-final-stabilization`, but its package/SAM/E2E/fixture changes are uncommitted. Other Phase 10 stabilization worktrees also contain uncommitted changes. They were preserved and were not copied into this branch.
- The clean publication snapshot README's 238-test count matched the clean base: `npm test` passed 42 files / 238 tests. The historical “308 passing” count was not reproduced on this base.
- Node `v24.22.0`, npm `11.19.1`. `npm ci` installed the locked UNFOLD dependencies and reported 0 vulnerabilities. `npm run build` passed; Vite continues to report the pre-existing 586.26 kB `OrbitControls` chunk warning.

## Teardown source review

- Upstream: [`elvarofficial/teardown`](https://github.com/elvarofficial/teardown), exact checked-out commit `a91262ac1109051e014662d42ecb0b7bc1f113b1` (`main` at clone time).
- License: MIT, copyright notices for elvarofficial and whaleyxbt. `SKILL.md` attributes the kit, capture tools, sound engine, and review rules to `whaleyxbt/claude-motion` (MIT), and recorded samples to CC0 sources documented under `sfx/samples/SOURCES.md`. No Teardown source or assets were copied into UNFOLD; attribution is recorded here. If a substantial portion is copied later, retain its copyright and MIT license notice. Teardown's build uses esbuild `legalComments: "none"`; a redistributed bundled HTML should be checked for third-party license notice retention.
- Locked direct dependencies: `three@0.186.1`, `playwright@1.58.2`, `esbuild@0.28.1`, `@fontsource-variable/inter@5.3.0`, `@fontsource/jetbrains-mono@5.3.0`. Build requires Node 18+ and `node sims/build.mjs`; `npm run build` generated six standalone HTML examples (about 799–811 KB each). There is no dedicated unit-test command in this upstream package; browser capture is `node sims/capture.mjs` and requires Chromium. MP4 additionally requires ffmpeg; audio scoring uses Python.
- Files inspected: `sims/kit/{runtime,stage3d,warm,director,util,hud}.js`, `sims/build.mjs`, `sims/capture.mjs`, `SKILL.md`, `LICENSE`, `package.json`/lock, and shared V8/Cessna/Strandbeest model, stage, animation, quality-tier, section, and live-control modules. The examples use Three.js, WebGL, GPU shaders and post-processing. Browser GPU support is required for hardware rendering; Chromium can fall back to SwiftShader. Live experience and frame capture have different contracts: `v8-film` exposes `SIM.render(t)`, while `v8-live` is an interactive loop and is not accepted by the capture script's `SIM.render` readiness check.
- Confirmed behaviour: all six builds succeeded; `v8-film` was opened in headless Chrome and a frame at 2.5 seconds was captured and visually inspected at 960×600, DPR 1. Its V8 geometry and instrumentation render from the same crank-angle state. Screenshot: [Teardown V8 frame](evidence/teardown-v8-film-frame-2_5s.png).
- Confirmed engineering patterns: procedural geometry builders; mathematically derived poses from one state; seeded deterministic utilities; repeatable `render(t)`; local clipping with cap/stencil support in the V8 sample; component isolation and cut modes in its domain model; camera framing/punch-ins in the director; PBR/studio lighting and GTAO; shader warm-up including post-pass materials; manual adaptive GPU tiers; fixed-viewport frame stepping, screenshots and labelled contact sheets; standalone offline HTML output.
- Not adopted: engine-specific geometry/math, music-synced cinematic direction, post-processing stack, fixed 1600×900 compositor assumptions, or direct renderer ownership of architecture. These conflict with UNFOLD's canonical architectural scene and responsive editor or add cost without proving better plan fidelity. No production or deploy infrastructure was changed.

## Implementation

- Added `src/spatial-exploded-view.ts`: stable outward offsets derived from component positions, with validated inputs, deterministic tie-breaking and amount bounds.
- Integrated the `Explodir` / `Recompor` control into `src/spatial-editor.ts`. It caches renderer positions after building from the canonical graph and applies temporary offsets to Three.js objects. Scene commits clear the transient view and rebuild from the canonical model. The persisted transaction does not contain exploded offsets.
- Added unit coverage in `tests/spatial-exploded-view.test.ts` for determinism, zero-offset restoration, centroid ties and invalid values.
- Added `public/favicon.svg` and linked it in `index.html` after browser testing found Chrome's default `/favicon.ico` request returned 404.

## Verification evidence

Commands run on the isolated branch:

```sh
npm ci
npm test -- --reporter=dot
npm run build
git diff --check
```

- Initial clean-base suite: PASS, 42 files / 238 tests.
- After implementation: PASS, 43 files / 241 tests; focused new test: PASS, 3 tests.
- Production build: PASS. Existing large-chunk warning remains.
- `git diff --check`: PASS.
- Teardown: `npm ci && npm run build` PASS; `CHROMIUM=/usr/bin/google-chrome node sims/capture.mjs v8-film --still 2.5 --size 960x600 --dpr 1 --out /tmp/unfold-phase10-v8-film.png` PASS. An attempted `v8-live` capture timed out because that live page does not expose the frame-capture readiness contract; the dedicated `v8-film` capture succeeded.
- Browser E2E: Chromium 155, headless, viewport 1440×960, DPR 1, SwiftShader. The historical `spatial_scene_transaction.v1` with four manually constructed walls was loaded. UI selection resolved `wall-manual-8a14d645`. A 15.82890001016 m wall was previewed at +0.50 m (stored state unchanged during preview), committed at 16.32890001016 m, and restored to 15.82890001016 m with Undo. Exploded view toggled on/off; serialized canonical scene remained byte-identical during both render states. No browser errors after favicon correction. Evidence: [E2E result](evidence/spatial-editor-e2e.json), [preview](evidence/spatial-transform-preview.png), [committed edit](evidence/spatial-transform-committed.png), [exploded view](evidence/spatial-editor-exploded.png), [restored view](evidence/spatial-editor-restored.png).
- GPU observation: the test browser used SwiftShader software rendering, not an integrated GPU. The app's short in-page samples showed roughly 17–18 FPS in this emulated environment. This is not hardware performance evidence and is not a sustained benchmark.

## Live Meta and plan reconstruction

- The branch configures `https://api.meta.ai/v1/responses` with `muse-spark-1.3`; official docs list Muse Spark 1.3 and SAM 3.1 (`sam-3.1`) for the Responses API. [Responses API reference](https://dev.meta.ai/docs/api-reference/responses/create-response), [model availability](https://dev.meta.ai/docs/models), [SAM overview](https://dev.meta.ai/docs/sam/overview).
- The `.env` was checked for presence/non-empty `MODEL_API_KEY` without printing it. The server started with a hard cap of two calls for the image request. The one-call text probe plus the two-stage image route made **3 real calls**, all HTTP 200, no retries:
  - Text probe: request `163915db-4e62-4713-8134-72f6a24a44e4`, 4,614 ms, 19 input / 545 output tokens, estimated `$0.00234000`.
  - Image recognition: request `2aaf677d-51fe-4e33-9958-749e22719b4d`, 5,776 ms, 4,187 input / 333 output tokens, estimated `$0.00664900`.
  - Image extraction: request `7a2b9120-b040-486d-8546-c2372b592f46`, 30,799 ms, 4,324 input / 5,301 output tokens, estimated `$0.02793425`.
  - Aggregate usage: 8,530 input / 6,179 output tokens; estimated total `$0.03692325`. Estimates use the project's token-rate calculation, not a billing statement. [Current Meta pricing](https://dev.meta.ai/docs/pricing-rate-limits).
- The live image endpoint parsed the real result into `technical_recognition.v2` and `technical_document.v1`: architecture, first-floor survey plan, high legibility, 15 elements and 8 inferred relations. The application assessment returned `consistent`. This validates transport, response parsing and the existing semantic extraction route. It does **not** validate those claims against geometry: the model emitted no pixel coordinates, normalized polygons or calibrated wall segments, and its semantic assessment is not an independent geometry check. Full sanitized response: [live Case B extraction](evidence/live-plan-b.json).
- Case B is a local 3700×2996 image from the sibling Phase 9 worktree (`amoureaux-house-plan.png`; SHA-256 `1d78e739dad568ea49eb193416dc5f91c8b62b904a0170c63af803dd87750026`). Licensing/provenance is not established, so the source itself is not redistributed in this branch.
- In the editor, automatic detection produced noisy candidates. A manual perimeter trace produced four segments and two region candidates. Calibration then rejected two scale anchors, so no 3D scene was assembled. Captures: [source view](evidence/plan-b/B/01-original.png), [automatic candidates](evidence/plan-b/B/02-candidates.png), [manual trace](evidence/plan-b/B/03-manual-perimeter-tracing.png). No reconstruction error or topology score is available. Case A ground-truth reconstruction and Case B perception-to-3D remain **BLOCKED / NOT COMPLETED**.
- SAM 3.1 remains documented but is not wired into this branch and was not called. No live provider failure test was run.

## Acceptance matrix

| Criterion | Status | Evidence / limit |
|---|---|---|
| Original UNFOLD tests/build | PASS | 241 tests and production build on this branch |
| Canonical Scene Graph retained | PASS | Explode changes render positions only; serialized transaction unchanged |
| Meta text connectivity | PASS | Real Muse Spark probe, parsed output and metadata recorded above |
| Meta image extraction | PASS | Real two-stage image route produced parsed `technical_document.v1`; geometry-level grounding remains unverified |
| SAM 3.1 | NOT RUN | No SAM client in this branch; no SAM call made |
| Real plan perception-to-3D | BLOCKED | Live semantic extraction passed; scale anchors were rejected, so no 3D assembly followed |
| Geometry/topology against a plan | NOT RUN | No calibrated reconstruction was assembled; Case B has no established ground truth |
| Component selection | PASS | Browser selected stable wall ID from loaded scene |
| Cutaway | NOT RUN | No architectural cutaway implemented in this change |
| Spatial edit / validation / undo | PASS | +0.50 m wall preview, commit and undo verified in browser |
| Exploded render view | PASS | Toggle/recompose browser run; persisted scene byte-identical |
| Visual capture | PASS | Real UNFOLD and Teardown screenshots captured and reviewed; not a pixel-identical GPU regression assertion |
| Integrated-GPU performance | BLOCKED | Browser ran SwiftShader; observed 17–18 FPS is not hardware evidence |
| Controlled live provider failure | NOT RUN | No failure-path request was sent; offline boundary tests remain mocked |

## Audits and remaining work

1. **Functional:** checked helper edge cases, UI toggle, scene rebuild reset, actual wall preview/commit/undo and screenshots. Render-only state does not change canonical JSON. Plan upload/perception, cutaway, isolation and mobile browser acceptance remain open.
2. **Security/data integrity:** the credential was neither displayed nor logged; three real Meta calls completed. The new render control does not display or execute upstream model output. Offsets are bounded and finite-checked; IDs must be unique. Canonical transaction persistence is untouched. The underlying project still has no user authentication on its local development API; this local-only development server is not a production authorization boundary.
3. **Regression/maintenance:** baseline files remained untouched except the editor integration/index/fav icon. The full suite and build passed. The Vite bundle warning and real GPU performance are outstanding. No source code from Teardown was copied.

Reproduce the live text probe and server startup with `node --env-file=.env --import tsx server/probe.ts` and `node --env-file=.env --import tsx server/index.ts`. The image route was exercised with a one-request payload to `POST /api/meta/image`; the server was configured with `UNFOLD_ACCEPTANCE_MAX_META_CALLS=2`. Do not repeat it unless additional provider usage is intended.

Reproduction of the new helper test and app build:

```sh
npm test -- --reporter=dot tests/spatial-exploded-view.test.ts
npm run build
npm run dev -- --host 127.0.0.1 --port 5173
```

The recorded Playwright E2E used Playwright 1.58.2 from the isolated Teardown checkout with `/usr/bin/google-chrome`; it loaded the historical transaction referenced above and wrote screenshots plus JSON under `reports/phase-10-teardown/evidence/`. The live image route was a separate backend test; it did not generate the displayed 3D scene or verify geometric reconstruction accuracy.
