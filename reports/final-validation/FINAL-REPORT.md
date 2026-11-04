# UNFOLD — final integration and delivery report

Branch `feat/unfold-final-integration`, stacked on PR #25 and containing, merged in with their history: the Spatial Presentation Director (#26) and Anatomy (#21). Nothing is merged into `main`. SHA and PR: see the PR description (the head moves only by documentation after the validation runs; the code that was validated is named in `PROTOCOL.md`, and the one later change to `src/` is listed under «Changes after the paid runs»).

## Verdict

| | Verdict | Why |
|---|---|---|
| **Demo** | **GO, with a scripted path** | The whole path works in a real browser on the real stage: New Space → text or image → Meta → review → cinematic build → explore → edit with preview and undo → save and reopen → another Space, with no GPU growth and a clean console, on desktop and in a phone viewport. The model's output varies run to run, so the demo should use the prepared prompts below and keep the Foundry excavator as the opening. |
| **Production** | **NO-GO** | No authentication, in-memory server sessions, a single local origin, unverified reviewer identity, local-only persistence, no real-GPU or real-device testing, and the model's quality is not reliable enough to promise. Full list at the end. |

## What the product does now (verified in a browser, Chromium + SwiftShader)

| Step | State | Evidence |
|---|---|---|
| Foundry excavator (existing example) | unchanged; regression E2E pass (`unified-living` 26 checks, `unified-lifecycle` 6) | `runs/foundry-comparison/` |
| New Space entry in the `/living` intake | works | `runs/*/01-entry.png`, `02-new-space.png` |
| Text or image request, progress, cancel, errors | works; errors name the code and say nothing was simulated | `03-waiting.png`; e2e |
| Meta Muse Spark proposal | works (see live results) | `RESULTS.json` |
| Human review, component by component | works; observed / inferred / approximation / unknown are counted and explained; build is blocked until every component is decided and the plan is acknowledged | `04-review.png`, `05-reviewed.png` |
| Cinematic build | the Presentation Director (#26) enters the parts in structural order and issues camera cues through the workspace arbiter; it is a presentation, not a simulation | `06-built.png`, video |
| Free exploration, selection and focus | pointer selection, orbit, frame, isolate; selection moves the camera target without zooming | `07`, `08`, `12`, `13` |
| Exploded view | generic, reversible, always announced as a visualisation | `13b-exploded.png` |
| Inspector and provenance | per-property provenance, evidence, parameters | `08`, `14-evidence.png` |
| Edit with preview, authorisation and undo | works; edits are mirrored to a server session | `09`, `10`, `11` |
| Meta edit by text, proposal mode | works in a real run: the proposal is previewed and nothing changes until it is authorised | `final-text-street-lamp/13c-meta-proposal.png` |
| Verified capture and visual evaluation | the capture is verified (shadow-free object mask) and respects the call budget; **the real model's evaluation reply was rejected by validation in the one real attempt** (see below) | `13d-visual-evaluation.png` (mock), `RESULTS.json` |
| Save, list, reopen, delete (My Spaces) | works; local to this browser, versioned, checksummed, limited; damaged records are never opened | `13f-my-spaces.png`, `13g-reopened.png`, `tests/spatial-space-store.test.ts` |
| Leave guard for unsaved work | works | `13e-leave-guard.png` |
| Change Space | frees the previous one (geometries and textures return to the initial count) | `gpu` in each `e2e-result.json` |
| Anatomy as a Space provider | the educational heart atlas (11 structures) on the same stage with the same inspector, selection, isolate and exploded view; labelled educational, not a reconstruction of the source, not clinical, no scale | `runs/atlas-desktop/`, `atlas-mobile/` |

The same stage, camera, inspector, composer and notices serve the excavator, a Space and the atlas. There is no second renderer.

## Real Meta results

Protocol and budget were written before the paid runs (`PROTOCOL.md`): cap of 6 calls, 4 planned, 2 in reserve; one attempt per scenario; the object was drawn after the code was frozen. **4 calls were used, the reserve was not.** Known cost is about US$ 0.06 (partly derived from usage figures, not a bill). Details, request ids, hashes and plans: `RESULTS.json`. The raw responses are stored server-side only (owner-only files, git-ignored).

1. **Unexpected object, text: «a street lamp with a curved arm»** (5 components, muse-spark-1.3, 28 s). Built whole it is clearly a street lamp (pole, base, outreach arm, luminaire; the luminaire is small). The edit proposal arrived, was previewed and was refused without authorisation. **The visual evaluation failed**: the model's reply did not pass our validation (`SPATIAL_V2_EVALUATION_INVALID`), the UI said so and changed nothing. The reply was not stored, so the cause is not known.
2. **Image: the CC BY-SA 3.0 «Diagram of the human heart»** (Wikimedia Commons), the only image on this machine whose licence permits sending it to a provider. It is an illustration, not a photograph. 12 components, 44 s. A schematic heart is recognisable (two large chambers, the arch and great vessels); three vessels float detached, and the assembly check says so.
3. **Anatomy**: the atlas has no model call. The Meta image-to-atlas review from #21 is not wired into the workspace and was not validated here.

**A defect in my own evidence, found and disclosed.** The E2E script rejected the last listed component in every mode to exercise the rejection path, so both live runs were built without it (the street lamp without its luminaire; the heart without `valve-rings`). It was an automated decision, not a human review and not the model's omission. I noticed it when the lamp looked headless, and limited that step to the labelled fixture. I did not spend a second paid call to redo the live runs; the street-lamp plan built whole is shown by a replay of the stored plan (`runs/replay-street-lamp-*`, no model call, labelled as a replay).

**Human recognition.** The assistant's own judgement is recorded in `RESULTS.json`. The `humanRecognition` field is empty on purpose: it is for a person to fill in after looking at the screenshots and the video.

## Visual comparison with the Foundry

`runs/foundry-comparison/comparison.png`: same stage, same viewport, same lights. The Foundry excavator is a hand-built, detailed model (articulated, with premium materials). A Space is a primitive composition proposed by a model: it shares the stage, the lighting and the finish, but it has far less detail and its quality depends on the answer. The product does not claim parity; it labels a Space as an AI concept.

## Tests and build

`npm test`: 132 files, 2 281 tests, all passing with `--testTimeout=60000` (two older tests time out at the default 5 s when the machine is loaded and pass alone). `npm run build` and `tsc --noEmit` pass. E2E in Chromium + SwiftShader at 1440×900 and 390×844: mock-fixture (desktop and phone), replay of the real street-lamp plan (desktop and phone), atlas (desktop and phone), real text run, real image run. Console errors: none, except the single expected `422` in the real run whose evaluation reply was rejected.

## Branch and merge plan (G)

The stack is linear (#22 → #23 → #24 → #25 → #26), and this branch contains all of it plus #21. Recommended: **one merge commit of this branch into `main`** (not squash, not rebase). Every stacked PR head is then an ancestor of `main`, so GitHub marks #21 to #26 as merged, history is kept and nothing is duplicated. The alternative of merging each PR in order works but needs each base retargeted after every merge. `main` has not moved since #20 (`e197d07`), which this branch already contains.

PR #21 reviewed separately: the only conflict was `server/meta-server.ts`; both sets of routes, guards, rate limits and body limits are kept and the paid-route coverage test passes. Its Meta image-to-atlas flow still lives on its own route and is not reachable from the workspace.

## How to run

```
npm ci
# backend: the key only in the backend process; evidence is optional
UNFOLD_LOCAL_ORIGINS=http://127.0.0.1:5191 UNFOLD_UPSTREAM_EVIDENCE=1 UNFOLD_UPSTREAM_EVIDENCE_DIR=$PWD/reports/space-integration/raw \
UNFOLD_ACCEPTANCE_MAX_META_CALLS=6 MODEL_API_KEY=... npx tsx server/index.ts
npx vite --port 5191          # open http://127.0.0.1:5191/living
npm run build                 # production build (static; the API still needs the backend)
node tests/e2e/space-workspace.pw.mjs              # mock: no model call
UNFOLD_SPACE_MODE=live node tests/e2e/space-workspace.pw.mjs   # real: paid calls
node tests/e2e/space-atlas.pw.mjs                  # anatomy atlas
node tests/e2e/space-vs-foundry.pw.mjs             # same-stage comparison
```

Short videos of the two real runs (screen recordings of the real browser session, re-encoded small, software-rendered so the motion is coarse): `reports/final-validation/video/real-meta-street-lamp-text.webm` and `real-meta-heart-illustration-image.webm`. The street-lamp video stops at the failed evaluation.

Prepared demo prompts (all tested at least once): «A grandfather pendulum clock: tall wooden case, round dial with hands, brass pendulum disc, and feet.», «A street lamp with a curved arm.», and the atlas button for anatomy.

## Limits stated plainly

- A Space is a conceptual composition of primitives from a model. It is not a measurement or a reconstruction, scale is unknown unless the person gave units, and the model sometimes produces parts that float apart or omit details.
- Entrance and exploded view are presentation only; no physics, kinematics or assembly procedure is implied.
- Visual evaluation scores are a model's opinion. Only one real evaluation was attempted and it failed validation.
- The atlas is educational (BodyParts3D 4.0, CC BY 4.0): not clinical, not physiological, no scale.
- Persistence is `localStorage` in one browser. It is not sync and not a backup.
- Validation ran on software rendering (SwiftShader); no real-GPU frame times and no physical phone. The phone check is a 390×844 viewport.

## Production blockers

1. **Authentication and authorisation**: none. The API trusts a localhost origin or a local token; reviewer identity is client-asserted.
2. **Server state**: sessions are in memory (30 minutes), the call budget is a file; no multi-instance, no durable store, no per-user quotas.
3. **Transport and origin**: HTTP on localhost only; no HTTPS, no production CORS or CSP, no secrets management beyond an environment variable.
4. **Data handling**: raw model output is kept only if evidence is switched on; it is model text and a source hash, but a retention and privacy policy is needed before any real user data.
5. **Model reliability**: output quality varies; no automatic retry or repair of invalid evaluation replies; the evaluation failure cause is unknown because the reply was not kept.
6. **Platform coverage**: no real-GPU, real-device, accessibility or browser-matrix testing; text is Portuguese only.
7. **Bundle size**: the main chunk is above 500 kB; no code splitting for the atlas or the Director.
8. **Licences and attribution**: the atlas and the heart illustration need their attributions visible in any public build (they are in the inspector and the repository, not in a credits screen).
9. **Cost control**: the call budget exists but there is no spend alerting; image requests are limited to four per minute per peer.

## Changes after the paid runs

One composition fix touched `src/` after the live runs: in a Space the object is now framed below the stacked notices instead of behind them (visible on a phone with the atlas). It changes no request, prompt, validation or model-facing code. The evidence in `runs/atlas-*`, `runs/replay-*` and `runs/mock-fixture*` was produced after it; `runs/final-*` (the two real runs) was produced before it.
