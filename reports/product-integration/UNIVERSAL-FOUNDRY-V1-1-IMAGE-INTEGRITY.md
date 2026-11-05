# Universal Foundry V1.1 — image integrity and geometry

**Status: incomplete; NO-GO for guarded integration.** The original cross-Space image contamination was reproduced and corrected, and targeted geometry changes were made. The mini-excavator connection remains visually unverified, wheel arch trim still appears offset in one view, and no photographic shape fitting has been implemented. Under the requested ordering, image fitting was not started while the known geometry defects remain open. This is not a demonstration of photograph-controlled geometry.

Base `audit/universal-foundry-provider-v1@0ed13d18a43eba58938cde7d35655229d0a25338`; branch `feat/universal-foundry-v1-1-image-integrity`. Experimental Foundry remains behind its existing flag. No paid APIs, merge, Wonder worktree change, or authoritative plan mutation is part of this work.

## Image provenance and lifecycle

Before the fix, two new regression tests failed: evidence from B survived `dispose()` when returning to A, and a different plan sharing a source hash inherited A's parameter override. Evidence is now accepted only after source image bytes and prepared bytes are hashed, the prepared SHA matches the returned image-plan source, and the SHA-256 plan fingerprint is computed. Evidence records the original/prepared SHA, preparation mode, plan identity, recipe version and generation; the provider independently verifies the fingerprint and refuses mismatches. Generation and abort guards reject delayed file reads, image decoding and fingerprint results. Exact canonical plan identity is also used for parameter overrides so two different plans with the same source do not share them. This invalidates existing experimental V1 parameter keys rather than guessing which plan they belonged to.

Image bytes and evidence are **not persisted**. Reopening a saved image Space deliberately clears them, shows the evidence-unavailable limitation in the experimental recipe and uses a plan-based conceptual fallback. It does not restore the original colour. The browser A→B→A test uploads two licensed photos and binds a hand-authored plan to their input hashes solely to exercise the lifecycle; it is not image inference. See `uvf-v1-1/image-lifecycle/result.json` and its captures. A separate browser test delays an image decode, cancels the request and releases the decode; it also races slow and fast uploads. Both pass. Unit tests cover A→B→A, same-source different-plan overrides, plan/fingerprint mismatch, cancellation and disposal. No persistent source or bounded evidence store was implemented.

## Geometry

- Open-end spanner: closed hexagonal hole replaced by an open profile, with the opening directed away from the handle; ring-spanner remains a distinct closed archetype. Steel is the default grip instead of unsupported red rubber. Raycast tests verify an open mouth and material on both jaws, and a separate ring head. Compare `uvf-independent/wrench-foundry-front.png` with `uvf-v1-1/geometry/wrench-foundry-front.png`.
- Vehicle: solid dark cylinders were replaced with thin semicircular trim. Wheels remain visible and IDs and plans remain unchanged. Compare `uvf-independent/hatchback-foundry-threeQuarter.png` and `uvf-v1-1/geometry/hatchback-foundry-threeQuarter.png`. The trim appears displaced in a view and the body has no actual wheel cutout; this is **not accepted as a finished wheel-arch solution**.
- Excavator: the hydraulic cylinder uses its longest local axis instead of the short horizontal dimension, so the barrel and rod are visible. A candidate inferred bridge produced a visibly floating artefact and was removed. Current fixture AABB separation remains 0.016 plan units between cylinder and boom, and 0 for cylinder and house; box overlap does not prove a joint. The endpoint appears near the cab in the capture. No inferred hinge coordinates were claimed. Compare `uvf-independent/miniExcavator-foundry-side.png` and `uvf-v1-1/geometry/miniExcavator-foundry-side.png`. The mechanical chain remains unresolved.

The three above use the real `/living?debug-living&experimental-foundry` renderer with offline, hand-authored plans and mocked 503 responses for other APIs. The same view policy is used as the V1 audit. V2 is used by the product router for those fixture components; the screenshots are not a V3-generated comparison. Existing tests exercise the eight family classifiers and generation, but all eight families have not been recaptured in the browser after the changes.

## Remaining work and safety

1. Correct and visually validate actual wheel-arch alignment/cutouts and the excavator's attachments. Use relationships and verified evidence when available; label any approximation inferred. Do not promote the AABB measurement to mechanical proof.
2. Only then implement the bounded image-conditioned fitting. The present foreground extractor returned 90% foreground on the car photograph in the A/B/A run; the result is not a reliable object mask. Obtain and verify registered masks and explicit camera hypotheses before drawing conclusions. The requested two-real-photo shape change, colour-only negative control, Worker, cancellation and stale-fit rejection are **not implemented or verified**.
3. Investigate the Chromium closures with a trace or browser crash logs; one further attempt in the visual harness ended with `Target page, context or browser has been closed`. One isolated mini-excavator capture subsequently succeeded. The cause is unknown. No physical-GPU, iOS, VRAM or long-duration memory result is available.
4. Review image-bound data retention and confirm whether future storage should preserve the original, prepared image, or derived evidence. Current reopening is safe fallback, not restoration.

No universal photographic fidelity, image-conditioned geometry, engineering dimensions or mechanical validation is claimed.

## Verification

- Full suite `npx vitest run --maxWorkers=2`: 163 files and 2,553 tests passed.
- `npm run build`: passed, with the existing landing contact-email and bundle-size warnings.
- Focused image lifecycle: A→B→A and delayed decode/upload race exercised in Chromium with local fixtures; geometry capture: wrench, hatchback and mini-excavator in `/living`.
- No paid inference or merge. No GPU-physical or iOS result.
- Four post-change mini-excavator close/reopen cycles: 27 geometries and 14 materials observed per cycle emitted `dispose` events; renderer geometry counts changed 31 → 4 → 31, textures 13 → 7 → 13. Chromium's reported heap varied from roughly 71 MB to 153 MB, with no forced GC. These counters are not a proof of no leaks or a measurement of GPU memory. Raw output: `uvf-v1-1/resource-lifecycle.json`.
