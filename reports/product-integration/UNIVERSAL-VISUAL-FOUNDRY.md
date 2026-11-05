# Universal Visual Foundry (experimental)

Branch `feat/universal-visual-foundry`, baseline `08f0d326fdf90a47c0d6cbb38d3378700990bd8b`. Final SHA: see the last commit of the branch (`git log -1`). No merge, no PR, nothing active by default.

## Architecture
`SpatialPlanV2 (+ local image evidence) -> classify (family vocabulary) -> VisualRecipe -> per-component generators -> materials -> scene graph`, in `src/living/universal-foundry/`.

- `ops.ts`: generic operators (below). `materials.ts`: 17 semantic PBR kinds. `recipe.ts`: typed grammar. `evidence.ts`: local image evidence. `interpret.ts`: plan to recipe. `families/*`: eight generators behind one `Family` interface (`registry.ts`). `foundry.ts`: compile seam. `provider.ts`, `panel.ts`, `browser.ts`: /living integration.
- The compile seam has the call shape of `compileSpatialPlanV2`. The V2 scene is drawn first; `upgrade()` then replaces each component's content with generated geometry fitted to that component's own local bounds, a few components per frame (14 ms slices, triangle budget). Component groups, ids, parent/child transforms, `userData` provenance and the plan itself are never touched. A component with no recognised role is drawn as a plain rounded solid and listed as inferred; an object no family recognises stays on V2 with a reported reason (`NO_RECIPE`), never silently.
- /living: `?debug-living&experimental-foundry` only. `SpaceFlow` gained an optional `geometry` seam and `onImage` hook; `PlanSpaceLayer` gained `regenerate()` (rebuild from the same plan). `GeometryFamily` gained `'universal_foundry'` so the existing inspector report shows it. Parameters persist per plan source hash (localStorage), so a saved Space reopens with the same recipe. Review, authorisation, selection, isolation, focus, undo are the existing ones, unchanged.

## Extracted operators (generic, not excavator code)
From the excavator's techniques (Chaikin-smoothed profiles, bevelled creased extrusions, lathes, plates, merged-per-material fasteners, hoses): `loftSections` (variable superellipse sections, flat bottom, caps, orientation check), `taperedBox`, `plateWithOpenings`, `panel`, `roundedRect`, `latheAxis`, `pillow`, `hinge`, `grille`, `hose`/`tubeAlong`, `boltCircle`/`boltRow`, `deform`/`bend`/`taper`/`twist`, `subdivide` (<=3 levels), `mergeVertices`, `blobField` (smooth-min SDF + seeded noise + surface nets under a triangle cap), `topologyReport`, `Bucket` (one mesh per material, mirrored adds), `Lod`. The excavator provider is unmodified.

## Recipe language
`VisualRecipe { category, archetype, seed, confidence, alternatives, proportions, palette, params + paramSpec, parts[{role, roleKnown, material, symmetry, repeat, articulation, style, details}], detailBudget, unknowns, evidence }`. Every value carries `Known = plan | evidence | inferred | unknown`; colours from the picture are `evidence`, generator defaults are `inferred`; nothing is promoted. `validateRecipe` is pure; `withParams` clamps. Generation is deterministic for a seed.

## Families and parameters
construction (track pads, rollers, teeth), vehicle (cabin height/start/end, rear slope, spokes, rim ratio, grille slats, doors, arches), furniture (finish, frame, leg style, puff, edge radius, slats), electronics (shell, key rows/cols, bezel), appliance (finish, knobs), architecture (wall finish, roof, inferred windows, panes), tool (grip, rings, teeth), organic (surface, smoothness, lumps, undulation, vase belly/neck/lip, leaf curl). Detail rules come from roles (e.g. wheel: sidewall, grooved tread, rim, spokes, lug bolts; wall: openings cut where window/door siblings sit; screen: bezel, glass, camera).

## Real visual results
`reports/product-integration/uvf/cross-category-v3-vs-foundry.png`: rows are V3 default then Foundry, same page and camera, real /living workspace (hatchback, sofa, washer, pavilion, apple, wrench, monitor, mini excavator). Individual shots, isolation and regeneration captures are in `uvf/living/`. The coarse input plans are hand-authored stand-ins (labelled, not Meta output) in `fixtures/plans.ts` and `uvf/plans/`; hatchback, SUV, table, sofa, monitor, washer, pavilion, wrench, apple, plant and mini excavator were written after the generators (the sedan, chair, laptop, fridge, house, hammer, vase were the development plans).

Honest reading of the screenshots: vehicles, sofa, washer, monitor, apple, pavilion read as the intended object with real detail. Weaker: the mini excavator is clearly an excavator but below the hand-built excavator Foundry (no hoses, simpler cab); the wrench takes a red rubber grip because the tool family defaults the grip (inferred, a parameter); car hulls are plain pill shapes; the hammer claw is a stub; metal finishes look dark/flat in the studio environment so tool heads use a painted-silver kind.

## Performance (SwiftShader Chromium, 1440x900, from `uvf/living/results.json`)
| object | V3 tri / meshes | Foundry tri / meshes | build to ready | GPU geometries / textures after reopen |
|---|---|---|---|---|
| hatchback | 684 / 5 | 45,832 / 25 | 2.2 s | 29 / 15 |
| sofa | 3,000 / 10 | 18,728 / 21 | 1.6 s | 25 / 16 |
| washer | 900 / 3 | 4,760 / 10 | 1.5 s | 14 / 14 |
| pavilion | 1,176 / 8 | 5,544 / 10 | ~0 s | 14 / 14 |
| apple | 816 / 2 | 5,668 / 3 | ~0 s | 7 / 12 |
| wrench | 600 / 2 | 1,960 / 3 | ~0 s | 7 / 12 |
| monitor | 900 / 3 | 3,172 / 6 | ~0 s | 10 / 10 |
| mini excavator | 2,196 / 8 | 18,640 / 27 | 2.4 s | 31 / 13 |

The "~0 s" rows were already ready when first polled. GPU counts were identical before and after a regeneration, save and reopen (no leak seen in `renderer.info`). Browser heap and a long-run memory trend were not measured.

## Tests
`tests/universal-foundry.test.ts` (all families classify, keep ids, are deterministic), `tests/universal-foundry-core.test.ts` (loft/blob topology and budgets, materials dispose, recipe validation/clamping, refusal of unknown objects, retire, local evidence), `tests/e2e/universal-foundry-living.pw.mjs` (8 categories in the real /living: build, plan unchanged, ids kept, selection, isolation, parameter regeneration, save, reopen, no console errors). Full suite: 2527 tests pass (before the last test file); `npm run build` passes.

## Not done / unsupported
- The reference-image comparison (Phase H) is not done: there are no photographs or independent reference renders in this delivery, so silhouette agreement against a reference and recognisability scoring are NOT measured. Evidence extraction is implemented and unit-tested on synthetic images only; in the flow it only supplies the body colour (`evidence`). Contours/component regions are not used for geometry.
- The browser flow was driven from text with a file-served plan (no Meta call); the image-upload path calls `onImage` but was not exercised end to end. No screen recording.
- Generation runs on the main thread in time slices, not in a Worker. Geometry beyond the family roles (interiors, hoses on the mini excavator, curved glass cabins) is not generated. No photographic accuracy is claimed; every added detail is inferred from roles.
- The generated meshes are not individually selectable beyond the component (selection is per plan component, as before).

## GO / NO-GO
NO-GO for guarded integration as it stands: the visual gain over V3 is real and the seam is safe (flag only, plan untouched, tested lifecycle), but the missing reference comparison, the image path e2e and memory measurements are required first. GO to continue as an experimental flag.
