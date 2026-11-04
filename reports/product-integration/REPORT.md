# Produto: V3 + Voice — integration draft

Base `produto@5dbc53a885c6e6234c7d109f7b4169d485938c0f`. V3 #28 `e39173e861cdd76ed976c63b1733223e17b35697` merged into the integration branch only; Voice #29 changes ported separately. `layer.ts` conflict resolved by retaining the stabilized frame-scheduled continuation and triangle budget, adding the Voice revision update when geometry changes. Main's editing lock and sync provenance remain.

## Policy and scope

The normal `SpaceFlow.show` now uses `ProductGeometry`, not the V3 reference harness. It requests V3 only for single non-repeated `tube`/`torus` components in plans with at most 32 components; other parts stay V2. Initial compile draws V2 while a real browser Worker computes eligible surfaces. One worker, 32 queued jobs, 5 s job deadline, 16 MiB cache target, 160k scene-triangle and 16 MiB geometry thresholds, and 64 grid cells are configured. The layer asks for 12k triangles per upgrade call; the stabilized router always permits at least one component, so this is **not** a strict per-frame or wall-time guarantee. The router cannot guarantee a frame duration, GPU allocation peak, or that a V2 baseline itself fits the V3 threshold. Worker creation/post failures are recorded and leave V2; timeout/queue/scene budget use the router's existing fallback. The latest per-component `used`, reason and provenance are available through `geometryReport` and the inspector evidence; this is an in-memory record, not durable telemetry.

## Browser measurements, saved plans

Chromium + SwiftShader, 1440×900, normal `/living` flow, locally replayed saved Meta plans produced with the old repair step; no live calls. An explicit mock supplies the plan and a mock supplies the Voice response; TTS is simulated. Times are elapsed from clicking Build to all jobs settling, including browser scheduling and rendering; they are not isolated worker or GPU timings.

| Plan | First frame | Final | elapsed | triangles / geometry bytes | conclusion |
|---|---|---|---|---|---|
| Harp | 7 V2, neck pending | neck continuous; 6 V2 | 1811 ms | 5184 / 237456 | no visual fidelity improvement asserted |
| Excavator | 11 V2 | 11 V2 (not eligible) | 1103 ms | 5148 / 478592 | no visual fidelity improvement asserted |

`tests/e2e/product-geometry.pw.mjs` reproduces the measurement and a pointer → contextual question → TTS flow. Output and screenshots are written to `/tmp/unfold-product-geometry` by default. The plans have placeholder geometry; smoothing is not proof of improved reconstruction. Browser/device, GPU and audio limits remain; Voice Meta response semantics are not mechanically guaranteed.

## Open acceptance items

A strict elapsed render-time cap is not established: triangle scheduling cannot prevent a slow single component, shader compile or GPU stall. Hardware GPU/device, audible speech, actual iOS Safari and live Meta are not verified. The policy is deliberately narrow and must not be interpreted as optimal quality. The full existing workspace regression is tracked separately if it fails. No external paid calls were made; the local backend was run with zero Meta-call budget. Spatial Evidence remains independent in PR #30.

## Compatibility matrix

| Boundary | Implementation / local evidence | Remaining risk |
|---|---|---|
| Main review/session | Editing lock and inferred provenance preserved in layer/server merge; existing focused tests | Integrated browser/CI needs current-SHA confirmation |
| V3 worker → layer | Stabilized `e39173e` frame continuation and retired jobs retained; Voice version increments on actual upgrade | Hard render-time guarantee not established |
| V3 → selection / Director | Existing V3 layer tests retain identity, selection and presentation; normal flow replay exercised | Device/GPU-specific behaviour not validated |
| Voice → V3 | Version invalidates prior explanation on upgrade; normal product replay selected, asked and sent approved text to mocked TTS | Audible speech, native recognition and live Meta not tested |
| Spatial Evidence | Separate PR #30, based on produto; not combined | Adapter and future product integration unverified |
