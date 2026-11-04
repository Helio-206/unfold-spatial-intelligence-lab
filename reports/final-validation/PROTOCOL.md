# Final validation protocol (written before the paid runs)

Frozen code: `027b95a7cd015473e8a4555cf2d57825472048ab`. Nothing under `src/` or `server/` changes after this point; only evidence and documentation are added.

## Paid-call budget

Hard cap enforced by the backend's budget file: **6 Meta calls** for the whole validation. Planned use: 1 plan from text, 1 edit proposal, 1 visual evaluation, 1 plan from an image = 4. The other 2 are a reserve for a transient upstream failure (same scenario, same input) and are reported if used. No run is repeated to pick a better answer. Cost is reported from the model's own usage figures (estimated, not a bill).

## Scenarios

1. **Excavator (Foundry)**: existing premium example, no model call. Regression E2E (`unified-living`, `unified-lifecycle`) and a same-stage visual comparison.
2. **Unexpected object by text**: drawn after the freeze with `shuf` from five candidates (a vintage rotary telephone; a small sailing boat with a mast and sails; a pair of binoculars; a hand-cranked coffee grinder; a street lamp with a curved arm). Drawn: **a street lamp with a curved arm**. One request, no prompt tuning. Includes one Meta edit proposal and one verified visual evaluation on the resulting Space.
3. **Image**: the CC BY-SA 3.0 "Diagram of the human heart" (Wapcaplet / Yaddah, Wikimedia Commons), the only image on this machine with a licence that permits sending it to a provider. It is an illustration, not a photograph. One request.
4. **Anatomy**: the educational atlas as a Space (no model call). The Meta image-to-atlas review from #21 is not wired into the workspace, so it is not part of this validation.

## What is recorded for each live run

Request (text or image hash), model and request id, the stored raw response hash, the normalised plan, the review state, screenshots, geometric problems the assembly check reports, the assistant's own recognition judgement (labelled as such) and a `humanRecognition` field left empty for a person to fill, and limitations. Content-quality checks are recorded, not asserted.
