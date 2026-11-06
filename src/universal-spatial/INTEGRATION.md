# Universal Spatial Engine — Terminal handoff

> This document began as the V1 handoff. V2 is an additive contract; use the V2 section below when the caller opts into it. Do not silently change existing V1 consumers.

This isolated prototype adds a generic, declarative spatial-plan domain. It does not replace `unfold.assembly.v1`, the excavator solver, Anatomy, the Foundry, or the Unified Workspace. It adds a browser-only technical harness at `/universal-spatial`; the Terminal should integrate the adapter into its existing workspace and must not ship this harness as another workspace.

## Stable module boundary

Import `SpatialPlan`, `SpatialOperation`, `validateSpatialPlan`, `spatialConstructionEvents`, `spatialPlanToThree`, `disposeSpatialPlan`, `createSpatialPlan`, `editSpatialPlan`, `applySpatialPlanOperation` and `undoSpatialPlan` from `src/universal-spatial/`. The browser client validates every plan reply before returning it. `spatialPlanToThree(plan)` returns an owned `THREE.Group`; attach that group to the workspace's existing scene. Select meshes by `mesh.userData.spatialEntityId`, use the plan entity for the inspector, and dispose the group on replacement/unmount. The adapter executes only its fixed operator allowlist; it never evaluates model or user code.

Coordinate convention: right-handed Three.js coordinates, Y up, radians for rotation, positive finite dimensions. `units: "m"` is only appropriate when the user supplied physical units; otherwise use `unitless`. Every parameter without direct scale evidence must have origin `design_approximation` and remain labelled conceptual.

## Contract and geometry encoding

`unfold.spatial-plan.v1` carries `source` SHA-256, title, units, stable entity IDs, parent IDs, geometry operator/parameters, repeat pattern, local transform, material, per-entity `origin` and evidence, explicit relations, and unknowns. Origins are `observed`, `inferred`, `user_provided`, `design_approximation`, and `unknown`. Relations are `attached_to`, `contains`, `adjacent_to`, `aligned_with`, or `connected_to`; they are proposals and are not certified mechanical constraints.

Operators and parameter order:

| Operator | Parameters |
|---|---|
| `box`, `rounded_box`, `ellipsoid` | `[width, height, depth]` |
| `sphere` | `[radius]` |
| `cylinder`, `cone` | `[radius, height]` |
| `torus` | `[majorRadius, tubeRadius]` |
| `extrude` | `[depth, x1, y1, x2, y2, x3, y3, ...]` (closed 2D profile) |
| `tube` | `[radius, x1, y1, z1, x2, y2, z2, ...]` |
| `revolve` | `[segments, radius1, axial1, radius2, axial2, ...]` |

Each entity can have one optional `repeat`: radial or linear, count 2–64, axis, and a positive radius/spacing. Limits: 80 entities, 200 relations, 100 unknowns, hierarchy depth 16, 1,000 rendered meshes, 256 geometry parameters per entity, 1,000-unit position/parameter bounds, scale factor 0–100, and 30-minute in-memory session TTL. Hierarchy must be acyclic. Current renderer validates and renders hierarchy, relations remain non-physical annotations, and no arbitrary operators or scripts are accepted.

## API

The existing backend gate is retained: `Content-Type: application/json`, localhost Host/origin allowlist, local token for non-browser clients, Meta budget/concurrency guard, body bounds, image validation (10,000 px per side / 16 MP), and image request throttling. A developer may add extra loopback origins with comma-separated `UNFOLD_LOCAL_ORIGINS`; remote hosts and HTTPS origins are rejected. `/api/spatial/plan` is limited to 20 requests per minute per peer and image plans to four per minute.

### `POST /api/spatial/plan` — paid Meta route

Text request:

```json
{"sourceKind":"text","instruction":"Build a small robotic arm with three joints and a magnetic end effector.","mode":"live"}
```

Image request:

```json
{"sourceKind":"image","imageDataUrl":"data:image/jpeg;base64,...","mode":"live"}
```

`mode` is omitted or `live`; simulated fallback is not available. A successful response has `contract`, `sessionId`, `revision: 0`, `plan`, `sceneSummary`, `constructionEvents`, Meta model/request/latency/usage/cost, and limitations. Example shape:

```json
{"contract":"unfold.spatial-plan.v1","sessionId":"<uuid>","revision":0,"plan":{"contract":"unfold.spatial-plan.v1","source":{"kind":"text","sha256":"<sha256>"},"title":"Robotic arm concept","units":"unitless","entities":[{"id":"base","label":"Base","parentId":null,"geometry":{"operator":"cylinder","parameters":[0.5,0.2]},"repeat":null,"transform":{"position":[0,0,0],"rotationRad":[0,0,0],"scale":[1,1,1]},"material":{"color":"#555b64","roughness":0.5,"metalness":0.4},"origin":"design_approximation","evidence":"Conceptual base inferred from the request."}],"relations":[],"unknowns":["Physical dimensions are unspecified."]},"sceneSummary":{"entityCount":1,"operators":["cylinder"]},"constructionEvents":[{"type":"scene_created","at":0,"entityId":null,"transform":null},{"type":"component_placed","at":1,"entityId":"base","transform":{"position":[0,0,0],"rotationRad":[0,0,0],"scale":[1,1,1]}},{"type":"assembly_ready","at":2,"entityId":null,"transform":null},{"type":"scene_revealed","at":3,"entityId":null,"transform":null}],"meta":{"model":"muse-spark-1.3","requestId":"<provider-id>","latencyMs":1,"estimatedCostUsd":0},"limitations":["A cena é uma composição conceptual por primitivas; não é reconstrução métrica ou fiel."]}
```

The example is illustrative; the Meta result is never replaced with it. For image input, the source SHA is over validated decoded bytes. Missing scale stays unknown and the response states this limitation.

### `POST /api/spatial/edit` — paid text-to-operation route

```json
{"sessionId":"<uuid>","baseRevision":0,"instruction":"Change the blades from six to eight."}
```

The model proposes one operation against an existing entity. The server validates it through the same plan contract and applies it only if valid. Supported kinds: `set-transform`, `set-material`, `set-geometry`, and `set-repeat`. Stable IDs are preserved. Updated properties use `origin: "inferred"` and evidence that Meta proposed the operation from an unverified instruction. A successful response includes `operation`, incremented revision, updated `plan`, and Meta usage. The model's operation is not an authenticated human review.

### `POST /api/spatial/operation` — local declarative review/edit route

```json
{"sessionId":"<uuid>","baseRevision":0,"operation":{"contract":"unfold.spatial-operation.v1","operationId":"review-01","kind":"set-transform","entityId":"base","value":{"position":[0,0,0],"rotationRad":[0,0,0],"scale":[1,1,1]}}}
```

Returns `unfold.spatial-review.v1`, updated plan/revision and `review.actorEvidence: "client_asserted_unverified"`. Updated properties use `origin: "user_provided"`, with evidence that the operation was client-submitted; this does not prove it was authored or reviewed by a person. Do not display that field as proof of a person's identity or approval; the API has no authenticated reviewer identity. UI authorization, reviewer identity, explicit acknowledgement, and durable audit remain the Terminal integration's responsibility.

### `POST /api/spatial/undo`

Send `sessionId` and current `baseRevision`; restores the preceding plan as a new monotonically increasing revision. History is bounded to the latest 50 operations and exists only in the backend process.

Typical errors: `INVALID_SPATIAL_SOURCE`/`INVALID_SPATIAL_IMAGE`/`INVALID_SPATIAL_INSTRUCTION` (400), `SPATIAL_SESSION_NOT_FOUND` (404), `SPATIAL_REVISION_CONFLICT`/`SPATIAL_UNDO_EMPTY` (409), `SPATIAL_OPERATION_BLOCKED` (422), `META_CALL_BUDGET_EXHAUSTED` (429), `MODEL_API_KEY_MISSING` (503). Invalid plans are never sent to the renderer.

## Existing workspace reuse

- Use the Terminal's existing Three.js renderer, scene, camera, inspector, pointer selection and timeline. No second renderer is required.
- Three.js is already a direct dependency (`three`); `OrbitControls` is already used in Cinema and can be reused by the existing workspace camera owner.
- `createStudioEnvironment(renderer)` in `src/living/cinema/studio-environment.ts` is an optional owned lighting/environment helper if the current renderer does not already have a Cinema environment.
- `disposeOwnedGeometries` in `src/rendering/lifecycle.ts` is the shared geometry cleanup utility; this module also disposes adapter-owned materials via `disposeSpatialPlan`.
- Cinema's current `CinemaRuntime` still consumes excavator `Assembly` and pose-source contracts. It cannot accept `SpatialPlan` directly; integrate the returned Group into the common workspace stage first. A Cinema-domain adapter requires a separate consumer-side change.
- `spatialConstructionEvents(plan)` emits scene-created, component-placed, relationship-established, assembly-ready and scene-revealed events. The common timeline may stage/reveal these events. They are presentation choreography, not engineering or physical simulation.

## Current boundaries and gaps

The implementation supports generic primitive composition and repetition, but it does not guarantee that a model will make a recognizable object, infer hidden components correctly, or preserve topological continuity. The plan is a concept scene, not a photogrammetric reconstruction. There is no image-to-world calibration, physical scale, collision/structural validation, aerodynamic/magnetic/fluid simulation, or validated joint solver. No general animated motion track is currently emitted; the browser harness only reveals components sequentially. `relationship` labels and Meta evidence are unverified model proposals until a user reviews them in the integrated UI. Session state is volatile and there is no server-side user authorization. Meta output is strict-schema validated but has no automatic repair/retry; failures return an error rather than falling back to a fixture.

## Local validation

`npm test` covers the spatial schema, bounds, hierarchy, local edits and actual repeated-mesh counts. `npm run build` checks TypeScript and the Vite graph. Start the backend and Vite server with the project's normal environment, then `npm run test:e2e:universal-spatial` runs a real browser call through the `/universal-spatial` technical harness and saves a screenshot/report under `reports/universal-spatial/evidence/`. This route is test tooling only and must not be mounted as the common workspace.

## V2 integration contract (opt-in)

### Modules and renderer ownership

Import from `src/universal-spatial/`: `SpatialPlanV2`, `validateSpatialPlanV2`, `spatialPlanV1ToV2`, `compileSpatialPlanV2`, `disposeCompiledSpatialPlan`, `evaluateSpatialConstraintsV2`, `createSpatialPlanV2`, `editSpatialPlanV2`, `applySpatialPlanV2Operation`, `evaluateSpatialPlanV2`, `refineSpatialPlanV2`, and `undoSpatialPlanV2`. `compileSpatialPlanV2(plan)` returns `{ root, stats }`; attach `root` to the already-mounted workspace Three.js scene, keep the returned stats for Inspector/performance display, and call `disposeCompiledSpatialPlan(root)` when replacing/unmounting. The workspace remains owner of renderer/Cinema lights/camera/picking/timeline and auth. Mesh `userData.spatialEntityId` and `spatialSubcomponentKey` are stable selection targets. No new workspace should be shipped.

### `unfold.spatial-plan.v2`

Plan envelope: `contract`, `source: { kind: "text"|"image", sha256 }`, `title`, `units: "m"|"unitless"`, `presentationProfile: "neutral"|"industrial"|"organic"|"educational"`, `components[]`, `relations[]`, `constraints[]`, `unknowns[]`. Component shape: `{ id, label, parentId, geometry, transform, provenance }`. Provenance is property-specific: `{ geometry, transform, material, evidence }`, and each origin is `observed | inferred | user_provided | design_approximation | unknown`. A screenshot or photograph without known reference scale must remain `unitless`, preserve unknown dimensions, and never be promoted to a measured model. Image SHA is computed over validated decoded image bytes; text SHA covers the exact submitted instruction.

Geometry is a recursive `group` (`key`, transform, repeat, non-empty children) or `shape` (`key`, `operator`, exact typed parameters, transform, repeat, material). Operators: `box`, `rounded_box`, `sphere`, `ellipsoid`, `cylinder`, `cone`, `torus`, `extrude`, `tube`, `revolve`, `loft`. No booleans, scripts, or arbitrary code. Repeat may be `null`, else `{ kind: "linear"|"radial", count: 2..64, axis: "x"|"y"|"z", spacingOrRadius }`. Material is per shape (`profile`, hex `color`, `roughness`, `metalness`, `clearcoat`). The full strict schema/limits live in `contracts-v2.ts`; current compiler cap is 512 geometry nodes, depth 12, 1,000 rendered meshes and 400,000 estimated triangles. Muse Spark's endpoint schema is deliberately shallower: one group level with shape children, and nested values are JSON strings that the server hydrates before full V2 validation. Missing/invalid appearance fields or operator parameters can be replaced by explicit dimensionless fallback values with `design_approximation` provenance and an unknown recorded. Other invalid plans are rejected. The provider's schema-depth cap is narrower than the local V2 contract.

### API routes

Every POST uses JSON, allowed local origin/Host or the existing local token for script clients. Paid calls consume the existing Meta budget and request slots. API images are bounded to 10,000 pixels per side and 16 MP; screenshot/image routes are rate limited to four per minute per peer. Session lifetime is in-memory 30 minutes, history maximum 50 changes; clients should handle 404 expired session and 409 stale revision. Meta errors never fall back to fixture plans.

`POST /api/spatial/v2/plan` (paid, live Meta):

```json
{"sourceKind":"text","instruction":"Build a small desktop wind turbine with a tower, nacelle, hub and three curved blades.","mode":"live","maxRefinements":1}
```

For an image send `{"sourceKind":"image","imageDataUrl":"data:image/png;base64,...","maxRefinements":1}`. A successful response includes `{ contract:"unfold.spatial-plan.v2", sessionId, revision:0, plan, sceneSummary:{componentCount,geometryNodeCount,operators,constraintReady}, constraintReport, constructionEvents, meta, limitations }`. `meta` reports provider model/request ID, latency, usage and estimated cost when available. Example plan fragment:

```json
{"contract":"unfold.spatial-plan.v2","source":{"kind":"text","sha256":"<sha256>"},"title":"Wind turbine concept","units":"unitless","presentationProfile":"industrial","components":[{"id":"tower","label":"Tower","parentId":null,"geometry":{"type":"shape","key":"tower-shell","operator":"loft","parameters":{"profile":[[-0.12,-0.1],[0.12,-0.1],[0.12,0.1],[-0.12,0.1]],"sections":[[0,0.75,0.75],[2,0.3,0.3]],"capEnds":[true,true]},"transform":{"position":[0,0,0],"rotationRad":[0,0,0],"scale":[1,1,1]},"repeat":null,"material":{"profile":"metal","color":"#777777","roughness":0.45,"metalness":0.65,"clearcoat":0.1}},"transform":{"position":[0,0,0],"rotationRad":[0,0,0],"scale":[1,1,1]},"provenance":{"geometry":"inferred","transform":"inferred","material":"design_approximation","evidence":"A tapered support is inferred from the text request."}}],"relations":[],"constraints":[],"unknowns":["No physical dimensions were supplied."]}
```

`POST /api/spatial/v2/edit` (paid Meta proposal): `{"sessionId":"<uuid>","baseRevision":0,"instruction":"Move the nacelle 0.1 units upward."}`. It returns the updated plan, validated operation, incremented revision, constraints, and `review:{status:"applied",actorEvidence:"client_asserted_unverified",authenticatedReviewer:false}`. This is an inferred/model-proposed change; it does not prove human review.

`POST /api/spatial/v2/operation` (local typed operation): `{"sessionId":"<uuid>","baseRevision":0,"operation":{"contract":"unfold.spatial-operation.v2","operationId":"edit-001","kind":"set-transform","componentId":"nacelle","nodeKey":null,"value":{"position":[0,2.1,0],"rotationRad":[0,0,0],"scale":[1,1,1]}}}`. Allowed kinds: `set-transform`, `set-geometry`, `set-material`, `set-repeat`. The response labels actor evidence `client_asserted_unverified`; client submission is not proof of a human identity. The consumer's authenticated review UI must record identity/acknowledgement in its own audited integration, rather than deriving it from this API field.

`POST /api/spatial/v2/evaluate` (paid image): `{"sessionId":"<uuid>","baseRevision":0,"imageDataUrl":"data:image/png;base64,<rendered screenshot>"}`. The plan and original prompt come from the server session. Returns `{ contract:"unfold.spatial-evaluation.v1", revision, evaluation:{recognizabilityScore,silhouetteScore,spatialIntegrityScore,confidence,discrepancies,suggestedOperation,rationale}, suggestionStatus, refinementBudget, constraintReport, meta, limitations }`. Scores and discrepancy labels are fallible visual hypotheses, not objective metrics. A proposed change is pending and never applied by this route.

`POST /api/spatial/v2/refine` and `/api/spatial/v2/undo`: `{ "sessionId":"<uuid>", "baseRevision":0 }`. Refine applies one valid pending visual operation only, within the plan's 0–2 limit; undo restores the previous valid plan as a new revision. Undo returns 409 when history is empty. Both return the current plan, constraints and revision. Treat revision as an optimistic concurrency token.

### Constraints and evidence limits

Kinds: `coaxial`, `aligned`, `attached_at`, `centered_on`, `symmetric`, `parallel`, `perpendicular`, `distributed_around`, `connected_by_curve`, `maintains_clearance`. A result gives status, measure, tolerance, method and limitation. World-transform checks evaluate orientation/alignment; AABB-based contact/clearance/curve checks are approximations. Radial checks validate compiler repeat metadata and component origin. These do not certify mechanical validity, collision-free surfaces, structure, fluid dynamics, or any physical simulation. Keep violated checks visible; do not hide them with camera framing.

### Foundry, Cinema, timeline and assets

Use the common workspace renderer/selection/inspector/timeline and its existing Cinema environment. `src/living/cinema/studio-environment.ts` offers a reusable lighting lifecycle; `three` and `OrbitControls` are already available. V2 owns only its compiled Group/geometries/materials and has an explicit disposal call. Construction events can stage the same workspace timeline; they are presentation cues, not measured physical motion. The `/universal-spatial-v2` harness is development/test tooling only. No third-party GLB/GLTF is shipped, so no asset license/attribution is implied; future assets require a provenance/license manifest, source checksum, scale/orientation/anchors and geometry/texture bounds. No specialized paid mesh provider or new dependency is present.

The full Foundry transfer analysis, asset strategy, checks and limitations are in [`V2-ARCHITECTURE.md`](./V2-ARCHITECTURE.md). Run `npm test`, `npm run build` and the V2 browser/live procedure documented in `reports/universal-spatial-v2/RESULTS.md`; mock API tests are not Meta evidence.

## Visual recovery additions

Presentation (framing, verified captures, stage, assembly solver, material profiles, field-level parameter repair) is documented with measurements and limits in `reports/visual-recovery/RESULTS.md`. The compiled geometry and the plan contract are unchanged; presentation scale is applied by a wrapper and never written back to a plan. Solver and human edits go through `applySpatialOperationV2`.

> Note (V4 branch): the `/universal-spatial-v2` Engine Lab page, its harness and e2e tests were removed. Visual validation runs in `/living`.
