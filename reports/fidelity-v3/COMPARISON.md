# Universal Spatial Fidelity V3 — technical comparison of geometry sources

Base: `b87dbe7` (the Terminal's final-integration branch, which contains #26). Nothing here changes that release.

## What could and could not be done (read this first)

The brief asks for an **experimental** study of four providers. In this environment it was not possible:

| Needed | Found |
|---|---|
| GPU for self-hosted models | none (`nvidia-smi` absent, 4 CPUs, 15 GB RAM) |
| Network to providers | `huggingface.co`, `api.meshy.ai`, `www.meshy.ai`, `ai.meta.com` unreachable through the session proxy |
| Credentials and budget | no provider key, no approved budget |
| Private images to third parties | no authorisation given |

So **no provider was run**. The table below comes from documentation and secondary sources found by web search; every figure is marked with how solid it is. Nothing was adopted or rejected on promotional images. An experiment protocol is included so a person with a GPU or an approved budget can fill the gaps with real numbers.

## Provider table (desk research, not measured)

| | Meta SAM 3D Objects | Microsoft TRELLIS.2 | Meshy Image-to-3D | Tencent Hunyuan3D 2.1 |
|---|---|---|---|---|
| How it runs | open weights; hosted by third parties (e.g. [Runware](https://runware.ai/docs/models/meta-sam-3d-objects), fal.ai) | open weights, self-hosted ([model card](https://huggingface.co/microsoft/trellis.2-4b)) | hosted API only ([pricing](https://docs.meshy.ai/en/api/pricing)) | open weights, self-hosted |
| Licence | "SAM License"; one summary says commercial use allowed with restrictions (e.g. no military), another calls it the "SAM 3 license". **Read the repo LICENSE before use.** | **MIT** per the model card (code and weights per secondary coverage) | output terms depend on plan: free = CC BY 4.0 with attribution; paid = user owns output ([pricing](https://docs.meshy.ai/pricing), [help](https://intercom.help/meshy/en/articles/16102098-can-i-use-meshy-assets-commercially)); no separate API licence found | Tencent Community License that **excludes the EU, UK and South Korea** as territory ([licence mirror](https://gitserver.onethingai.com/ai-models/Hunyuan3D-2.1/raw/branch/main/LICENSE); unconfirmed against the official copy) |
| Output | GLB default on hosted APIs, 2-15 MB typical (fal.ai figure) | mesh with PBR (base colour, roughness, metallic, opacity), `to_glb` export | GLB and others; textured and 8K-texture options | mesh and texture |
| Cost | hosted per call; not found | GPU time only if self-hosted | Meshy-6 image-to-3D: 20 credits untextured, 30 textured, 35 with 8K texture (API page; the web-app page says 25 for Meshy 7, so check live). Credit-to-USD not verified | GPU time only |
| GPU | not found in results (check official README) | **conflicting**: 16 GB at 512³, 40 GB at 1024³, 80 GB at 1536³ (one source); "24 GB minimum, Linux" (another). Not available here | none (hosted) | 10 GB shape, 21 GB texture, 29 GB both (third-party summary) |
| Part separation | single object; no native component split (not verified) | single mesh; no native component split (not verified) | single mesh; no native component split (not verified) | single mesh (not verified) |
| Latency | not found | "seconds" claimed by secondary coverage; not measured | not found | not found |
| Data leaves UNFOLD | yes if hosted; no if self-hosted | no (self-hosted) | **yes**, always | no (self-hosted) |

### What follows from it, without running anything

- **Hunyuan3D 2.1 is disqualified for UNFOLD as it stands**: the territory clause excludes the EU, and the team and likely users are in Portugal. It was not studied further, as the brief allows ("only if there is a practical advantage").
- **TRELLIS.2 is the only option with a clean, permissive licence and no data leaving the system**, but it needs a GPU this environment does not have, and its VRAM need is reported inconsistently.
- **Meshy is the cheapest way to try, and the only one that sends the image to a third party** by design. It needs consent per image, an approved budget and a decision on plan/licence (free-tier output is CC BY 4.0).
- **SAM 3D Objects** is attractive for provenance (Meta, like the planner) but its licence text must be verified first, and running it means either a GPU or a hosted third party.
- **None of the four is known to separate a mesh into the plan's components.** That is the core integration problem for UNFOLD (selection, review, provenance per component), and it is solved on our side, not by choosing a provider (see CONTRACT.md: a mesh is mapped to components only through an explicit, reviewable assignment).

## Experiment protocol (to run when a GPU or budget exists)

Inputs: the three acceptance inputs (`reports/acceptance/inputs/`: floor plan, lungs) plus the microscope text rendered to an image by an approved route. The floor plan is **not** an object photo: it goes to the architecture path, not to an object generator.
For each provider and input, record: request id, wall latency, cost, output format, triangle count, vertices, texture count and size, file size, watertightness, whether parts come back separated, GLB validation result from `validateGlb` (this PR), GPU memory in the viewer, and a human recognition note. Keep the same camera, lighting and scale across providers. Stop at the approved budget.

## Decision

Build the integration so the provider choice stays open and optional (CONTRACT.md), and prove the parts that do not depend on a provider: the router, the safe GLB path, and a continuous-surface geometry family that runs offline on the real plan data. Do not claim a provider's quality from this document.
