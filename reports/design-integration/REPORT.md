# UNFOLD design-system integration — implementation report

- **Branch:** `feat/product-design-system-integration` (not merged, not pushed to `main`)
- **Base commit:** `62fe7eb` (`origin/phase-10-grounded-spatial-intelligence`, Phase 10.1). `main` (`a0bc172`) is 2 commits behind and lacks Phase 10.
- **Design source:** `6ed8421` (`feat/landing-design-system`). Merge base of all three branches is `a0bc172`; the design commit only adds new paths, so it was brought over with `git checkout 6ed8421 -- design-system landing` (no conflicts, no history rewrite).
- **Code commits:** `0a71510` (design system + landing), `fedfc00` (lab UI migration). The final SHA is the tip of the branch (this report and screenshots are in a third commit).

## Migration strategy
1. Phase-10 baseline + design assets. `landing/assets` and `landing/fonts` were byte-identical copies of `design-system/*` and were removed; the landing references `../design-system/`.
2. Single brand source: `src/brand.css` imports `design-system/{fonts,tokens,components}.css` once (loaded from `main.ts`).
3. Product CSS now consumes tokens directly. Void (`data-theme="dark"`) is the viewport/page; Paper panels carry `data-theme="light"`.
4. Screens: `/demo` (demo.css/ts), embedded + `/spatial-editor` (spatial-editor.css rewritten), `/workspace` (style.css, token migration only).

## CSS compatibility decisions
- Only `style.css` defined global `--ink/--line/--muted/--amber/…` (light-on-dark meaning). They were deleted and their consumers mapped to brand tokens (`--ink`, `--ink-muted`, `--line`, `--fold(-ink)`, `--surface*`). `demo.css` `--demo-*` and the scoped `.spatial-lab` overrides were removed the same way. No alias layer remains, so there is one definition of each name.
- `design-system/tokens.css`: one additive change, `:root, [data-theme="light"]` so Paper can be re-asserted inside a Void container. Values unchanged.
- Three.js: materials untouched. Only the renderer clear colour and the selection outline now read `--surface`/`--fold`. The mechanism legend dots keep their original hex values on purpose (they mirror 3D materials; commented in `demo.css`).
- No new `!important`. Brand rules removed: drop shadows, backdrop blur, glows, the looping border-beam animation, pill radii, wide-tracked caps.
- Evidence overlay on the drawing moved from hard-coded hex SVG attributes to classes (`.ov-*`) driven by tokens. Geometry attributes unchanged.

## Reconstruction states (`src/reconstruction-state.ts`, 4 unit tests)
Relabels existing provenance only, never promotes: `rejected`→Rejected; `verified|corrected`→Validated; `ambiguous`→Provisional; unreviewed from `technical_document|user`→Observed; unreviewed `derived|solver|system`→Inferred. Chips use icon + text + shape. Inspector shows the raw source/validation/evidence next to the chip; the component list shows counts and the note "N of M components without validation. Not dimensional certification."

## Verification executed
- Baseline (before changes): 42 files / 238 tests pass; `npm run build` OK.
- After: 43 files / **242 tests pass**; `tsc --noEmit` + `vite build` OK; `dist/landing/index.html` emitted.
- Playwright (Chromium, software GL), dev server and `vite preview` of the production build:
  landing desktop/mobile, `/` → `/landing/` redirect, "Open the lab" → `/demo`, logo → `/landing/`, deep links `/demo` and `/spatial-editor`, empty lab, mechanism example, composer typing, synthetic plan: import → detect → calibrate → build → inspector, at 1440×900, 768×1024, 390×844. Console errors: none; failed requests: none; horizontal overflow: none; fonts loaded (Geist 400/500/600, Geist Mono 400/500); focus ring visible (2px `#C93A08`); `prefers-reduced-motion` lands the cube at its end state (range 100); touch-target scan: all visible controls ≥44 px (drag handle has an enlarged hit area).
- Screenshots: `reports/design-integration/screens/` (landing, empty lab, plan loaded, tracing, workbench, inspector, composer, mechanism).

## Not executed / remaining
- Voice input, hand tracking, live Meta/AI calls (no paid services, no mic/camera). Existing CDP e2e scripts (`tests/e2e`) were not re-run; they need a live backend. Keyboard check was a Tab/focus probe on the landing and focus-visible styling, not a full screen-reader pass.
- The plan used for the workbench shots is synthetic (no real plan image in the repo).
- `/phase-4a` proof page (own `--proof-*` palette) was not restyled; its 500 in dev is the absent API backend.
- `/workspace` is only token-migrated (hero text contrast over the 3D scene is weak); the in-lab UI strings stay Portuguese while the landing is English; some JS-emitted state codes remain uppercase because e2e scripts match them.
- On mobile the example four-bar mechanism is cropped at the right edge (camera framing, not touched).
- **Config required:** `VITE_UNFOLD_CONTACT_EMAIL` (see `.env.example`). Unset → "Request access" renders disabled with a visible note and the build prints a warning. No address was invented.
- Engineering observation, not fixed: `data-state` for the editor is set on the host `#app`, not `.spatial-lab`.

## Recommended merge procedure
Review the branch (3 commits) against `phase-10-grounded-spatial-intelligence`, set `VITE_UNFOLD_CONTACT_EMAIL` in the deploy environment, ensure the host serves `/landing/` and falls back to `index.html` for other paths, then merge into the Phase 10 line (fast-forward or merge commit) before `main`.
