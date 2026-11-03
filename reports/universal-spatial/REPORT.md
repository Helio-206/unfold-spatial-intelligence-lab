# Universal Spatial Engine — checkpoint evidence

Branch: `feat/universal-spatial-engine`
Base: PR #20 head `14b6d6172ea578450afa8372cb209e39e37a0d13`
Evaluation date: 2026-11-03 (Africa/Luanda)
Verdict: technical prototype is integrable as a domain adapter; not universal reconstruction and not production-ready.

## Live Meta evidence

All four scenarios used the live `muse-spark-1.3` Responses API through `POST /api/spatial/plan`, then passed the strict runtime plan validator and rendered in Chromium. Usage and costs are recorded in `evidence/browser-proof.json`.

| Scenario | Meta request ID | Latency | Cost estimate | Result |
|---|---|---:|---:|---|
| Robotic arm with three joints and magnetic end effector | `47edde84-b9fc-4b99-828b-30538abd99b8` | 22.474 s | $0.01206175 | 7 entities; 3 labelled joints; all dimensions `design_approximation` |
| Six-blade industrial fan | `2f4a3c72-2fd1-4a37-a16a-8a7108cce662` | 23.922 s | $0.01030425 | 6 entities; a radial pattern with `count: 6` |
| Turbofan photograph | `95f98468-ff31-450e-96c0-e26d63813faa` | 22.126 s | $0.011231 | 6 entities; unitless; physical scale retained as unknown |
| Unexpected object: pedestrian suspension bridge | `5659343e-d684-484c-b026-42a78c4726e4` | 29.240 s | $0.01434175 | 7 entities; tubes, repeated linear hangers, two towers and deck |

The source photo is a 1280 × 960 resized derivative of Stéphane Gallay's Wikimedia Commons turbofan photograph, CC BY 2.0. Its SHA-256 is `49d0fce4f6249476eec35248117c0df6469ebce18ba79c6c6ac721b38f858409`; source/license/attribution are in `inputs/NOTICE.md`. The image plan explicitly leaves scale unknown. The model did add component hypotheses such as casing and exhaust; these are marked as design approximations/inferences rather than direct measurements.

The live edit API created a fresh five-entity fan plan, then returned one localized `set-repeat` operation for the existing blade entity. The count changed from six to eight at revision 1; undo restored six at revision 2. Requests: plan `1587c820-9e85-4259-8e5f-eeadfd247ab8`; edit `a9fe729b-f1f4-4f42-8cf9-7978b906cf54`. The updated property is `inferred`; client-submitted operations are `user_provided` with human identity explicitly unverified. Exact payload and identity caveat: `evidence/edit-api-proof.json`.

## Browser and geometry evidence

`npm run test:e2e:universal-spatial` ran Chromium with SwiftShader against the local Vite + live backend. Four screenshots were captured; the browser console was clean. Selection and inspector worked for the generated text and image plans. The actual scene output differs between the arm, fan, engine and bridge plans. In the deterministic geometry test, a hub plus six blade instances yields 7 Three.js meshes; a hub plus eight yields 9. This proves the repeat adapter changes mesh count, not physical correctness.

- [Robot arm](evidence/scenario-a-robotic-arm.png)
- [Turbofan image](evidence/scenario-b-turbofan-image.png)
- [Six-blade fan](evidence/scenario-c-industrial-fan.png)
- [Unexpected bridge](evidence/scenario-d-unexpected-bridge.png)
- Detailed live plans and request/cost records: [browser-proof.json](evidence/browser-proof.json)
- Text-edit/undo evidence: [edit-api-proof.json](evidence/edit-api-proof.json)

## Validation

- `npm test -- --maxWorkers=4 --testTimeout=15000` — 108 files, 1,937 tests passed.
- `npm run build` — TypeScript and Vite build passed.
- Contract/API targeted suite — spatial plan, API session, route guards, provenance and rate-limit coverage passed.
- `git diff --check` — clean before final docs/evidence staging; repeat at final SHA.

The build still reports existing landing-email environment and large-chunk warnings. Neither fails the build. The browser proof uses the test-only `/universal-spatial` harness and does not demonstrate integration into the Terminal's main workspace.

## Confirmed limitations

The arm and bridge are recognisable conceptual compositions. The turbofan remains a coarse primitive approximation. Meta plans can still produce poor topology, overlaps, misplaced repeated parts or incorrect semantic relations. The image output may contain plausible hidden-part hypotheses; provenance makes those hypotheses visible but does not validate them. There is no photogrammetric reconstruction, scale calibration, validated physical simulation, collision/structural check, generic animated motion track, durable sessions, authenticated reviewer, or guaranteed scene correctness. The construction timeline currently stages/reveals entities; it does not simulate motion. Do not market this as an engine that reliably builds arbitrary objects.
