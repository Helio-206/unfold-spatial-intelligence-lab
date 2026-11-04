# Spatial Presentation Director — integration contract

Module: `src/living/spatial-presentation/`. Types: `types.ts` (stable). Entry: `index.ts`. Reference host: `tests/harness/presentation/` (test only).
The contract was published before the implementation (first commit of PR #26). **Names and shapes below have not changed since.**

```ts
import { createPresentationDirector, cueToViewSpec } from '../spatial-presentation';
const director = createPresentationDirector({ plan, root, requestRender, onCue, onState, view });
```

## Who owns what

| | Workspace / Terminal | Director |
|---|---|---|
| renderer, scene, lights, loop, canvas | yes | never created, never touched |
| camera, `CameraDirector`, `CameraArbiter` | yes | **never moves it**; emits `CameraCue`s |
| plan (`SpatialPlanV2`), review, edits, undo, solver | yes | read-only; never written |
| selection, inspector, rail, notices | yes | never touched (focus is a separate, visual-only state) |
| compiled objects (`root`) | owns and disposes them | animates presentation state on them and restores it |
| presentation-only state (entrance offsets, exploded offsets, dim, PBR finish) | – | yes, listed in `state.active`, always reversible |

## Wiring (what the Terminal does)

1. After the layer compiles a plan: `createPresentationDirector({ plan: layer.currentPlan, root: layer.root, requestRender: () => workspace.redraw(), onCue, onState, view })`. `view` is the **usable area** (viewport minus rail, composer, open panels): pass the workspace's real insets and call `setViewContext` whenever they change. With wrong insets the final framing is cropped (observed in the reference host before it read them).
2. Call `director.update(dtMs)` from the workspace frame loop. It returns `true` while another frame is needed and does **nothing, calls nothing and publishes nothing** when idle, so the workspace can keep rendering on demand. There are no timers inside the Director.
3. `onCue(cue)`: ask the arbiter, then move. If the arbiter denies (a person is orbiting) **do nothing**: the object keeps animating and the person keeps the camera. Under reduced motion `cue.durationMs === 0`: jump.
4. Entrance: `director.playEntrance()` replaces `layer.reveal(...)` (do not call both: both toggle visibility). The handle's `cancel()` is safe at any time; `done` always resolves (`'completed' | 'cancelled'`).
5. Selection: untouched. `director.focus(id)` is a presentation spotlight (dims the rest, emits a focus cue); `focus(null)` clears.
6. Exploded view: `toggleExploded()` / `setExploded(0..1)`. While `state.notice !== null` the host **must** show it.
7. Editing: before the inspector applies an edit, the solver or an undo, call `director.enterEditing()` (restores planned transforms and colours exactly). After the layer rebuilds, call `director.rebind({ plan, root })`, then `resumeExploring()`.
8. Teardown: `director.dispose()`. Idempotent. After it no callback, listener, texture or render request remains.

`cueToViewSpec(cue)` converts a cue into the workspace's `ViewSpec` (`Vector3`, radians). The cue's azimuth is already in the workspace director's convention (the mirror of the Cinema's), identical to `SpatialWorkspace.setView`.

## API needs from the workspace (Terminal-owned files; not changed here)

The reference host works around each of these. Please add them to `SpatialWorkspace` (or tell me a different shape):

1. `moveCamera(view: CueView, by: 'assistant')` → `{ moved: boolean; reason?: string }`, a public wrapper of the private `CameraDirector.moveTo`, so cues go through the `CameraArbiter` and animate with the workspace's own tweens (the host animates with `setView` frame by frame, which bypasses the arbiter).
2. `viewContext(): ViewContext` plus a change notification (the insets are private today; the host reads `currentInsets` through a cast).
3. A frame callback: `onFrame((dtMs) => boolean)`, run from the workspace's `onBeforeRender`, so the Director rides the workspace loop instead of an `rAF` of its own. Returning `true` keeps rendering.
4. Optional: `PlanSpaceLayer` could expose `compiledRoot` so the Director gets exactly the compiled group (today `layer.root` works, it contains the presentation wrapper).

## Guarantees (all tested; `tests/spatial-presentation-*.test.ts`, 48 tests, plus browser evidence)

- Never mutates the plan (deep-equal before/after every operation).
- `cancel()`, `enterEditing()` and `dispose()` restore position, scale, visibility, colour and reflection of every object touched, **bit for bit**.
- Reduced motion (option or live `prefers-reduced-motion`): sequences complete instantly, cues have `durationMs: 0`, a tour lands on its first point and waits for the person.
- No GPU leak: it creates no geometry, renderer or render target; textures it creates are disposed with it (browser: Foundry texture count back to its level without the Director, geometry count unchanged).
- Deterministic: same plan and same `dtMs` sequence give the same states and cues.
- Idempotent `dispose`; `update` after dispose returns `false` and requests nothing.
- Exploded view never sinks a part through the floor the assembly stood on (the whole arrangement is lifted by the needed amount, linear in the amount).

## What the Director does not claim

- Motion follows **plan structure only** (hierarchy, declared relations, bounding-box contact, sizes). No joints, kinematics or physics are inferred.
- Assembly order is a presentation order, not an assembly procedure; each step carries a structural reason (`director.sequence[i].reason`).
- The exploded view is a **visualisation**: offsets are generic (away from the parent), reversible and announced by `state.notice`.
- PBR finishes show a declared material profile; they say nothing about the real material.

## Other additions in this PR that the Terminal can use

- `assembly-analysis`: new `buried` finding (a part no outside direction can see, by ray casts on the compiled triangles with real face culling) and `revealBuriedComponents(plan)` (typed `set-transform` operations, never moves observed or confirmed positions). Not called by the Director; wire it next to `closeGaps` in the inspector if wanted.
- Compiler: `box` edges are softened (7% of the thinnest side, outer dimensions unchanged, `mesh.userData.spatialEdgeSoftening`); `loft` shapes have UVs.
- `applyPresentationFinish(root)` is exported for hosts that want the finish without the Director.

## Defaults

`entranceMs 5200` (stagger 70–520 ms per part), `explodeMs 900`, `explodeSpread 0.45`, `dim 0.32`, `maxPois 8`, tour dwell 2800 ms, focus fade 240 ms.
