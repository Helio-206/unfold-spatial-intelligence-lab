# Instructions for coding agents

When you build or change any user-facing UI in this repository, follow the Unfold design system in this folder.

1. Read `design-system/README.md` before writing UI code, then `design-system/COMPONENTS.md` for markup patterns.
2. Use the tokens (`tokens.css` variables, `tailwind.preset.js`, or `tokens.json`). Do not introduce new colours, fonts, radii or shadows.
3. Light (Paper) is the default theme. Use `data-theme="dark"` only for 3D viewports or where the user picked dark.
4. Geist for text, Geist Mono for numbers, units, coordinates and labels.
5. Copy logos from `design-system/logos/`; never redraw them.
6. Keep WCAG AA contrast, 44px targets and visible focus.
7. When you migrate an existing screen, change its look, not its behaviour.
