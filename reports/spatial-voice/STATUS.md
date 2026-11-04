# Spatial voice — incomplete foundation

Base snapshot: PR #28 `fb1f892cdf773a51f61a3f5c745efb2f11fca5d3`. The branch is independent of the Cloud branch.

This is not an integrated feature. The local context and explanation snapshot a validated V2 plan and bind the selected ID to the explanation and evidence. The deterministic text reports only plan contents and explicitly says the component's function is not established. The microscope and lungs test plans are hand-authored reproductions, not Meta responses or anatomical validation. A replaceable TTS port and browser adapter exist; the controller rejects objects not produced by the local explanation function and ignores old completion callbacks.

Not done: workspace integration, automatic invalidation on Space/selection/revision changes, voice preferences, transcript, general Space UI, Meta contextual explanation, semantic grounding of functions, real audio playback, screenshots, browser/mobile/Safari/iOS and keyboard accessibility checks. The speech port tests are simulations. The browser adapter and recognition interaction are not verified in a real browser. Current cancellation relies on the future host invoking it; this is not sufficient for release. No Meta calls were made. The code is not ready to merge.
