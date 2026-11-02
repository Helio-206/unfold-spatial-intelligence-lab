# Rendering integrated into the editor: results

Branch `feat/architectural-visual-fidelity`, on top of `main` after PR #7 (`4d47362`). Everything below comes from the real editor in Chrome with
SwiftShader (software rasteriser). **No real GPU was available**: timings are relative, not a promise for any device.

Data origin, kept apart:

- **Real product data**: `real-sample-1`, the plan in `.local-fixtures/sample-1.png` (not in git), run through the editor's own detect / calibrate (Balcony = 6.0 m typed by a person) / build flow. Its walls and rooms are `derived / unreviewed`.
- **Synthetic fixtures**: `two-rooms`, `multi-room`, `provisional` (`src/rendering/fixtures.ts`), restored from localStorage. Their "confirmed" provenance is a fixture choice and says so in its evidence text.

Sheets in [`sheets/`](sheets/) are `before (main) | technical | presentation`, same scene, same camera, same viewport. Views that main cannot reach (interior, details) show only the two new columns. Raw numbers: [`evidence-after.json`](evidence-after.json), [`evidence-before.json`](evidence-before.json).

| scene | views |
|---|---|
| two rooms (synthetic) | [iso](sheets/two-rooms__iso.png) · [top](sheets/two-rooms__top.png) · [interior](sheets/two-rooms__interior.png) · [door](sheets/two-rooms__door-detail.png) · [window](sheets/two-rooms__window-detail.png) · [material](sheets/two-rooms__material-detail.png) |
| five rooms (synthetic) | [iso](sheets/multi-room__iso.png) · [top](sheets/multi-room__top.png) · [interior](sheets/multi-room__interior.png) · [door](sheets/multi-room__door-detail.png) · [window](sheets/multi-room__window-detail.png) · [material](sheets/multi-room__material-detail.png) |
| provisional (synthetic) | [iso](sheets/provisional__iso.png) · [top](sheets/provisional__top.png) · [interior](sheets/provisional__interior.png) · [material](sheets/provisional__material-detail.png) |
| real plan | [iso](sheets/real-sample-1__iso.png) · [top](sheets/real-sample-1__top.png) · [interior](sheets/real-sample-1__interior.png) · [material](sheets/real-sample-1__material-detail.png) |
| wall-removal preview, blocked removal, applied | [screenshots/](screenshots/) |

No cutaway sheet: the editor has no section tool and none was added.

## What was wrong, and why

| defect | root cause | fix |
|---|---|---|
| GPU leak on rebuild | the editor disposed only `Mesh` geometries; the outline `LineSegments` (provisional edges) were never freed | `disposeOwnedGeometries` (meshes, lines, points; once each; shared GLB geometry untouched) |
| wrong corner fillers | filler logic assumed ground-level walls and the group's local frame | computed in world space (elevation, translated/rotated parents, equal world thickness, exactly two ends, no T-junctions); omitted when unsure |
| z-fighting floors | the same room selected from a region and from orthogonal support gives two coplanar polygons | `planFloors`: identical duplicates drawn once and reported, partial overlaps drawn translucent/hatched, nothing deleted |
| hi-res export differed from the viewer | environment map belonged to another GL context; camera was mutated in place | temporary renderer builds its own map, camera is a clone, scene pointer restored |
| removal ghost looked like the old renderer | ghost used the legacy wall mesh | ghost reuses the new wall geometry and the shared material colours |
| editor only used default geometry | no lights/profile/export wiring | `viewer.ts` controller + two controls |
| controls collided with other UI (found in the browser) | the bottom toolbar and the floating command bar share the same strip; the removal card sits top right | the two controls live in their own group centred under the header; on 390 px the toolbar now scrolls instead of overflowing |

## Resource lifecycle (real editor, 20 Technical <-> Presentation cycles)

| | five rooms | real plan |
|---|---|---|
| scene-owned geometries, every 5th cycle | 101 / 101 / 101 / 101 | 107 / 107 / 107 / 107 |
| `renderer.info` geometries / textures after cycles | 33 / 8 constant | 40 / 11 constant |
| lights per profile | constant, no duplicates | |

`renderer.info.memory.geometries` counts only geometries already uploaded, so it moves with what the camera sees; the scene-owned count is the stable one. Unit tests (`tests/rendering-lifecycle.test.ts`) check the same with a mock GL: materials/textures constant across 20 profile switches, freed once on teardown.

## Performance (SwiftShader, 60 frames, `readPixels` to force completion)

| scene | profile | frame ms mean / p95 | draw calls | triangles | rebuild on switch (ms) |
|---|---|---|---|---|---|
| five rooms | technical | 42.3 / 47.6 | 83 | 4 145 | 18 to 22 |
| five rooms | presentation | 233 / 258 | 107 | 4 193 | 16 to 22 |
| real plan | technical | 31.1 / 34.2 | 57 | 217 | 47 to 59 |
| real plan | presentation | 111 / 121 | 135 | 373 | 55 to 90 |

Resolved profile on this machine (software renderer detected): shadow map 1024, pixel ratio 1 (presentation); technical has no shadows. Presentation is about 3.5 to 5.5x technical on a CPU rasteriser; the ratio on a GPU is unknown and must be measured before changing the default (it stays Technical).

## High resolution export from the editor

Presentation, five rooms, through the real menu. Files in [`exports/`](exports/).

| requested | actual | tiles | time | PNG |
|---|---|---|---|---|
| 1920 x 1080 | 1920 x 1080 | 4 | 4.2 s | 0.5 MB |
| 2560 x 1440 | 2560 x 1440 | 6 | 4.0 s | 0.8 MB |
| 3840 x 2160 | 3840 x 2160 | 12 | 4.9 s | 1.7 MB |

Here `MAX_TEXTURE_SIZE` is 8192 so nothing was clamped. On a device that clamps, the card says "O dispositivo não permitiu o tamanho pedido", the file name carries the real size, and nothing claims 4K. Framing: the export shows what the viewport shows (wider output adds room at the sides).

Consistency, measured in the editor (pixel difference over RGB, 0 to 255):

| comparison | mean abs diff | pixels differing by more than 8 | max |
|---|---|---|---|
| 1920x1080, tile 512 vs tile 4096, technical | 0.0010 | 0.003 % | 44 |
| same, presentation | 0.0010 | 0.004 % | 49 |
| seam columns only (tile 512), technical / presentation | 0.0094 / 0.0093 | | |
| editor canvas vs export at the same size, technical | 0.0003 | 0.0008 % | 41 |
| same, presentation | 0.0004 | 0.0008 % | 49 |

The differing pixels are isolated antialiasing differences on edges, not seams (seam columns are about 10x the average but still below 0.01). Shadows continue across tiles because they come from the light's own camera.

## Browser E2E

`tests/e2e/rendering-integration.pw.mjs`: 63/63 ([`results.json`](results.json)). Covers: starts in Technical; 12 switches with no growth in geometries, textures, shader programs or lights; no revision and unchanged stored scene; camera and selection kept; keyboard (Enter/Space, menu arrows, Escape); removal preview in both modes, switching quality with the card open, cancel, blocked removal, successful removal, one undo entry, undo and redo; export 1920, 2560 and 3840 with real PNG sizes, honest card text, unchanged camera, scene and resource counts, cancel mid-export; 4 exit/re-enter cycles; 390 px layout, visible focus, reduced motion; no console errors; no request outside localhost (nothing paid).

PR #7 regression gate, run unchanged on this branch: `wall-removal-merge.pw.mjs` 101/101, `confirmed-values-authorization.pw.mjs` 60/60.

## Limitations

- Software rendering only. Frame times, the adaptive thresholds and the shadow size need a check on real hardware.
- Duplicate coplanar *walls* are not deduplicated (only floors).
- Hairline seam where two collinear wall segments abut.
- No cutaway/section tool, so no cutaway evidence.
- The bottom toolbar still sits under the floating command bar in the demo shell (was already so; not changed here). The new controls avoid that strip.
- `assets/blender/` unchanged (no Blender here).
- The real plan's rooms are unreviewed derived geometry, so most of its pixels are the reference image; floors are hidden by it.

## Contracts

`src/spatial-scene.ts`, room-merge, boundary rules, transactions, confirmation/authorization, provenance semantics, solvers and the perception algorithm are not modified. Rendering reads the scene and never writes it: `JSON.stringify(scene)` is identical before and after building in both profiles (unit tests) and the stored scene is byte-identical after switching, exporting and cancelling (E2E).
