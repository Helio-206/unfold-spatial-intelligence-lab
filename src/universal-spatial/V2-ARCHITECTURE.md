# Universal Spatial Engine V2 architecture

## Foundry study and transfer boundary

Inspection covered `src/living/visual-foundry/`, `src/living/visual-foundry/excavator/`, `premium-look.ts`, `src/living/cinema/`, workspace design, renderer lifecycle, geometry/material utilities, and Foundry tests. The Foundry result is stronger than V1 because it uses semantic subassemblies with stable identities; authored profiles and tubes; local transforms and articulated parent/child structure; controlled edge normals and material grouping; and a dedicated Cinema light environment. V1 emitted one basic geometry primitive per entity, so silhouettes, thickness and internal detail were constrained before Three.js rendering began.

| Transfer | Reusable capability |
|---|---|
| Direct reuse | Three.js renderer, Cinema's `createStudioEnvironment(renderer)` lifecycle pattern, orbit/picking conventions, explicit resource disposal, and common workspace inspector/timeline ownership. |
| General operators | Declarative groups/local transforms; rounded boxes; bounded profiles with bevel/creased normals; extrusion; revolution; loft; swept tubes; linear/radial repetition; instancing; node-level materials; geometry budgets; and measurable spatial checks. Implemented independently under `universal-spatial`; no Foundry model code is imported. |
| Domain-specialized | Excavator dimensions and axes, arm pose solver, pin/joint anchors, hose endpoints, component registry, machine palette/accents, industrial detail placement and engineering checks. These are not universal operators or evidence of valid mechanics. |

`premium-look.ts` demonstrates reversible presentation profiles and cached generated materials; V2 instead assigns bounded PBR-like material properties per geometry node and lets the consumer keep Cinema as the single renderer/environment owner. This prevents the excavator industrial look being imposed on anatomy, glass or organic objects.

## Contract and operators

`unfold.spatial-plan.v2` is strict and versioned. It has plan-level `source` (`kind`, SHA-256), `units`, presentation profile, components, relations, constraints and unknowns. Every component has a stable ID, optional parent, local transform, recursive geometry node and separate `geometry`, `transform`, `material` provenance plus evidence. Each group/shape node has a stable `key`, local transform and explicit `repeat` (`null` when absent). Shape nodes also carry a typed operator, exact operator-specific parameter object and material profile/color/roughness/metalness/clearcoat.

The Meta endpoint rejects recursive schemas and caps schema nesting depth. The API therefore gives Muse Spark a shallow bounded response schema: a component may contain a group of shape children, while complex parameters, transforms, repeats and materials are JSON strings. The server hydrates these values, normalizes missing transform fields to explicit identity defaults with an evidence note, and uses neutral material defaults for incomplete/unusable appearance fields, marked `design_approximation`. Invalid operator parameter objects receive small dimensionless defaults for that same allowlisted operator; the component provenance changes to `design_approximation` and an unknown is added. Other invalid plan fields remain rejected. The full recursive V2 validator and render budgets run after normalization. The local contract supports deeper group nesting than the current Meta response schema can emit. This is a provider boundary, not a geometry-compiler limit.

Supported operators: `box`, `rounded_box`, `sphere`, `ellipsoid`, `cylinder`, `cone`, `torus`, `extrude`, `tube`, `revolve`, and `loft`. Repetition supports linear and radial patterns with 2–64 instances; a repeated primitive compiles to `InstancedMesh`. Groups support nested subassemblies. Extrusion and loft profile polygons are checked for finite coordinates and self-intersection. Boolean CSG and arbitrary scripts are intentionally absent. The V1 adapter `spatialPlanV1ToV2` preserves source/entity IDs, origins, labels, geometry, transform, materials and unknowns; it does not add fabricated detail.

Bounds: existing maximum entities; 512 geometry nodes; depth 12; 1,000 rendered meshes; 400,000 estimated triangles; bounded vectors, profiles and tessellation; request body/image limits inherited from backend. Compiler counts actual compiled meshes/triangles and disposes partially built resources when budgets are exceeded.

## Constraint checks

Supported kinds are `coaxial`, `aligned`, `attached_at`, `centered_on`, `symmetric`, `parallel`, `perpendicular`, `distributed_around`, `connected_by_curve`, and `maintains_clearance`. Results report status, measured value, tolerance, method, and limitation. Transform comparisons use world transforms. Contact/clearance and curve connection currently use axis-aligned bounding boxes; radial distribution validates the compiler pattern metadata and component origin. These are geometric screens, not collision surfaces, mechanical validity, structural/aerodynamic analysis, or proof of fit. A violated constraint is returned explicitly and must remain visible to the workspace.

## Asset strategy

V2 currently ships no third-party geometry asset, GLTF loader path, asset manifest, or specialized mesh-generation service. This avoids unverified licenses/attribution and paid-provider coupling. A future asset adapter needs a reviewed manifest with source URL, author, SPDX/license text, attribution, source checksum, scale/orientation, semantic IDs/anchors, triangle/texture limits and decoder hardening. A vendor-specific mesh generator must remain optional behind the same validated plan and be disabled when credentials, budget, availability or license conditions fail. It must not become a compiler prerequisite.

## Visual evaluation loop

`POST /api/spatial/v2/evaluate` accepts a browser-rendered screenshot and returns bounded scores for recognizability, silhouette and spatial integrity, discrepancies, confidence, and an optional single local operation. Scores/descriptions are Meta hypotheses, not objective measurements. The operation is validated but held pending; `POST /refine` applies it only when called explicitly, under the session's 0–2 refinement budget. `POST /undo` restores the previous valid plan. Cost, latency and request ID are returned from Meta. A failed or invalid proposal is rejected; the current valid plan remains. There is no claim of automatic improvement unless comparison evidence shows it.

## V1 regression and blind-evaluation record

V1 PR #22 provided four scenarios (robotic arm text, turbofan image, fan repetition/edit, suspension bridge) with prior live/browser evidence. V2 API, geometry and browser checks are separate evidence; they must not be inferred from V1. Live results, the blind-object response, rendered screenshots, geometry statistics, measured constraint outcomes and Meta cost accounting are in `reports/universal-spatial-v2/RESULTS.md`. The blind input was submitted after freezing `ed05db4482768de2cae6b585397e8af3588b5fdd`; no object-specific code was added after selection. The evaluation scores remain model hypotheses and the scene quality is NO-GO.

## Consumer integration boundary

The only intended consumer is the existing Unified Spatial Workspace. It should retain ownership of its renderer, scene, camera/Cinema environment, picking, component selection, inspector, timeline, auth, and human-review identity. The adapter supplies a validated plan, owned Three.js `Group`, stable entity/subcomponent IDs, constraint report, event sequence, and disposal function. The technical harness at `/universal-spatial-v2` is test-only, not a second product workspace. The optional asset/provider extension is not part of this change.
