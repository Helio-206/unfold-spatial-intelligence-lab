# Cab and hood refinement: before / after

Branch `feat/living-premium-visual`. Same fixed cameras, **presentation profile, studio tier, Chrome + SwiftShader (software; no GPU measurements)**. "Before" = the premium look on the original geometry, "after" = the same plus the refinement, both under the current studio set, so the sheet isolates the geometry. [`before-after-sheet.png`](before-after-sheet.png) · files `*-before.png` / `*-after.png` · numbers in `evidence-before.json` / `evidence-after.json`.

Views: `hero` (cab side, low three-quarter), `cab-close`, `hood` (rear three-quarter), `hero-articulated` (engine frame at the end of the scenario: boom raised, upper structure swung).

## What was added (visual only, all in `excavator/upper-detail.ts`, called from `upper.ts`)

Cab: window frames with real thickness (raised border) on both sides; the door outlined by panel seams with hinge barrels, latch plate, sill step and a grab handle; a roof structure (three ridges, front visor, rear vent box with slots) with four work lights and lenses; headlamps with housing, lens and bracket at the cab corners; a simplified interior that reads through the glass (seat with back and headrest, armrests, monitor with a glare plate); a belt seam and roof lip.
Hood and counterweight: access-panel seams, hinges, handles, latches and a bolt row on both sides; louvred ventilation grilles with depth (dark recess, protruding frame, inclined fins) on both sides; a radiator bay on the cab side (frame, dark core with fine fins, fan ring, hub and blades behind a bar grille); a recessed bay and lifting handles on top; a dark seam filling the gap between the two counterweight blocks, rear bolt covers, a tow plate and a rear camera.

All of it is added to the same `PartBuilder` as the rest of `upper_body`, in the part's own frame, so it moves with the canonical part and is picked as `upper_body`. No material key was added.

## Measured cost (software rasteriser; relative only)

| | before | after | change |
|---|---|---|---|
| model triangles | 253 744 | 271 492 | +17 748 (+7.0 %) |
| model meshes | 64 | 65 (+ `upper_body:chrome`) | +1 |
| materials / textures | 12 / 13 | 12 / 13 | none |
| frame draw calls, hero / hood | 365 / 358 | 371 / 433 | +6 / +75 (hood: the mirrored copy and shadow pass see the new louvres from a closer view) |
| frame triangles (all passes, mirror and shadows included), hero | 1.49 M | 1.59 M | +7 % |
| GPU geometries uploaded | 68 | 69 | +1 |

No GPU timing is claimed. Detail first used 2-segment rounded boxes (+38 k triangles); small details now use one segment.

## Guarantees (tests)

`tests/living/visual-foundry/upper-detail.test.ts` (7): 13 canonical ids unchanged; every mesh belongs to a canonical part or is a display-only hose; detail meshes carry `partId: upper_body`; a pose applied to `upper_body` moves all detail rigidly; a ray at a window frame and at a louvre hits `upper_body`; triangle growth bounded (+10 % cap, 300 k budget, 90 meshes); envelope near the original; deterministic build. Existing Foundry, materials, dispose, picking and Digital Hand suites pass unchanged. Pose error in every captured view: 0 for engine frames (2e-15 m rounding for none).

## Honest limits and what is left for after the submission

- At hero distance the gain is modest: the new detail is in the cab, hood and counterweight; boom, stick and bucket are unchanged. The close-ups show the difference.
- The interior is simplified and almost black behind the dark glass; seat and controls only read at close range.
- Louvres, fins and the radiator bay are layered on the existing hood faces (no real cut-outs), so they read through shading, not silhouette.
- Not done (would need rebuilding parts of the Foundry): real recessed door and window openings, a cab with lit interior, boom and stick weld seams and cast bosses, rod guards and hose clamps along the boom, bucket wear plates and tooth adapters.
- The presentation studio set was mirrored to the cab (-Z) side so that the cab, door and radiator face the key; the +Z side (handrail, fuel cap) is now seen against the rim light.
- The Design SPEC (PR #16) says fold orange is never used on the machine paint; this branch keeps small orange accents on functional details (handrail, door grab handle, counterweight stripe, linkage) as decided earlier. To drop them, remove `ACCENT_ZONES` entries.
