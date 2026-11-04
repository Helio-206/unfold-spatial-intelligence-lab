# Adaptive Geometry Router — integration contract (V3)

Types: `types.ts`. Comparison and what was not verified: `reports/fidelity-v3/COMPARISON.md`.

## One rule above all

The reviewed V2 plan decides **what** exists (components, hierarchy, relations, per-property provenance, `source.sha256`, human review). A geometry family decides only **how** a component is drawn. The router reads the plan, never writes it, and returns the same kind of object as `compileSpatialPlanV2` (a `Group` whose component groups carry `userData.spatialComponentRoot` and `spatialEntityId`), so selection, picking, isolate, edit, solver and the Presentation Director work unchanged.

## Families

| Family | What it is | Source of the shape | Needs |
|---|---|---|---|
| `procedural_v2` | the existing compiler | the plan's parameters | nothing; **always the return path** |
| `continuous_surface` | one smooth surface per component from the plan's own primitives (implicit surface, surface nets), with blended joints to the parent | the plan's parameters (derived, nothing invented) | CPU only, bounded grid |
| `mesh_asset` | a validated GLB for chosen components | an **external mesh** the plan does not contain | an approved `AssetProposal` |

Specialised families are generic: eligibility is decided from the operators and topology of the plan, never from what the object is. Nothing in the code names an object.

## Guarantees

1. **Plan untouched**: deep-equal before and after, for every route.
2. **Same components, same ids, same hierarchy, same order**: a family cannot add, drop or merge components. Each component has a `RoutingDecision` saying which family drew it and why.
3. **Provenance not promoted**: `planGeometryOrigin` is copied; a derived surface stays `design_approximation` or whatever the plan said. An external mesh is marked `representation: 'external_asset'` with `assetId`, licence and source; it never becomes `observed`.
4. **No silent replacement**: a mesh is only a **proposal** (`AssetProposal`). It draws nothing until an `AssetApproval` names the components (preview → authorise → commit, like every other operation). Reviewed components keep their V2 drawing otherwise. The proposals not approved are listed in the report.
5. **Source hash preserved**: `RouterReport.planSource` is the plan's own `source`. A route does not change which source the Space refers to.
6. **Return to V2 on any failure**: oversize, budget, invalid GLB, grid or triangle limit, exception. The affected component is drawn by V2 and the decision records `fallback: { from, code }`. Another component is never affected, and a V2 failure for a component is the same error as today.
7. **Bounded**: `RouterLimits` caps triangles, meshes, geometry bytes, sampling grid, asset bytes, texture side and bytes, asset triangles and nodes. A scene over the budget returns to V2 for the most expensive components first.
8. **Disposal**: `disposeCompiledSpatialPlan` frees everything the router creates (geometry, materials, textures).

## Junctions and what the prototype learned

- A junction between two parts is drawn by **one side only**: the part with the thinner feature flares into the thicker one (ties: the later id). Both sides drawing it covers the same region twice in different colours and the skirts fight each other (observed, fixed).
- The fillet skirt is drawn with a polygon offset and its triangles inside the neighbour are removed, because the skirt and the neighbour's surface are nearly coincident.
- Known limit: the skirt's rim is resolution-limited (teeth the size of one grid cell).

## Safe GLB path (`validateGlb`, then load)

A GLB is data from outside. It is checked **before** any decoding: container and chunk lengths, JSON size, `asset.version`, node/mesh/triangle/texture counts, image dimensions read from the container, no external URIs (`uri` other than embedded data is refused), no extensions outside an allowlist (`KHR_materials_*`, `KHR_texture_transform`, `KHR_mesh_quantization`, `KHR_draco_mesh_compression` is **refused** until a decoder is vetted), accessor ranges inside buffer views. Failure returns a coded reason, never a partial scene. Memory is estimated from the decoded texture sizes, not the file size (a real CC0 asset was 17.5 MB on disk and 134 MB decoded). An intake may declare `downscaleTo`: textures are then reduced before they reach the GPU and memory is judged on the reduced size; a hard 4096 px cap still applies to what is decoded.

## Optional external providers

Behind `GeometryProvider`, **server side only**. No key, SDK or provider call in the frontend bundle. Before any call: budget gate (`NO_BUDGET`, `OVER_BUDGET` from `estimateCostUsd`), consent bound to the image hash **and** the provider id (`NO_CONSENT`, `CONSENT_FOR_OTHER_IMAGE`), provider configured. A refused call costs nothing and the Space continues on V2. The provider result is validated like any GLB and becomes a proposal, never a drawing. This PR ships **no provider implementation and makes no provider call**.

## What this does not claim

A generated mesh is a **plausible** shape, not a reconstruction, a measurement, certified CAD or validated anatomy. The continuous surface is smoother and better joined, not more informed: it cannot add detail the plan lacks. Floor plans are an architecture input and go to the plan reconstruction path, not to an object generator.

## Integration seam (needs the Terminal's decision)

`PlanSpaceLayer` calls `compileSpatialPlanV2` directly. The router has the same call shape. This branch adds an optional `compile` function to the layer's constructor, default unchanged, so a host can pass `router.compile`. That is the only change to a Terminal-owned file; it can be dropped and replaced by whatever seam the Terminal prefers.
