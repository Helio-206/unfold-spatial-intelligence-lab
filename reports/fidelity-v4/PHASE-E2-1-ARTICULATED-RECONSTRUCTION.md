# V4 E2.1 — experimental articulated fitting

Branch `feat/v4-e2-1-articulated-visual-fitting`, baseline `419b643338194d667aff5226d48c0045d656f2d3`. `git rev-parse HEAD` identifies the report's checkout; a commit cannot contain its own hash. No E0/E1/E1.2 implementation, production UI, protected branch, Meta inference or default V4 activation was changed.

## Verdict

**NO-GO for E1.2 + E2 integration.** Fitting now consumes pixels and changes width and length, with candidate translations and local X rotation, but the reference assemblies are only boxes with hypothetical attachments. The two-body evaluation is refused; the three-body outputs have residual gaps and visibly incorrect rotation. Neither is an excavator. Joints are not inferred from visual evidence, and there is no complete, reviewable, transaction-bound three-body product proposal.

## Architecture and objective

`fit.ts` replaces the previous nine equally spaced values with five coarse samples over the caller's explicit conceptual bounds (default scale 0.5–2.5), followed by two rounds of local refinement. It preserves the 9-evaluation default budget and marks an optimum on the bound and broad near-optimal alternatives as unresolved. The reported interval is a set of near-optimal tested samples, **not statistical confidence**, and finite sampling can miss another optimum. Empty, uncalibrated, insufficiently diverse and over-budget inputs are refused. Outputs remain inferred and unitless when the plan is unitless.

`articulated.ts` is a resumable generator: two or three box-shaped components in a known parent tree; fitting views only; and caller-supplied hypothetical parent/child surface anchors. Per body, the parameters are width and length multipliers in [0.6,1.6], local Z displacement within ±0.25 scene spans and local X rotation within ±0.5 rad. Two deterministic coordinate sweeps use steps 0.2 then 0.1 for dimensions, 0.08 then 0.04 span for displacement, and 0.2 then 0.1 rad for rotation. The normalised objective is:

`mean fitting IoU − 0.5 × sum((joint gap / span)²) − 0.01 × mean(parameter deviation²)`.

Deviation contains `(width−1)² + (length−1)² + (dz/span)² + rx²`. The weights are experimental, not calibrated physics. Rigid transforms are applied per component; there is no dynamic model or collision penalty. Model complexity is fixed because the number of boxes cannot change, so there is no variable complexity term. Declared anchors must lie on original box surfaces; when a dimension changes their local coordinates scale with that box, so the gap still measures surface attachment. This is a geometric assumption, not a verified pivot. The caller's gap limit is a fraction of scene span; the benchmark permits 0.1, a deliberately loose research gate and **not mechanical acceptance**. Only inferred typed V2 operations on a copied plan are returned. Parent IDs and source are unchanged; no operation is committed.

`joints.ts` reports geometrical proximity or contradicted declarations as ambiguous/contradictory hypotheses with no hinge axis and `verified:false`. It has no image-based joint or axis inference. No result is a human confirmation. The proposal is not yet bound to a verified source/review revision or E0 transaction; the separate earlier binding sketch is not integrated.

## Width boundary investigation

The three original E2 fitting masks and held-out views are unchanged. Expanding the range demonstrates that the old upper bound prevented the compact case from reaching its synthetic width: initial 0.5, previous maximum 0.7, new 1.0625, reference 1.05. The long case recovers 0.8125 versus 0.75; the rotated case 0.75 versus 0.65, worse than the earlier 0.7 despite slightly better objective. Other parts and silhouettes can mask/confound the width; this experiment does not separate masking from raster quantisation or prove identifiability. `e2-1/width-metrics.json` records all results and search ranges. A focused test covers an optimum beyond 1.4 and explicitly flags a clipped optimum at 1.4. The original E2 input and saved reports were not overwritten.

## Independent synthetic evaluation

`e21-lab/references.ts` generates three 2-/3-box scenes with Three.js `BoxGeometry`, separately from the fitter and V2 candidate compiler. Eight deterministic orthographic 64×64 masks per fixture carry SHA-256 digests; four fitting and four held-out views. The fitter sees only the conceptual V2 plan, fitting masks, frame calibration and declared hypothetical anchors. Evaluation alone sees reference dimensions and held-out masks. Both paths share the silhouette rasteriser; the reference is not an independently calibrated camera, real mechanical asset or physical ground truth. The plans and positions are deliberately close to their synthetic targets. There is no actual bucket shell, independent hinge annotation, separate occlusion dataset or unseen object family.

| Fixture | Status | Fit IoU before → after | Held-out IoU before → after | Joint gaps before → after / span |
|---|---|---|---|---|
| two-link | refused: `JOINT_GAP_EXCEEDED` | 0.737 → 0.737 | 0.664 → 0.664 | 0 → 0; discarded candidate not applied |
| three-link | proposal | 0.791 → 0.936 | 0.706 → 0.889 | 0 / 0 → 0.050 / 0.0033 |
| unseen-tilted | proposal | 0.611 → 0.775 | 0.609 → 0.766 | 0 / 0 → 0.0266 / 0.0493 |

Detailed per-part width, length and rotation errors, runtime, evaluation count and triangle/vertex counts: `e2-1/articulated-metrics.json`. The three-link stick length moves from 1.0 to 0.9 against reference 1.2: it gets worse. The tilted case rotates its boom from 0 to −0.2 rad when the synthetic reference is 0, and bucket to −0.3 against a world-space reference +0.2; local hierarchy makes the latter values not directly equivalent. The more reliable conclusion is that pose remains visibly wrong. 33 or 49 evaluations were used; the last local measurement is a single sample, not a latency distribution or peak-memory measurement. `scripts/benchmark/e21-lab/generate.ts` and `evaluate.ts` reproduce the experiment without network calls.

The 3D capture `e2-1/three-d-comparison.png` uses the same fixed side and three-quarter cameras for reference, original and result, captured in Chromium/SwiftShader. It shows simple rectangular bodies, not an excavator, and the fitted tilted fixture has a visible gap and wrong posture. No human independent visual reviewer, actual joint overlay, held-out mask overlay or interactive synchronisation was completed. Reproduce with `npx vite --host 127.0.0.1 --port 5190`, then `node scripts/benchmark/e21-lab/capture.mjs`.

## Worker and invalidation

`articulated.worker.ts` advances one evaluation per scheduled task; `ArticulatedWorkerClient` owns one Worker per request, bounds lifetime, terminates it on cancellation/dispose, ignores late messages from old generations and validates returned operation syntax against a copy of the original plan. Individual geometry compilation/rasterisation cannot be preempted inside a step; client termination can stop the Worker. It does not remeasure the returned joint gap or authenticate a source, and the consumer must recheck revision/source/review **after** result delivery and before preview or commit.

Chromium `tests/e2e/e21-worker.pw.mjs` cancelled a running job immediately after a real progress event, observed `CANCELLED`, ran a second job to the expected `BUDGET_EXHAUSTED` refusal, disposed during another job and verified future calls return `DISPOSED`, with no page errors. A unit fake exercises rejection of an old queued Worker message and invalid Worker result. It does not prove physical-device memory behaviour or a result cancelled after promise delivery; no arbitrary sleep is used in this test.

## Stored Meta excavator

The inherited bounded diagnostic produced 6.21%, 25.90%, 35.34% of scene span for boom, stick and bucket; these are heuristic plan-only measurements, not mechanical truth. No verified source image, camera or pivot evidence was supplied to this experiment. No candidate is claimed to reconstruct this fixture and no relation is rewritten.

## Acceptance A–G

- A: partially demonstrated on synthetic boxes: more than one dimension changes from fitting masks, but independent identifiability has not been proven.
- B: held-out IoU improves for two three-box scenes; neither is a mechanically distinct, independently validated articulated asset, so the requested condition remains unmet.
- C: unmet: the three-body proposals have gaps up to 5% of span, use supplied anchors and have incorrect visible posture; no coherent excavator/bucket is demonstrated.
- D: partially supported: contact candidates are flagged ambiguous and axes unknown; no robust pixel-based ambiguity/occlusion detector exists.
- E: typed, inferred and non-mutating operations exist; integrated preview and source/review binding do not.
- F: actual Chromium Worker cancellation and dispose passed; stale-message rejection was simulated in a unit fake, not an end-to-end post-completion/revision test.
- G: fixed-camera screenshots exist, but reveal disconnected or overlapping boxes rather than a meaningful bucket assembly; uncertainty and joints are not displayed.

## Test results

Focused tests passed: 3 files / 8 tests initially, then 5 articulated tests after surface-anchor hardening; the Chromium Worker test passed. `npm run build` passed with the inherited contact-variable and bundle-size warnings. The default suite was run in sequential, separate checkouts with the same dependencies: baseline `419b643` had 2,495 passed / 3 timeouts; this branch had 2,501 passed / 4 timeouts. The same rendering lifecycle, buried-component operation and bucket-width tests timed out in both; the branch run had an additional timeout in a buried-component idempotence test. A prior baseline run also timed out in that idempotence test; this does not establish that the extra branch failure is or is not a regression. The separately configured `npm test -- --maxWorkers=4 --testTimeout=60000` passed 161 files / 2,505 tests; it does not make the default run green. Required remaining work: a surface-aware articulated solver with explicit constraints that rejects or repairs gaps rather than optimising past them; blind independent, articulated reference assets and occlusion/ambiguous controls; pixel-supported joint candidates and uncertainty; curved bucket representation and topology; Worker/revision race tests through actual preview; trustworthy E1.2/E0 binding. No paid calls or merge were performed.
