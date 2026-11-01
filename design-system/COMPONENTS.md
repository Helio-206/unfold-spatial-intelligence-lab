# Components and product rules

Markup patterns for `components.css`. Each works with plain HTML, React (`className`) or the Tailwind preset.

## Rules for product screens

- One primary action per screen, as `u-btn--primary` (fold). Everything else is `u-btn--outline` or `u-btn--ink`.
- Group content in tiles on `surface`; separate groups with whitespace or a `u-ruler`, not boxes inside boxes.
- Put every number in mono with its unit. Put confidence next to model output. Flag low confidence (< 0.7) with `u-chip--uncertain`.
- 3D viewports: `surface-raised` in light, or a `data-theme="dark"` container when the scene needs contrast. Axis gizmo: X fold, Y laser, Z depth.
- Touch targets ≥ 44px. Focus is always visible (2px `focus-ring`).
- Empty states: one sentence and one action, e.g. "No scenes yet. Send a photo to start."

## Buttons

```html
<button class="u-btn u-btn--primary">Export scene</button>
<button class="u-btn u-btn--outline">Cancel</button>
<a class="u-btn u-btn--ink u-btn--lg" href="#">Request access</a>
```

## Field

```html
<label class="u-field">Room name
  <input class="u-input" type="text" name="room">
</label>
```

## Tiles (cube net)

```html
<div class="u-tiles" style="grid-template-columns: repeat(3, minmax(0, 1fr))">
  <div class="u-tile"><h3 class="u-title">Depth</h3><p class="u-small">Per-pixel depth map.</p></div>
  <div class="u-tile u-tile--slab"><h3 class="u-title">Objects</h3></div>
  <div class="u-tile u-tile--fold"><h3 class="u-title">Export</h3></div>
</div>
```

## Section header with ruler

```html
<div class="u-ruler-head u-label"><span>02 · result</span><span>room_01.jpg</span></div>
<div class="u-ruler" aria-hidden="true"></div>
<h2 class="u-display" style="margin-top: 64px">An ordinary photo. A measured room.</h2>
```

## Chips on scene objects

```html
<span class="u-chip u-chip--x">table · 1.40 × 0.80 m</span>
<span class="u-chip u-chip--z">sofa · 2.10 m</span>
<span class="u-chip u-chip--uncertain">lamp? · review</span>
```

## Readout

```html
<dl class="u-readout">
  <div><dt>Wall distance</dt><dd>4.62 m ±6 cm</dd></div>
  <div><dt>Table → window</dt><dd>1.20 m ±4 cm</dd></div>
</dl>
```

## Axis legend

```html
<span class="u-axis u-axis--x"></span> X · <span class="u-axis u-axis--y"></span> Y · <span class="u-axis u-axis--z"></span> Z
```

## Reference

`../landing/index.html` is the reference implementation of this system: hero with the folding cube, ruler section headers, the before/after comparison, the cube-net tile grid and the lifting-face CTA.
