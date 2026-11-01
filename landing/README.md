# Unfold — landing page

Source page from the designer, integrated into the application build as a second Vite entry
(`vite.config.ts` → `build.rollupOptions.input.landing`). Served at `/landing/` in both `npm run dev`
and the production build; `/` redirects there.

- Built on `../design-system/`. Fonts and logos are referenced from there (single source; the former
  `landing/assets` and `landing/fonts` copies were removed).
- `index.html` holds markup, styles and a small script for the folding cube and the before/after slider.
  Both respect `prefers-reduced-motion`.
- "Open the lab" links to `/demo` (the spatial laboratory).
- **Configuration required:** set `VITE_UNFOLD_CONTACT_EMAIL` at build time (see `/.env.example`) to enable
  "Request access". Until then the action renders as unavailable with an explicit note. No address is invented.
