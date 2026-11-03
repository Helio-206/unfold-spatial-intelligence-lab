# Living Workspace + Engineering Engine — evidence (PR #15)

Base: `main` @ `1feb64e` (PR #14). Work continued from the uncommitted tree left by the previous session; nothing was reset or discarded.

## Renderer
All browser evidence was captured in **Chromium (system Google Chrome) with SwiftShader** (`--use-angle=swiftshader`). **No real GPU was tested.** Nothing here supports any claim about performance or WebGL behaviour on GPU hardware: NOT VERIFIED.

## Results (final tree)
| Check | Result |
|---|---|
| `npx vitest run --testTimeout=15000` | 90 files, 1694 tests passed |
| `npx tsc --noEmit` | clean |
| `npm run build` | passes |
| `git diff --check` | clean |
| `workspace-engine.pw.mjs` | 16 PASS (desktop 800x600 and mobile 390x844) |
| `workspace-engine-history.pw.mjs` | 4 PASS (2 cycles, with and without bfcache) |
| `workspace-engine-hand.pw.mjs` | 7 PASS |
| `workspace-engine-review.pw.mjs` | 6 PASS (review P2-1..P2-3, new) |
| `living-visual-foundry.pw.mjs` | 52/52 |
| `living-visual-foundry-regressions.pw.mjs` | 25/25 |
| `cinema.pw.mjs` | 189/189 |
| `cinema-history.pw.mjs` | 3 PASS |
| `living-workspace-review-regressions.pw.mjs` | 3 PASS |
| `living-workspace-selection-regressions.pw.mjs` | 4 PASS |

Raw logs were kept locally (ignored by git, not committed). Pose comparison (13 canonical parts, engine frame vs displayed transforms, tolerance 1e-9): `browser-results.json`. Screenshots: `engine-desktop.png`, `engine-mobile.png`.

Environment notes: the Visual Foundry suites default to `/opt/pw-browsers/chromium`, which does not exist on this machine; they were run with `CHROME_PATH=/usr/bin/google-chrome`. `cinema.pw.mjs` defaults to `http://127.0.0.1:5199`, which here was a stale dev server from the `unfold-living-cinema` worktree (older code, failed with `geometryStats is not a function`); it was re-run with `UNFOLD_E2E_URL` pointing at a dev server for this tree. That stale server was left running, untouched.

## Review follow-up (independent review of 55f48f3)
- P2-1: pending engine cards are now cancelled whenever the engine candidate is discarded (reset, newer proposal, seek, cancel). Red/green in `workspace-engine-review.pw.mjs`; the reset case was confirmed failing first.
- P2-2: the timeline thumb is synchronised on every valid sample and ignores updates during an active pointer drag. Confirmed failing without the fix (thumb stayed 0 while time reached 0.12 s).
- P2-3: the agent request says the engine is connected, computes poses and results, and that the assistant only proposes (user confirmation required, no execution). Unit test on `buildAgentRequest` plus a browser test of the real outgoing body (route intercepted, no model call). This does not establish live-model behaviour: NOT VERIFIED.
- Foundry main and Cinema were cut by a local 290 s timeout on the first attempt and re-run to completion with a longer limit.

## Provenance
- Poses displayed after an approved move come from `sampleEngineeringMotion`, validated by `validateMotionFrame` plus assembly id, digest, world frame and part-set checks before they reach the scene.
- A failed validation hides the machine, releases the Digital Hand and reports the error; it never keeps the previous geometry.
- Force is shown only when `forceStatus === 'computed'`; otherwise "desconhecida". A model reply that states a force is not shown as a result (E2E: "untrusted model cannot fabricate physical force").
- The assembly is the synthetic excavator fixture and is labelled "montagem sintética" in the UI.
- Historical fixture previews are reachable only through the explicit `fixtureDemo` option, and are labelled as fixture.

## Lifecycle
bfcache: canvas identity, selection, listener count, geometry and texture counts are unchanged after restore, and playback is paused. Without bfcache the page is rebuilt with time 0. Repeated `dispose()` releases once; disposing during playback leaves no frame loop and closes the engine session.

## Known limitations
- SwiftShader only (see above); no GPU or frame-rate claims.
- Assembly is synthetic; results are not measurements of a real machine.
- Isolating one component ghosts the others rather than removing them, so the Digital Hand keeps its target while another component is isolated. This behaviour predates the PR and was not changed.
- The engine move offered from the assistant is a fixed +0.05 m extension; numeric targets go through the inspector control.
