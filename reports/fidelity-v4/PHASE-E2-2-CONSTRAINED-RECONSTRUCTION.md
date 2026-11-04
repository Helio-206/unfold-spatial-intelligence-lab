# V4 E2.2 — constraint-preserving visual reconstruction

Branch `feat/v4-e2-2-constrained-reconstruction`; base `609fbf2b8c36a644f93497fdc30583de97644e84`. The current checkout SHA is obtained with `git rev-parse HEAD` (a commit cannot embed its own hash). V4 remains inactive and E0, E1.3, production workspaces, protected branches and existing PRs were not changed. No paid inference or merge.

## Verdict

**NO-GO for product/review-system integration.** Known-frame synthetic chains close throughout optimisation and one angle demonstrably improves on held-out views. The same tests also expose wrong hinge-angle signs and poor shape recovery despite increased IoU. Joint frames are supplied, not discovered. The three bodies are box proxies; there is no realistic bucket, physical validation, collision checking or photographic ground truth. The local preview guard is experimental, not connected to E0/E1.3, so it cannot guarantee safety of another consumer.

## E2.1 reproduction and cause

Running the inherited `scripts/benchmark/e21-lab/evaluate.ts` at the exact baseline reproduces 0.0500 and 0.00333 span gaps for the three-body proposal and 0.0266 and 0.0493 for the tilted proposal; held-out IoU rises 0.706→0.889 and 0.609→0.766 respectively. The tilted body's output contains rotations inconsistent with its reference. Exact output is archived in `e2-2/e21-reproduction.json` and the original reports are preserved.

The E2.1 score is `whole-scene IoU − 0.5 Σ(gap/span)² − 0.01 deviation`: it independently adjusts translations and rotations and checks a caller-supplied gap limit only at the end. Its benchmark permits 0.1 of span. A visual gain can therefore compensate for a gap; a single silhouette merges all bodies, allowing errors in one part to be hidden by another. Candidate anchors came from the conceptual plan as unverified priors, never inferred from pixels. In this phase, joint position is derived from supplied frames and a candidate that does not close is rejected at **every evaluation**, not penalised.

## Known frames: representation and fit

`kinematics.ts` implements a bounded rooted rigid-body tree with local parent/child anchors, axes, angle limits and explicit evidence labels. In a parent's coordinates:

`T_child = Trans(anchor_parent) × Rot(axis_parent, angle) × Align(axis_child → axis_parent) × Trans(−anchor_child)`.

Anchor positions are fractions of the local box dimensions, so changing a dimension moves its attached anchor with the surface. Root pose is supplied; child translation is not free. Cycles, disconnected/duplicate bodies, invalid unit axes, non-surface anchors and out-of-range angles are refused. Each trial independently computes both world anchors and axes. The pre-registered synthetic gate is gap/span ≤0.005 and axis dot ≥0.999999: 0.5% rejects the prior 2.66–5% failures, but is not a physical engineering tolerance. Actual maximum observed gap across all trials is numerical roundoff, at most 1.12e−16 of span in these runs. No collision guarantee or physical force/strength model is provided.

`constrained-fit.ts` searches width and length multipliers 0.6–1.4 and bounded hinge angles with two deterministic coarse-to-fine coordinate sweeps. Root pose is currently held fixed. Fitting uses calibrated full-scene masks, optional per-component masks, optional 2D joint landmarks and input priors, never reference geometry or held-out views. The score combines scene IoU and available component IoU (0.5 each), a bounded landmark reprojection penalty (0.05), and a dimension-deviation prior (0.005). With no usable component mask the component term falls back to whole-scene IoU. Complexity is fixed (two or three boxes); there is no varying complexity penalty. Hard kinematics are **not** a soft score term. Angle ranges cover only near-optimal *sampled* candidates and are not statistical confidence intervals or a proof of identifiability. The caller-supplied label `synthetic_fixture`, `source_hypothesis`, `calibrated_image` or `unknown` does not authenticate evidence; unknown frames are refused in this known-frame mode.

Before evaluating, the implementation rejects a plan whose dimensions or world transforms disagree with the supplied initial kinematic tree, preventing silent projection of an existing gap. It validates source hash strings, camera frames, masks and landmarks; contradictory 2D landmarks are refused. It returns typed inferred V2 operations on copies, never commits them, preserves component IDs and source, and records unresolved claims. Shape parameters remain unitless for unitless plans.

## Frozen independent synthetic laboratory

`e2-2/CRITERIA.md` was written before final evaluation. `scripts/benchmark/e22-lab/references.ts` independently constructs THREE.BoxGeometry references without importing candidate FK or fitter. The fitter receives only four fitting masks/cameras, optional labelled 2D landmarks, visibility flags and explicitly supplied joint frames. Four held-out cameras are scored separately. References use the same silhouette rasteriser as evaluation; there is no independent rendering implementation, real asset or photographic validation. Each 64×64 mask has a SHA-256 digest; the synthetic source SHA is a digest of the reference descriptor, not a photographic source. All camera parameters, partitions and generated observations are in `e2-2/*-evidence.json`.

| Fixture | Fit IoU before → after | Held-out IoU before → after | Angles initial → fitted / synthetic reference | Maximum gap / span across trials |
|---|---|---|---|---|
| two-body | 0.541 → 0.791 | 0.612 → 0.828 | 0 → 0.3 / 0.4 rad | 5.56e−17 |
| three-body | 0.481 → 0.899 | 0.518 → 0.818 | 0,0 → 0.3,0.2 / 0.4,−0.3 rad | 1.12e−16 |
| unseen-folded | 0.417 → 0.747 | 0.442 → 0.735 | 0,0 → −0.3,−0.3 / −0.5,+0.6 rad | 1.12e−16 |

For example, in two-body the boom width improves 0.5→0.65 against 0.7, while the stick width worsens 0.35→0.28 against 0.45 even as whole-scene IoU improves. Per-component held-out IoU and every dimension/angle are recorded in `e2-2/metrics.json`. The second angle has the wrong sign in both three-body cases. These are materially incorrect reconstructions despite exact attachment closure. Full scene, component, landmark and known-frame metrics must not be conflated.

The reference generator conservatively marks both components `occluded` whenever their masks overlap at even one pixel. Consequently only **0, 1, 0** component masks respectively were used across the four fitting views. This is an overlap heuristic, not depth-tested visibility; it prevents penalising occluded parts but is over-conservative. Per-component held-out metrics use the separately rendered synthetic full masks and are diagnostic, not proof of real segmentation. `e2-2/component-masks.png` visualises the labels and overlaps. Accurate visible-part segmentation remains necessary before claiming component-aware fitting is validated.

## Unknown frames: landmark hypothesis only

`landmarks.ts` triangulates a candidate 3D **point** by least-squares intersection of two or more calibrated orthographic rays. It rejects parallel cameras, missing visibility, inconsistent source hashes and observations with >3× declared pixel uncertainty reprojection error. It reports maximum reprojection error and leaves `axis:null`; it does not infer a hinge axis, a 3D uncertainty volume or a mechanical connection. On synthetic noiseless landmarks the numerical position error is ~1e−16 plan units and max reprojection ~7.1e−15 pixels; these are exact generated data, not accuracy on photographs. Tests include missing/occluded observations, inconsistent landmarks, incorrect hash and degenerate views. There is no complete unknown-structure reconstruction and no claim that static silhouettes uniquely determine joints.

## Visual inspection

`e2-2/three-d-joints.png` is a Chromium/SwiftShader contact sheet with identical fixed side and three-quarter camera positions for reference, initial and fitted states. Magenta points/lines show supplied hinge positions/axes. The known-frame three-body proxy has coincident anchor markers, but the fitted bucket proxy points the wrong way, particularly in the folded case. Some boxes intersect around pivots and there is no collision test; this is not a functioning excavator. The masks sheet shows available component labels, while numerical uncertainty and landmarks are not overlaid in the 3D viewer. No independent human reviewer or real GPU was used.

Reproduction: `npx tsx scripts/benchmark/e22-lab/generate.ts`; `npx tsx scripts/benchmark/e22-lab/evaluate.ts`; `python3 scripts/benchmark/e22-lab/mask-sheet.py`; start `npx vite --host 127.0.0.1 --port 5191`, then `node scripts/benchmark/e22-lab/capture.mjs` and `node tests/e2e/e22-worker.pw.mjs`. The evaluation overwrites the measured metrics and should be run only in this isolated worktree.

## Worker and preview boundary

`constrained.worker.ts` yields after each complete geometry evaluation; the client enforces a 30-second maximum, terminates on cancellation/dispose and rejects queued messages from a prior generation. Browser test: three running jobs cancelled at the first progress event, then a real Worker result was delivered; a changed plan revision was refused before experimental preview and an unchanged plan produced a copied preview; `dispose` made it stale. No arbitrary sleeps, page errors or paid calls. One atomic evaluation is not preemptible within its Worker, though termination ends the Worker. Browser resource/VRAM leaks and physical-device behaviour were not measured.

`ConstrainedPreviewFence` recomputes the plan JSON SHA-256 and compares the caller's source, plan and review identity/revisions after asynchronous hashing and before returning a preview copy; a unit test changes the revision during the digest. This guard is **not wired into the product**. It trusts the caller to provide the current binding, to invalidate it for cancellation, to verify source bytes and authenticate review; it supplies no authoritative commit or grouped undo and cannot prevent an external consumer from bypassing it. The Worker client validates operation syntax and the reported gap, but does not independently remeasure the gap in the returned plan. Future integration must verify actual evidence, bind latest revisions and perform E0 atomic application with human authorisation.

## Acceptance A–I

- A: demonstrated for supplied synthetic frames and all sampled trials; not proof of a real hinge.
- B: demonstrated for the first angle on synthetic held-out views; other angles can regress or have the wrong sign.
- C: width and first angle improve in the two-body case; other dimensions worsen.
- D: diagnostic per-component scoring exposes the stick-width regression; fit-time component-mask coverage was nearly absent because of the conservative overlap flag.
- E: landmark-point inference is evaluated independently of known-frame fitting; unknown axis/structure remain unresolved.
- F: contradictory, occluded and insufficient observations are covered by focused tests; realistic occlusion and noise are not evaluated.
- G: closed three-box chain with joint overlays is visible; it is a simplified proxy with wrong posture and possible interpenetration.
- H: the isolated Worker → local preview-fence revision race was tested; no integrated preview or commit endpoint exists here.
- I: outputs are inferred operations and not automatically applied.

## Tests and remaining work

Focused checks passed: six test files / 16 tests, followed by four E2.2 files / 10 tests after the added negative controls. Chromium Worker/preview test passed. Default `npm test` was run sequentially in separate checkouts with identical dependencies: exact base `609fbf2` had 2,501 passed and 4 timed out; this branch had 2,511 passed and the same 4 timed out. The failures were rendering lifecycle, two buried-component operations, and bucket-width rejection; each exceeded the existing 5-second timeout. The separate `npm test -- --maxWorkers=4 --testTimeout=60000` run passed 165 files / 2,515 tests and does not make the default run green. `npm run build` passed with inherited contact-variable and bundle-size warnings. Required work before integration: independent occlusion-aware segmentation and real reference assets, robust multimodal angle ambiguity, collision checking, a realistic bucket, genuinely independent cameras/rendering, source-byte/reviewer verification, authoritative E0/E1.3 stale-result fencing and hardware resource tests. No photographic, engineering or clinical claims are made.
