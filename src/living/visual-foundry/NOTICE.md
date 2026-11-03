# Notices

## Airsup machine-skill (MIT)

Some rendering techniques in this folder were adapted from the Airsup machine-skill kit
(https://github.com/AirsupHQ/machine-skill, `kit/lab-kit.js`): the softbox-and-flag PMREM studio environment, the
inverse tone-mapped background, the depth-from-below blurred contact shadow, and the preset table with per-finish
micro-roughness maps. The code here is a rewrite for UNFOLD (TypeScript, seeded DataTextures, UNFOLD tokens); no Airsup
UI, fonts or page structure is used.

```
MIT License

Copyright (c) 2026 Air Supply Technologies Inc. (Airsup)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Other dependencies

- three.js (MIT) and its examples: `OrbitControls`, `RoundedBoxGeometry`, `BufferGeometryUtils`, `EffectComposer`,
  `RenderPass`, `GTAOPass`, `OutputPass`, blur shaders. Already a dependency of the repository.
- lucide-static icons (ISC). Already a dependency.
- Geist / Geist Mono (SIL OFL), via `design-system/fonts.css`.

No external 3D assets, HDRIs or textures are used: every mesh and texture is generated in code.
