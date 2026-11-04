# Final acceptance test: phase 1 (two images)

Code frozen at `04709dca9e151e42e1f9d5873410fd437c09f495` (PR #27). Protocol, budget and incident log: `PROTOCOL.md`. Data: `RESULTS.json`. Phase 2 (text) has not been run: the requester supplies the object after this phase.

## What ran, and what did not

| | Image 1: floor plan | Image 2: lungs |
|---|---|---|
| Real Meta call | yes: `6708a264-69eb-40a2-93f5-6d4187870c1b`, 48.5 s, 1 315 in / 7 004 out tokens, ≈ US$ 0.031 (derived) | yes: `44a82d0a-cd02-46c8-8aa4-0d0b5a2cd4d7`, 49.1 s, 1 159 in / 6 936 out tokens, ≈ US$ 0.031 (derived) |
| Live steps completed | import, request, review, build, orbit, selection, edit preview, edit, colour, isolate, frame | same |
| Live run outcome | **aborted** at the idle-renderer assertion (4 frames in 2 s, limit 2) | **aborted**, same assertion |
| Steps 7-10 on that plan | run as a **labelled replay of this image's own stored plan** (no model call): explode, evidence, leave guard, My Spaces save/reopen/delete, GPU, console | same, with its own plan |

The aborts are failures of the harness run and are reported as such. Diagnosis (read-only, no model call): after the build the renderer drew 0 frames in four consecutive windows for both plans, and 1 frame then 0 after the Frame tool; so it does idle. The assertion measured too soon after a camera transition that is slow under software rendering. In the replay the transition took until the 6th 2-second window (`[4,4,4,4,3,0,0]` and `[3,1,0]` frames per window) and then the renderer stopped. No Meta error, no console error. Paid calls: 2 of 6; none replaced by a fixture.

**Decisions.** The harness kept every component and ticked the acknowledgement. Those are automatic decisions, not a human review; nothing was rejected. `humanReview` and `humanRecognition` in `RESULTS.json` are empty for a person to fill. In the replays the harness also mocks the paid *edit proposal* and *visual evaluation* routes: those two steps in the replays are not Meta evidence.

## Image 1: architectural floor plan (Portuguese, cm)

The plan returned: «Single-storey house floor plan massing - 880 unit width», 7 components, `unitless`, 3 observed / 9 inferred / 9 approximated property tags (geometry, position, material), no unknown tag. Components: base slab, outer walls (4 boxes), interior walls (5 boxes), verandas (2 slabs), WC fixtures, kitchen block, dining-table marker. Unknowns declared by the model: scale, wall heights and thicknesses, door/window openings, roof, fixture types, orientation assumed.

| Criterion | Assessment (assistant's, not a human's) |
|---|---|
| Visual recognition | Reads as a small single-storey house massing: slab, perimeter walls, partitions, two veranda slabs. A person would see «a floor plan extruded into walls», not a finished house: no roof, doors or windows. |
| Structural fidelity to the source | Partial. The overall footprint and the two L-shaped veranda strips follow the source (880 wide, 1200 deep, 200 and 280 strips). Partitions are a generic set of five walls; I cannot confirm from the screenshots that they reproduce the two bedrooms, WC, kitchen and living/dining split; the source's door swings, windows and the 90/228/325/250 dimensions are not modelled. The kitchen counter and the dining table are small markers. |
| Proportions and joins | Walls meet the slab and each other in the views captured; the veranda slabs sit beside the slab at a different level. No floating parts in these screenshots; the assembly check was not reported in the notice. |
| Geometry and materials | Flat cream walls with grey interior faces and a pale slab: clean but plain. «Observed» is attached to the geometry of outer/interior walls and verandas, meaning read from the drawing, but only as massing; the model's own unknowns say heights and openings are not in the source. |
| Cinematic presentation | The Director's entrance ran in both the live and the replay runs (I checked the screenshots and the run state, not frame-by-frame the video). Camera cue and lighting are the shared stage's. In the live view the whole house is in frame. |
| Exploration, edit, persistence | Pointer selection of 4 distinct components, isolate, frame, colour and move with preview and undo, generic exploded view (parts spread, floor kept), save, leave guard, reopen and delete all passed in the replay of this plan. |
| Observed / inferred / approximated | Observed: perimeter, partitions and verandas (from drawn lines and labels). Inferred: positions, WC and kitchen fixtures. Approximated: materials, wall heights, table. |
| Limits and visible inconsistencies | Plan view is a 2D drawing; heights, openings and roof are invented by absence (declared unknown). Review list shows only about one component at a time at 1440×900 (the card is crowded by the tally and unknowns). |

## Image 2: lungs illustration (WebP)

The plan returned: «Human Lungs and Trachea - Conceptual Model», 6 components, `unitless`, 8 observed / 10 inferred tags. Components: trachea (cylinder + ring), carina (two tubes), left and right lung (ellipsoids), left and right bronchial branches (3 tubes each). Unknowns: scale, posterior shape and depth, fine bronchiole detail.

| Criterion | Assessment |
|---|---|
| Visual recognition | Recognisable as lungs with a trachea: two large dark-red lobes, a pink windpipe, branching vessels. Clearly stylised. |
| Structural fidelity to the source | The source shows two lobes, a segmented trachea, a Y-shaped split and branching vessels on the front faces; all are present as simplified primitives. Lobe shapes are plain ellipsoids (the source lobes have a notched medial edge and different left/right sizes). Depth and back are invented. |
| Proportions and joins | The bronchial branches are separate tubes laid on the lobe surfaces and the carina tubes stop short of the trachea; in the exploded view the carina and branches read as detached. The main bronchi do not visibly enter the lobes. Tracheal ring is a torus floating at the trachea's base in the first view. |
| Geometry and materials | Smooth ellipsoids with a fibrous red material, pink tubes: attractive and consistent with the source palette. Not anatomically accurate. |
| Cinematic presentation | Entrance and lighting as above; the object is centred and fully in frame. |
| Exploration, edit, persistence | 3 distinct components selected by pointer (trachea, left lung, right lung), isolate, frame, colour, move with preview and undo, exploded view, save, reopen, delete: all passed in the replay. |
| Observed / inferred / approximated | Observed: lungs, trachea, segmentation, vessels on the front (read from the picture). Inferred: positions and materials. No «approximation» tag was used by the model, although depth and lobe shape are in practice approximated. |
| Limits and visible inconsistencies | The model's own evidence text calls the illustration a «photo». An illustration cannot give the hidden back or an accurate lobe shape; the result is an educational-style sketch, not anatomy, and it must not be presented as clinical. Note this is the universal Space path; the dedicated Anatomy atlas is a separate, labelled reference model. |

## Tests of the platform in the replays

| Check | Image 1 | Image 2 |
|---|---|---|
| Console errors | none | none |
| GPU geometries / textures after leaving | 4 / 7 (same as before) | 4 / 7 (same as before) |
| Renderer idle (frames per 2 s window until quiet) | 4,4,4,4,3,0,0 | 3,1,0 |
| Pointer-selectable components | outer-walls, interior-walls, verandas, base-slab | trachea, lung-left, lung-right |
| Reopened from My Spaces without error and not marked unsaved | yes | yes |

Evidence: screenshots in each `runs/*/`, videos in `video/` (`live-*-until-abort.webm` stop at the aborted assertion; `replay-*-full.webm` are the full replays, software-rendered so the motion is coarse).

## Provisional verdict (phase 1 only)

**Provisional GO for a scripted demo**, conditional on phase 2: both real image requests returned valid plans on the first attempt, built into recognisable scenes, and survived explore/edit/undo/save/reopen with no console errors and no GPU growth. Reasons for caution that the demo must say out loud: the results are stylised concepts with approximations, neither image yields faithful hidden geometry, the review screen is cramped on a 1440×900 desktop, and two live runs were cut short by a harness assertion rather than finishing end to end live. The final verdict waits for the text request.
