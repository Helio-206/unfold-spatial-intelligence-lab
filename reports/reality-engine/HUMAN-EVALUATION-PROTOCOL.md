# Independent human evaluation — external acceptance dependency

**This cannot be performed or simulated by the system or its authors.** Nothing in the reports counts as a human evaluation. The simulated "assisted" figures (`components-product*.json`, `assisted-N`) use the reference to play a user and are labelled oracle-simulated.

## Who counts as independent
A person who did not build, tune or read the code of this phase, has not seen the held-out scans, and is not told which result came from which method (blinded labels A/B/C). At least three evaluators per scan; disagreements are reported, not averaged away.

## What they are given (generated from a frozen configuration commit)
1. The capture photographs only (no outlines, no reconstruction).
2. For each method (automatic only / the person's own corrected flow / baseline) the reconstruction rendered from three poses NOT used to build it, next to the real photograph from the nearest pose if one exists.
3. The part structure, coloured, with the list of parts.

## What they answer (scored 1–5 with free text; the sheet is fixed before the evaluation)
- Does the shape match the object? Which regions are wrong (mark them)?
- Are the parts physical parts of the object? Which are merged, split or invented?
- Would you trust this to take a measurement or design a fitting? What is missing?
- (For assisted flow) Could you correct the structure and outlines with the tools offered? How long did it take?

## Rules
- Results are published in full, including the bad ones, with the evaluators' own words.
- A positive evaluation never changes the fidelity class by itself: geometric fidelity needs a 3D reference independent of the capture (see `axes.geometricFidelity`).
- Acceptance scans of the external datasets (`scripts/datasets/splits.json`) are evaluated once per frozen configuration.
