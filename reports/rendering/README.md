# Architectural visual fidelity: results

Branch `feat/architectural-visual-fidelity`, from `origin/main` `f090210`. Architecture and usage: [`src/rendering/README.md`](../../src/rendering/README.md).

**Files NOT touched** (PR #7 owns them): `src/room-merge.ts`, `src/plan-scene.ts`, `src/spatial-editor.ts`, `src/removal-preview.ts`. No scene-graph contract, transaction, agent, solver or design-system file changed. The only existing file edited is `src/plan-three-adapter.ts`.

## Why the scenes looked like blocks (measured on main)

1. **Floors were never visible.** Room polygons were rotated with `rotateX(+90°)`, which flips the face normal to point down; with one-sided materials the floor is culled from above. In the "before" images the rooms are black holes.
2. **Outer corners had a notch.** Two walls meeting at a right angle each end on their centreline, so half a wall thickness is missing outside the corner.
3. **No material response.** Every wall without openings was a cloned GLB box with one flat plaster material; walls with openings used another shared flat material; faces, tops and opening reveals were the same colour, so edges and depth did not read.
4. **Openings had no frames without the GLB.** A door or window node rendered nothing at all when the Blender modules were not loaded.
5. **Provenance was invisible.** An unreviewed or ambiguous wall looked the same as a confirmed one.
6. Not the cause: polygon count. The scenes have 4 to 5 k triangles; the improvement below *lowers* the triangle count (5 057 → 4 145 on the five-room scene) because walls are single extrusions instead of bevelled GLB boxes.

## What changed

- Walls: one extrusion per wall with real openings cut through the full thickness; material 0 for the two faces, material 1 (cap) for top, ends and reveals, so edges and reveal depth read under any light. Position, length, height and thickness are those of the node (tested to 1e-5).
- Openings: when no Blender module is supplied, frame (6 mm proud of each face, so no coplanar faces), glass pane, stone sill and a closed timber leaf are built from the opening node's own box and the wall's thickness. When the module is supplied it is used as before, with its materials mapped to the shared library.
- Floors face up; `polygonOffset` separates them from the ground without moving them.
- Corner fillers (presentation only): the missing quadrant at two-wall right-angle corners with matching endpoints within 2 cm. Tagged `presentationOnly`, not pickable, never added at T-junctions.
- Provisional: dashed outline on every wall that is not human-confirmed; ambiguous walls also get a diagonal hatch (in both profiles). Confirmed walls have neither.
- Materials: shared library per profile; presentation adds procedural normal/roughness (plaster, concrete, timber) and an environment for glass and metal.
- Lighting and output (`stage.ts`): technical keeps the viewer's current three lights and no tone mapping; presentation uses hemisphere + shadow-casting key + fill, ACES tone mapping at exposure 0.92, PCF soft shadows fitted to the model, sRGB output.
- High resolution (`hires.ts`): tiled render of the same scene and camera.

## Visual comparisons

Identical scene, camera, viewport (1280 x 720) and lights in each row. "before" = a frozen copy of `main`'s adapter; "technical" uses the same editor lights as "before", so the difference is geometry and materials only; "presentation" adds its own stage. Sheets are in [`sheets/`](sheets/) (left to right: before, technical, presentation).

| view | sheet |
|---|---|
| Isometric, five rooms | [multi-room__isometric](sheets/multi-room__isometric.png) |
| Isometric, two rooms | [two-rooms__isometric](sheets/two-rooms__isometric.png) |
| Top-down | [two-rooms__top](sheets/two-rooms__top.png) · [multi-room__top](sheets/multi-room__top.png) |
| Cutaway (horizontal section at 1.45 m, same plane in each column) | [two-rooms__cutaway](sheets/two-rooms__cutaway.png) · [multi-room__cutaway](sheets/multi-room__cutaway.png) |
| Interior | [two-rooms__interior](sheets/two-rooms__interior.png) · [multi-room__interior](sheets/multi-room__interior.png) |
| Door detail | [two-rooms__door-detail](sheets/two-rooms__door-detail.png) |
| Window detail | [two-rooms__window-detail](sheets/two-rooms__window-detail.png) |
| Material detail | [two-rooms__material-detail](sheets/two-rooms__material-detail.png) · [two-rooms__corner-detail](sheets/two-rooms__corner-detail.png) |
| Provisional geometry | [provisional__isometric](sheets/provisional__isometric.png) · [provisional__top](sheets/provisional__top.png) · [provisional__material-detail](sheets/provisional__material-detail.png) |
| High resolution | [2560 x 1440](images/hires__multi-room__2560x1440.png) · [3840 x 2160](images/hires__multi-room__3840x2160.png) |

What the sheets show: floors present (they are black voids in "before"); clean outer corners in presentation (technical keeps the notch on purpose: it only draws source geometry); separated face and cap material; frames, glass, sill and reveal depth at openings; hatched ambiguous wall in the provisional scene.

## High resolution

| requested | actual | tiles (1024 px) | time | PNG |
|---|---|---|---|---|
| 2560 x 1440 | 2560 x 1440 | 6 | 4.1 s | 1.1 MB |
| 3840 x 2160 | 3840 x 2160 | 12 | 4.8 s | 2.2 MB |

Renderer used: ANGLE / Vulkan / **SwiftShader** (software), limits `MAX_TEXTURE_SIZE` 8192, `MAX_SAMPLES` 4. Camera framing identical to the viewport (aspect preserved; if the requested aspect differed, the vertical field of view is kept and the report says so). GPU memory is bounded by the tile, not the output; the temporary renderer, its environment map and its context are released at the end. 4K is not guaranteed on every device: the output is clamped to the device's limits and the report returns the actual size.

## Performance (headless Chrome 153, SwiftShader; NOT a real GPU)

60 frames after 5 warm-up frames, each ended with a `readPixels` to force completion. Numbers vary by about +-20% between runs on this machine. Full data: [`benchmark.json`](benchmark.json), table: [`benchmark-table.md`](benchmark-table.md).

| scene | variant | frame ms (mean / p95) | draw calls | triangles | geometries | materials | textures |
|---|---|---|---|---|---|---|---|
| five rooms | before (main) | 44.5 / 52.9 | 64 | 5 057 | 24 | 8 | 0 |
| five rooms | technical | 37.6 / 44.6 | 84 | 4 145 | 33 | 7 | 0 |
| five rooms | presentation materials, editor lights | 47.7 / 54.8 | 108 | 4 193 | 37 | 7 | 7 |
| five rooms | presentation (full stage) | 178.1 / 235.2 | 108 | 4 193 | 37 | 7 | 7 |
| two rooms | before (main) | 34.1 / 41.0 | 28 | 2 116 | 18 | 8 | 0 |
| two rooms | technical | 28.4 / 34.4 | 36 | 1 744 | 21 | 7 | 0 |
| two rooms | presentation materials, editor lights | 45.0 / 55.6 | 60 | 1 792 | 25 | 7 | 7 |
| two rooms | presentation (full stage) | 154.3 / 178.4 | 60 | 1 792 | 25 | 7 | 7 |

Draw calls include the viewer's 74-line grid and, in presentation, the shadow pass. Other costs:

- Assets: no new binary asset. `architectural_library.glb` unchanged (188 460 bytes, fetch + parse 17 to 23 ms). Procedural textures: 7 textures, about 2.4 MiB in GPU memory with mipmaps, generated once per page in about 130 to 180 ms (CPU) and shared by every rebuild.
- Scene build: 1 to 2 ms (all variants); rebuilding creates no materials or textures (tested).
- Reading: technical is the same cost as the current viewer or lower (fewer triangles, less overdraw; more draw calls from the two-material walls). Presentation materials with the viewer's own lights cost about the same as today. The presentation *stage* (2048 px soft shadows, tone mapping, environment) is the expensive part: about 4x on a CPU rasteriser. That ratio will be much smaller on a GPU but **it was not measured on one**, so the shadow size and the adaptive switch (`adaptQuality`) must be checked on real hardware before presentation is made a default.
- Heap/GPU memory counters: `renderer.info.memory` (geometries, textures) recorded; Chrome exposes no GPU memory figure here.

## Acceptance criteria

| # | criterion | status |
|---|---|---|
| 1 | visibly improved geometric detail | yes: floors, corners, cap/face split, frames, glass, sills, reveals (sheets) |
| 2 | materials respond consistently to light | yes: one shared PBR library; Blender modules are re-mapped to it |
| 3 | openings keep position and size | yes: ray tests at the rectangle edges (tests), same rule as before for what fits in the wall |
| 4 | scene graph untouched | yes; `JSON.stringify(scene)` identical before and after building, in both profiles and for all three fixtures (tests) |
| 5 | same scene in both profiles | yes: same node groups, same world matrices and same wall/floor bounds (tests) |
| 6 | provisional stays visibly provisional | yes: dashed outline and, if ambiguous, hatch; confirmed walls have none (tests + sheets) |
| 7 | nothing invented or silently modified | frames, glass and leaf exist only for existing door/window nodes, sized by them; the only extra geometry is the tagged corner filler (presentation only, not pickable) |
| 8 | assets legally usable | no third-party asset; see `src/rendering/README.md` |
| 9 | tests and build pass | see below |
| 10 | performance measured and documented | yes, with the SwiftShader caveat |
| 11 | before/after screenshots | yes, same camera and viewport |

## Known limitations

- Software rendering only; no real-GPU numbers.
- Corner fillers need equal thickness and endpoints within 2 cm; walls that do not meet exactly keep their notch (this change does not move or stretch walls to hide it). Technical never fills.
- A hairline can show where two collinear wall segments abut (their end faces are coplanar).
- Duplicate coplanar floors (a room selected both from a closed region and from orthogonal support) still fight each other.
- Glass is alpha-blended, not transmissive (cost); procedural textures are stylised, not photographic.
- The viewer does not use any of this yet except the new default `technical` geometry (it calls `buildThreePlanGroup(model, assets)` without options). Switching profiles, the stage lights and image export need the follow-up in `src/rendering/README.md` once PR #7 is merged.
- `assets/blender/` was not changed: Blender is not available in this environment, and the existing module library did not need changes for these results.
