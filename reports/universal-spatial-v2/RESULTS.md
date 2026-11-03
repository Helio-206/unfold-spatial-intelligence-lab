# Universal Spatial Engine V2 — results

Date: 2026-11-04 (Africa/Luanda)
Implementation branch: `feat/universal-spatial-engine-v2`
Frozen implementation SHA before the blind input: `ed05db4482768de2cae6b585397e8af3588b5fdd`
Source PR: #22 (`feat/universal-spatial-engine`); no merge was performed.

## Outcome

The V2 pipeline is technically operational for bounded live planning, compilation, selection, construction reveal, constraints, evaluation and blind generation. It is **NO-GO for high visual fidelity, faithful image reconstruction or a general quality improvement over Foundry**. In both the reference-photo run and blind run the rendered object occupies only a small part of the canvas and lacks a recognisable silhouette. The browser and API results prove a working experimental path, not production readiness.

The implementation adds a strict `unfold.spatial-plan.v2` contract, V1 adapter, 11 declarative operators, bounded recursive groups, material profiles, repetition/instancing, 10 spatial-check kinds, local operations/undo, paid Meta plan/edit/evaluate endpoints, and a test-only harness. The complete integration contract is in `src/universal-spatial/INTEGRATION.md`; Foundry transfer boundaries and limitations are in `src/universal-spatial/V2-ARCHITECTURE.md`.

## Live image test

Input was the user-provided excavator image, SHA-256 `2ba5cfac62edea6be1e8ab34590ffb2d74c0d70320970d9db1f1b2a59ab31327` (1,048,734 bytes). Muse Spark 1.3 request `57e57273-6f7a-44f4-af8a-4737f03435ff` returned HTTP 200 in 45.3 s. It proposed 11 components and 20 geometry nodes. The compiler produced 17 meshes, 2,268 triangles and 198,992 geometry bytes. The plan remained `unitless`; physical dimensions and absolute scale are unknown. Thirty-eight unknown/normalization notes were retained. Two generated constraints were reported violated: track symmetry and cab/hood adjacency.

The plan is in `evidence/live-image-plan.json`; browser details are in `evidence/browser-proof.json`. Chromium + SwiftShader at 1440×1000 rendered the plan, component selection and provenance without browser console errors. The screenshot is `evidence/v2-excavator-source.png`.

The live Meta evaluator request `66b550a5-d037-4998-a591-0e96d9ea5edb` completed in 10.8 s. It returned recognizability 0/100, silhouette 0/100, spatial integrity 0/100 and confidence 0.95, with no suggested edit. Its rationale described a uniformly black render and no visible excavator parts. The browser screenshot contains a tiny cluster of geometry; therefore the evaluator's scores are retained as a negative model hypothesis, not objective image or geometry metrics. The practical observation from the browser is that the generated assembly is far too small and visually sparse for recognition. `evidence/live-evaluation.json` preserves the response; `evidence/v2-excavator-evaluated.png` preserves the UI state.

Two earlier API failures exposed and led to fixes before the blind run: invalid Meta constraint proposals are now dropped with an explicit unknown, and the evaluation prompt is capped below the Meta image-call limit. The browser client now accepts the evaluation contract returned by its server. The last live browser evaluation completed through the client after those fixes.

## Blind generalization test

Only after freezing `ed05db4482768de2cae6b585397e8af3588b5fdd`, the text request was submitted: “Create a small hand-carved wooden concert harp as an educational 3D concept, showing the curved neck, pillar, soundbox, base, strings and tuning pegs. No music stand, room, floor, labels, or people. Keep it conceptual and unitless; no real-world measurements were supplied.” No harp-specific code was added.

Meta request `7626caf3-c8a9-4a75-95ca-61e84c49483c` returned HTTP 200 in 47.5 s. The validated plan has 7 components, 18 geometry nodes, 5 operators, 26 unknown/normalization notes and unitless scale. Browser render produced 15 meshes and 2,084 triangles. Component selection and Inspector provenance worked; console errors were zero. Two constraints reported satisfied, using world-transform and AABB methods, which do not prove contact or physical correctness.

The harp is **not visually recognisable** in the rendered screenshot: it appears as a handful of tiny pieces near the canvas centre. No live evaluator was run on the blind scene. Evidence is in `evidence/blind-harp-plan.json`, `evidence/blind-browser-proof.json`, `evidence/blind-harp-browser.png` and `evidence/blind-harp-canvas.png`. Blind result: generic plan and browser path succeeded; visual-quality criterion failed.

## Foundry study and transfer boundary

The architecture review found that the premium excavator depends on semantic subassemblies, authored profiles and tubes, local transforms, articulated hierarchy, controlled edge normals/material grouping and Cinema's studio environment. V2 reuses the existing Three.js dependency, renderer/picking conventions, explicit disposal pattern and Cinema lighting lifecycle. It generalises groups, local transforms, rounded boxes, extrusion, revolution, loft, tubes, repeated/instanced geometry, node-level materials and measurable relation checks.

Excavator dimensions, axes, pose solver, joint anchors, hose endpoints, component registry, industrial details and engineering checks remain domain-specific and were not copied. The harness uses a single neutral studio light setup and is not a replacement for Cinema or the permanent workspace.

## Meta cost evidence

For the final frozen run, provider estimates were $0.02415325 for the excavator image plan, $0.00630375 for its successful live evaluation, and $0.024475 for the blind harp plan: **$0.054932 known for those three calls**. Across all recorded live experiments in this implementation session, successful-call estimates sum to **$0.16399350**. At least two rejected Meta outputs did not expose provider request IDs/usage in the error response, so the aggregate billed amount cannot be reconstructed exactly; it is not represented as a complete total.

## Validation and limits

- On implementation SHA `ed05db4482768de2cae6b585397e8af3588b5fdd`, full Vitest: 110 files, 2,078 tests passed with `--maxWorkers=4 --testTimeout=15000`.
- `npm run build` passed. Existing warnings remain: undefined `VITE_UNFOLD_CONTACT_EMAIL` in landing build and a generated chunk above 500 kB.
- Browser: Chromium Playwright + SwiftShader, 1440×1000; live image evaluation and blind plan render/selection passed the harness checks with no console errors. This is headless browser evidence, not device GPU or cross-browser evidence.
- No like-for-like V1/V2 capture was produced for the same source, camera and lighting, so no comparative visual improvement is claimed.
- Constraints based on transforms or axis-aligned bounds are geometric screens, not actual-surface contact, collision, mechanical validity or structural/aerodynamic proof.
- No third-party assets, GLB/GLTF, external mesh provider or new dependency was introduced; consequently no external asset license is claimed.
- The browser evaluation's all-zero scores conflict with the small geometry visible in the browser screenshot. Treat the model evaluation as fallible and retain human inspection.
- No authenticated human-review identity, durable session storage, physical scale calibration, photogrammetry, canonical geometry promotion or general motion simulation is provided.
