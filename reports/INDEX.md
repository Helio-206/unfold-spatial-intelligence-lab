# Reports index (final integration, PR #27)

| Folder | What it is | Status |
|---|---|---|
| `acceptance/` | Final acceptance test: protocol, incident log, three scenarios (floor plan, lungs, microscope), `RESULTS.json`, videos | **Authoritative** for the final verdicts |
| `final-validation/` | Earlier validation (clock lamp, heart illustration), `FINAL-REPORT.md`, merge-gate follow-up | Superseded by `acceptance/` for verdicts; kept as evidence |
| `space-integration/` | Integration report (PR #25) and E2E evidence under `runs/` (mock fixture, replays, atlas, live runs, attempts); `raw/` is local and git-ignored | Evidence |
| `presentation-director/` | Spatial Presentation Director results and boards (PR #26) | Evidence |
| `visual-recovery/`, `universal-spatial*/` | PR #22 to #24 results and fixtures | Evidence |
| `anatomy/` | Anatomy integration notes (PR #21) | Evidence |
| other folders | Earlier phases (living, cinema, benchmark, …) | Historical |

Not versioned on purpose: raw Meta responses (`reports/**/raw/`, owner-only files on the machine that ran the paid calls), credentials (`.env`), private evidence folders. Files in `runs/*/e2e-result.json` carry request ids, hashes and plan summaries only.

| `reality-engine/` | Fase 01 (Reality Engine): auditoria, contratos, benchmark contra 3D, percurso `/living`, relatório consolidado (`REPORT.md`) | **NO-GO** da fase; multivista certificada só como "parcialmente verificada" no âmbito restrito |
