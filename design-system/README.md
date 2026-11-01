# Unfold design system

The visual language of Unfold, a spatial intelligence lab that turns flat input (photos, video, floor plans, PDFs, sketches) into measured space: depth, dimensions, placed objects and the relations between them.

This folder is written for people **and coding agents** (Claude Code, Cursor, Copilot and others) who build Unfold's product UI. Read this file first, then use the files it names. Never hard-code a colour, font or radius that has a token here.

**The idea in one line:** from flat to space. Everything comes from a cube net — six flat faces that, folded, become volume.

## Files

| File | Use it for |
|---|---|
| `tokens.json` | Source of truth: colours (light + dark), type scale, spacing, radii, each with a usage note. |
| `tokens.css` | The same tokens as CSS variables. Light (Paper) is the default; add `data-theme="dark"` for Void. |
| `fonts.css` + `fonts/` | Self-hosted Geist and Geist Mono (SIL OFL). Import before `tokens.css`. |
| `components.css` | Framework-agnostic base classes, prefixed `u-` (buttons, inputs, tiles, chips, ruler, readout). |
| `tailwind.preset.js` | Tailwind preset mapped to the same variables. |
| `logos/` | Logo files. Copy them; never redraw or retype the wordmark. |
| `COMPONENTS.md` | Markup patterns for each component, plus the rules for product screens. |

Minimal setup (plain HTML):

```html
<link rel="stylesheet" href="/design-system/fonts.css">
<link rel="stylesheet" href="/design-system/tokens.css">
<link rel="stylesheet" href="/design-system/components.css">
<body class="u-root">…</body>
```

## Colour

Light-first. The product and the landing live on **Paper** (`surface` #F3F0E8) with **Ink** text (`ink` #0B0D10). Dark (Void) exists for 3D viewports, capture screens and an optional user theme.

- `fold` #FF5A1F is the brand colour, identical in both themes: primary buttons, the lifting face of the logo, one emphasis tile per screen. Text on it is always `on-fold` (Void), never white.
- Orange **as text or icon** on Paper is `fold-ink` #C93A08. `fold` as text on Paper fails contrast.
- `laser` and `depth` are **data colours**, not decoration. With `fold` they form the axis trio: X = `axis-x` (fold), Y = `laser`, Z = `depth`. Use them for axes, depth maps, point clouds, detected objects — never for buttons, backgrounds or illustration fills that carry no data.
- `line` is for hairlines and grids only. Control borders use `ink-muted`.
- Typical screen: ~80% surface, ~12% ink and lines, ~6% fold, ~2% laser/depth.
- Avoid: blue–purple "AI" gradients, glows, drop shadows, more than one data colour on a single element.

All text pairs meet WCAG AA (4.5:1) in both themes. Keep it that way: if you need a new shade, check it first.

## Typography

**Geist for everything you read; Geist Mono for everything you measure.**

- Titles: `display-xl` (landing hero only), `display` (page and section titles) — SemiBold, tight negative tracking, short sentences ending with a full stop.
- UI: `title` 22/28 for panels and dialogs, `body` 16/24, `small` 14/20, `lead` 20/30 for one intro sentence.
- Mono: `label` 12/16 for lowercase labels and section indexes (`01 · how it works`), `data` 13/20 for values. Every number has a unit, and a margin of error when one exists: `2.41 m ±3 cm`, `38°`, `0.94`. Use tabular figures.
- Sentence case everywhere. No all-caps headings.

## Shapes

1. **The cube net.** Tiles (`radius-lg` 12px) placed 8px apart (`space-2`, the "joint"), never separated by borders. Group related tiles as a net: a row with one tile above and one below. One tile per group may be `slab` (ink) and at most one `fold`.
2. **The lifting face.** The logo's sixth face — a trapezoid narrowing upward — may sit 8px above one key tile to mark the primary moment of a screen (e.g. the export step, the final CTA). Once per screen at most.
3. **The ruler.** Section dividers are a measuring ruler (`.u-ruler`) with a mono label row above: section index on the left, a unit or context on the right. Use it instead of coloured bands or heavy rules.
4. **Coordinates and chips.** Objects in a scene are tagged with mono chips in their axis colour. Uncertain results use the dashed `uncertain` chip and say so: `lamp? · review`.

No illustrations of brains, robots, holograms or sparkles. Shapes, measurements and real output only.

## Motion

Motion explains folding: things hinge on an edge and move 0 → 90°. Ease in-out, 300–600 ms in UI (the landing hero runs ~2.4 s once). Nothing loops. Respect `prefers-reduced-motion` — jump to the end state.

## Voice

Precise, curious, shows the work. Speak like a researcher explaining what she measured.

- Yes: "14 objects detected. The table is 1.2 m from the window (±4 cm)." / "Send a photo. Get space back."
- No: "Revolutionary!", "magical AI that understands everything", exclamation marks, emoji.
- Admitting uncertainty is part of the brand. Show confidence values and flag what needs review.
- Model credit, when needed: "Powered by Muse Spark (Meta)" in `small` / `ink-muted`. Never the Meta logo, never larger than ours.

## Logo

The mark is a U made of five modules with a sixth face lifting off the base — the moment flat becomes volume. The lifting face is always orange.

- `unfold-lockup-on-light.svg` — default, on Paper.
- `unfold-lockup-on-dark.svg` — on Void and dark viewports.
- `unfold-mark-on-light.svg` / `unfold-mark-on-dark.svg` — avatar, favicon, app icon.
- `unfold-mark-mono.svg` — single ink via CSS `color`, for stamps and watermarks.

Clear space: one module (the width of a square) all round. Minimum: mark 16px tall; lockup 120px wide (drop the descriptor below that). Don't rotate it, outline the face, recolour the face, or add shadows or 3D effects.

## Taglines

Main: **From flat to space.** Alternatives: *Unfold the world.* · *See in depth.* · *Every image has a room inside.*
