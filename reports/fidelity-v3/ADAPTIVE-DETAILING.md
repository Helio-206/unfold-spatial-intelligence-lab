# Adaptive detailing — proposal (not implemented)

Problem: V3 smooths what the plan already has. The step that would make an object look *more like itself* is adding geometry the plan lacks (ribs, grooves, rims, openings), and that is exactly what must not be invented silently.

## Proposal

1. **Detail is a reviewed component, never a rendering side effect.** A second, optional Meta pass receives the approved plan plus the source image and may return `detail` components attached to an existing component (`parentId`), each with ordinary V2 primitives, `provenance.geometry = 'design_approximation'` and evidence text. They enter the plan as an operation (`add-component`) that goes through preview → authorisation → commit, so the human review, source hash and undo already work.
2. **Grounded by structure, not by taste.** The pass is asked only for features it can point at in the image or in the plan's own `unknowns` (e.g. "three bronchial branches missing on the left lobe"). A feature without a stated reference is rejected by the validator.
3. **Bounded.** Max detail components per parent, max triangles per detail (existing router limits), no detail outside the parent's bounding box plus a margin, no change to existing components.
4. **Router stays the same.** Detail components are ordinary components, so V2/continuous routing, caching, workers and disposal apply unchanged. Fillets between a detail and its parent come for free.
5. **Metric to accept it:** blind comparison against the source image on structure (which named features are present) and the existing silhouette/junction metrics; a detail that lowers recognisability or raises placeholder-like shapes is not offered.

## Preconditions before building it

- A real Meta run with explicit authorisation per image and an approved budget (none was used here; CLAUDE.md forbids paid calls in tests, so tests use a counting mock).
- A guard against placeholder-like plans (section 5 of `STABILISATION.md`): adding detail on top of generic cubes would polish the wrong thing.
