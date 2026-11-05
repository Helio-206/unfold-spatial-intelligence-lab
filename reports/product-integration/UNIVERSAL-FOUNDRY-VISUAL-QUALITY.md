# Universal Visual Foundry — independent quality gate

> Historical pre-provider baseline. For the independent audit of the actual provider at `587854b`, see [Universal Foundry V1 audit](UNIVERSAL-FOUNDRY-V1-INDEPENDENT-AUDIT.md).

**Decision: NO-GO.** This is an initial, independently isolated evaluation harness, not evidence that the Universal Visual Foundry meets the product goal. There is no captured Foundry output, no paired original photograph for the replayed plan, no independently signed human assessment, and no confidential held-out set. Do not infer an improvement over V2 from this report.

## Source and isolation

Base: `08f0d326fdf90a47c0d6cbb38d3378700990bd8b`. Branch: `audit/universal-foundry-visual-quality`. Only new evaluation scripts, tests, captures and references are added. No Foundry provider or product UI is implemented or modified. The new provider was not found on the remote when checked; the existing `src/living/visual-foundry` is part of the baseline and is not evidence of the new provider's completion. No paid inference was invoked. `/api/*` was intercepted and all non-fixture API calls returned 503.

## Reference candidates — incomplete

`visual-quality/references/manifest.json` records 12 candidate photographs with source-page URLs, author, licence, derivative file and SHA-256. They cover construction, vehicles, furniture, electronics, appliances, architecture tools, and curved objects. Some photographs contain context, multiple objects, partial occlusion, or a small subject. The component lists are preliminary visual triage, not independent human annotations or ground truth. Images should be inspected and rights/attribution reviewed at their source before acceptance. Four search hits were excluded as mismatches. Commons API initially returned HTTP 429; a later sequential retry collected metadata. These candidates do **not** satisfy the requested complete frozen dataset: multiple examples are missing in several categories, and no image is secret on a pushed branch. A genuine hidden set requires evaluator-controlled storage/access and a separate immutable manifest/commitment, with an agreed release policy. Never pass its geometry or labels to the provider.

Every output must be bound to the actual image SHA-256 and exact provider version; do not pair an existing plan with a different source. `UNFOLD_VISUAL_REFERENCE` enforces equality with the replay plan's source hash. This verifies file identity, not camera calibration, semantic correctness or proof that a model generated the plan. The image workflow and resize/hash behaviour still require validation against a genuinely matched source and plan.

## Capture protocol

```sh
npm ci
npm run dev -- --port 5195
# In another terminal, without a backend or inference:
node scripts/visual-quality/capture.mjs
node scripts/visual-quality/report.mjs reports/product-integration/visual-quality/captures/result.json
python3 scripts/visual-quality/contact-sheet.py
npx vitest run tests/visual-quality
npm run build
```

Python contact sheets require Pillow. Specify `CHROMIUM_PATH`, `UNFOLD_SPACE_URL`, `UNFOLD_VISUAL_OUT`, and optionally `UNFOLD_VISUAL_PLAN`. `UNFOLD_VISUAL_REFERENCE` is optional and must hash to the plan's source SHA. Default is a locally replayed saved Meta plan; it is **not** a new response or a plan for these candidate photos. Chromium software rendering and viewport 1440×900 are recorded. The default browser disables Worker and verifies each decision is V2, exercising the product's existing fallback. It captures front, side, three-quarter, selection, isolation, close-up and reopened state. Views use the same bounding-box-derived camera policy; this is not photogrammetric alignment, and per-output framing alone does not establish a matched camera for comparison. Set `UNFOLD_VISUAL_CAMERA` to a prior run’s `camera.json` to reuse the same camera coordinates and scale for a paired run; independently verify scene coordinates and registration.

An optional `UNFOLD_VISUAL_ADAPTER=/absolute/path/to/adapter.mjs` must export `providerName`, `setup({page,fixture,reply})`, and `afterBuild({page,fixture,reply})`. This is a provisional harness seam, not an assertion about Claude's actual contract. Once the provider is available, inspect its source and bind the adapter to its real public contract; capture the actual generated result and version, never substitute a fixture as Foundry output. Audit any adapter before running it: adapters are executable local code. No outbound inference is authorised by this harness.

## Observed browser run

Fixture `reports/universal-spatial-v2/evidence/live-image-plan.json` is a previously saved Meta plan replayed locally. Its original input image was not paired in this run. The stage rendered on ANGLE/SwiftShader. Selection by pointer chose `bucket-linkage`; isolation and save/reopen returned successfully and the reopened plan equalled the saved plan. No page or console errors were recorded. Three-quarter capture visibly contains separated block-like forms; its category and fidelity have not been judged by an independent human reviewer. See [contact sheet](visual-quality/captures/contact-sheet.jpg), [three-quarter capture](visual-quality/captures/threeQuarter.png), and [raw record](visual-quality/captures/result.json).

One non-benchmark sample: 1,543 ms from build click until active/unlocked; 5,148 rendered triangles, 17 mesh objects, 0 locally detected degenerate triangles, 0 detected zero/non-finite normal vectors, 17 materials, 2 with a colour map, and renderer counters of 21 geometries / 11 textures / 12 programs. JS heap is an optional Chromium reading, not GPU memory. These counts do not prove shape, coverage, accuracy or leak freedom. No percentile, physical GPU, first-input latency or repeated lifecycle leak claim is made.

## Gate and missing measurements

`metrics.mjs` requires an explicit registered pair of binary masks before reporting silhouette IoU; empty masks and unregistered photographs cannot pass as comparisons. Component completeness requires evaluator-supplied ID mappings and is only a diagnostic. The gate requires verified image files for all three primary views and a completed independent reviewer record before returning PASS, PARTIAL or FAIL; otherwise it returns `NOT_EVALUATED`. The report verifies screenshot signatures and records hashes. Improvement additionally requires a reviewed comparison, same source and comparable framing. File existence/signature alone does not prove the screenshot represents the claimed provider: provider identity, capture lineage, source hash and actual camera pose must be audited independently.

Review checklist per case: (1) recognisable from the reference; (2) major visible components present, correctly shaped and connected; (3) no floating, overlapping, inside-out or degenerate pieces; (4) meaningful details and proportions; (5) materials do not conceal wrong geometry; (6) inspect front/side/three-quarter, close-up, selected and isolated parts; (7) compare side-by-side to V2 with equivalent camera and source; (8) record uncertainty, reviewer and concrete defects. A signed reviewer must mark serious defects, recognisability, structure and detail, then independently judge improvement.

Current diagnostics count meshes, triangles, degenerate faces, some invalid normals, materials, colour maps, world bounds and per-mesh bounds, plus JS heap and renderer resource counters. They include a coarse AABB-proximity heuristic for possible isolated meshes and invalid/outside bounds; these are review leads, not proof. They do **not** yet reliably detect disconnected/floating geometry or semantic anomalies, account for all texture channels, validate normalized or directionally correct normals, identify every invalid triangle, measure load distributions, capture GPU memory, or prove disposal across repeated cycles. Component mappings, pixel masks, segmentation, camera registration, matched-frame comparison, automated per-category aggregation, and robust interaction/render failure assertions require further work. Camera angles specified by the harness are not automatically calibrated to photos. Instanced triangle count includes instances, but degenerate tests apply local geometry and do not validate instance transforms. Screenshot and canvas dimensions are not yet checked for blank images. These are blockers, not PASS results.

## Integration requirements / next steps

1. Complete and independently review at least two licensed source photos per category; record exact byte hashes, visible components, exclusion/occlusion and usage conditions. Establish a genuinely access-controlled holdout independently of the generator team.
2. Confirm Claude's provider branch, exact SHA, source-to-output contract and ownership. Write an adapter in this evaluation worktree only. Block network and paid inference unless separately authorised.
3. Capture genuine matched source/V2/Foundry triples using identical camera transforms, selection, isolation, save/reopen and close-ups. Record provider version, plan/source hash, renderer and failures. Test image resizing and source-hash lineage.
4. Implement and validate the missing geometric diagnostics, repeated disposal checks and per-category contact sheets. Require a human assessment and measured comparison for every claimed category; report missing cases as `NOT_EVALUATED`.
5. Perform independent visual inspection and issue prioritised, reproducible defects against the actual provider. Re-evaluate GO only when real unfamiliar photographs produce recognisable, structurally coherent, detailed scenes with evidence of improvement over V2.

## Verification

- Full suite: `npx vitest run --maxWorkers=2` — 159 files / 2,515 tests passed. An earlier default-concurrency run with other work running concurrently had four 5-second timeouts; this is recorded rather than hidden.
- Focused tests: `npx vitest run tests/visual-quality` — seven tests passed.
- `npm run build` passed; Vite warned about an unset landing contact-email variable and large bundles.
- Chromium `/living`: V2 fallback capture, pointer selection, isolation, save/reopen and screenshot generation passed; no console errors. One run only, SwiftShader.
