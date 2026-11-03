# Premium look: before / after

Branch `feat/living-premium-visual` (from main `1feb64e`). Real `/cinema` page, studio tier, Chrome + **SwiftShader (software; no GPU timings)**. Every pair is rendered from the **same camera**: the presentation camera is read, the interactive profile is rendered from exactly that pose, then the presentation profile. Machine: the Visual Foundry excavator (13 canonical parts), driven by the engineering engine (the "articulated" views are the engine frame at the end of the scenario).

[`before-after-sheet.png`](before-after-sheet.png) · pairs: `hero`, `hero-articulated`, `profile-articulated`, `bucket-close` (`*-before.png` / `*-after.png`). Numbers per view: [`evidence.json`](evidence.json).

## What changed

| layer | file | what |
|---|---|---|
| Material profile (reusable) | `src/living/visual-foundry/premium-look.ts` | `applyPremiumLook(root)` clones the Foundry materials (graphite clear-coat paint, brushed and machined steel, polished chrome rods, wet-sheen rubber, dark reflective glass), shares their textures, adds UNFOLD fold-orange accent zones through a position mask (handrail and cab frame, counterweight stripe, bucket and idler links), and returns a handle whose `revert()` restores the original material objects and disposes only the clones. `materials.ts` is untouched. |
| Studio specification (reusable) | same file, `PREMIUM_STUDIO` | plain data: HDR environment panels plus black "pillar" absorbers (architecture in the reflections), key / rim / kick lights, floor pool light, polished-concrete floor, backdrop, grade. Any stage can build the same set from it. |
| Cinema consumer | `cinema/studio-stage.ts`, `studio-environment.ts`, `post.ts`, `choreography.ts`, `cinema-runtime.ts`, `cinema-page.ts`, `cinema.css` | `runtime.setProfile('interactive' \| 'presentation')`, `?profile=`, a two-button control in the header, a lower and tighter hero for presentation. `interactive` is the default and is unchanged. |

## Guarantees (tests, not claims)

- Materials only: names, canonical ids, geometry, transforms, hierarchy, `displayOnly` flags, picking and hose routing are identical in both profiles (unit test on a fingerprint of the whole model; browser test on part poses, hose signature, pick result and screen boxes).
- Studio decoration is in the environment map or outside the machine root (lights, floor, backdrop), so it is never raycast and never enters the machine's bounds or measurements.
- Reversible, no accumulation: 25 `presentation` / `interactive` round trips leave geometries, textures, lights, shader programs and premium material count unchanged; the interactive image after the round trips is pixel-identical to the one before (hash); dispose with the presentation profile active releases geometries and textures to 0.
- The look follows articulated frames: with the premium materials, an engine pose is applied exactly (error below 1e-9 m) and the hoses are re-routed.

## Honest limits

- The geometry supports a convincing *industrial product* look, not photorealism: the hood and cab are simple volumes, the cab glass is a flat pane with a dark interior, there is no wiring, no decals, no panel-gap detail and no real tracks wear. The reference's quality in those areas needs new geometry from the Foundry.
- Accent zones are position masks inside merged Foundry meshes (one mesh per part and material), so they are coarse; clean accent on specific panels needs the Foundry to split those meshes.
- No global illumination or real HDRI: reflections come from a procedural studio, so the floor reflection is a mirrored copy, not ray-traced.
- Software rendering only: about 10 s per 1080p studio frame here. Nothing in this report says anything about GPU performance.

## High-impact geometry that would raise the result most (not done here)

1. Cab: real window frame with visible interior (seat, controls), door, roof rails and a work-light bar.
2. Hood and counterweight: panel splits, grilles with depth, a radiator bay, exhaust.
3. Boom and stick: cast bosses and weld seams at the pivots, tapered sections.
4. Hydraulics: rod guards, hose fittings and clamps along the boom (the Foundry's hoses exist; their routing along the boom does not).
5. Bucket: wear plates, side cutters, tooth adapters.
