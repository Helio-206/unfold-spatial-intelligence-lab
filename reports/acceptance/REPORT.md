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

## Phase 3: text request, compound optical microscope (completed live, end to end)

Prompt in `PROTOCOL.md`, sent once, not edited after seeing the result. Request `d14a0904-1d6b-478b-a655-5bf9ab1d9975`, muse-spark-1.3, 52.0 s, 1 032 in / 7 472 out tokens (3 465 reasoning), estimated cost US$ 0.033 (reported by the server; not a bill). The run finished all steps live: review, build, orbit, selection, edit preview, edit, colour, isolate, frame, exploded view, evidence, leave guard, save, My Spaces, reopen, delete. The renderer settled (`[0, 0]` frames per 2 s window after waiting for transitions), console clean, geometries and textures back to 4 / 7, 4 distinct components selected by pointer, no quality check failed. 10 components built, **none rejected**; the review decisions were automatic (keep all, acknowledge) and the human visual assessment is pending.

The plan: base, support column, arm, stage (3 shapes), ocular tube, eyepiece, revolver disc, objectives (one cylinder repeated radially 3 times), focus (axle + knob repeated twice), illuminator (2 shapes). All geometry tagged «approximation», position «approximation», material «inferred»; nothing «observed» (there is no source to observe). Unknowns declared: scale, optical internals and fine/coarse focus mechanics, simplified stage aperture and condenser.

| Criterion | Assessment (assistant's, not a human's) |
|---|---|
| Visual recognition | Clearly a compound microscope: heavy base, upright arm, stage with a slide, long tube with an eyepiece, a revolver with blue objectives, two focus knobs, a pale illuminator under the stage. |
| Structural fidelity to the request | All requested parts are present, including three objectives (radial repeat) and focus knobs. Not faithful as an instrument: the tube is vertical (real ones are usually inclined), the arm is a block plus column rather than a curved arm, the revolver is a plain disc, and the focus knobs read clearly only from the left. From one angle the third objective is hidden behind the other two. |
| Proportions and joins | Coherent: the tube, revolver and stage line up over the illuminator; no floating parts and no assembly warning shown. The arm and tube meet by contact between boxes and cylinders, with no visible fillet or fixing. |
| Geometry and materials | Plain primitives with brushed-metal, black and blue finishes; the finish and shadows come from the shared stage. Pleasant, but far from the detail of the hydraulic machine. |
| Cinematic presentation | The Director's entrance ran (live video, checked by the run's state and screenshots rather than frame by frame); the object is centred and fully framed. |
| Exploration, edit, persistence | All passed live; the exploded view separates tube, arm, stage, base and illuminator, and keeps everything above the floor. |
| Limits | Hidden and internal parts, scale and optics are not modelled; it is a conceptual sketch, not a technical drawing. |

## The three scenarios together

| | Floor plan (image) | Lungs (image) | Microscope (text) |
|---|---|---|---|
| Real Meta call | yes, 48.5 s, ≈ US$ 0.031 | yes, 49.1 s, ≈ US$ 0.031 | yes, 52.0 s, US$ 0.033 |
| Live run | aborted by a harness assertion (diagnosed, not a leak) | same | **completed end to end** |
| Rest of the path | replay of its own plan | replay of its own plan | live |
| Console / GPU | clean / stable | clean / stable | clean / stable |
| Recognisable | a house massing | lungs with trachea | a compound microscope |
| Faithful to the source | partial | partial, stylised | all parts present, simplified |
| Decisions | automatic, none rejected | automatic, none rejected | automatic, none rejected |

Total for the three generations: about US$ 0.095 (two derived, one reported), 3 of 6 calls used, no reserve used, no failure replaced by a fixture. Evidence: `runs/`, `video/`, `RESULTS.json`, `PROTOCOL.md`.

## Final verdicts

- **GO operacional: GO**, for local and controlled use. Three independent real generations returned valid plans on the first attempt. The whole path (review, build, explore, select, explode, edit, undo, save, reopen, change Space) works with a clean console and no GPU growth, and the one live run that was not cut short finished every step. Conditions: a single local backend with the key only in its process, in-memory sessions, and the call budget enforced by the server.
- **GO para demonstração: GO**, with a scripted path and spoken caveats: every result is an AI concept with declared approximations, the review screen is cramped at 1440×900, the two image runs were completed by replay of their own plans, and the human visual assessment is pending. Best opening: the Foundry excavator, then the microscope, then an image.
- **NO-GO para fidelidade geométrica.** Nothing here is a faithful reconstruction: hidden zones are invented, details such as doors and windows, lobe shapes, an inclined tube or a curved arm are missing, and the detail is far below the hand-built Foundry machine. It must not be presented as measurement, anatomy or technical drawing. Production readiness was already NO-GO (authentication, durable state, device testing).
