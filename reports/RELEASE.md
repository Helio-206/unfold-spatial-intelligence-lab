# Technical release audit: PR #27

Product code under audit at the first audit: identical to the validated `04709dca9e151e42e1f9d5873410fd437c09f495` (see «Post-audit changes» below for the three Codex P2 fixes made afterwards) (no difference in `src/`, `server/`, `public/`, `package.json`, `package-lock.json`, Vite/TS config). Later commits changed only `reports/`, the new harness `tests/e2e/space-accept.pw.mjs`, `README.md` and this index. Verdict from the requester: GO for a controlled demo, NO-GO for public production.

## Checks run at this head

| Check | Result |
|---|---|
| `tsc --noEmit` | pass |
| `npx vitest run --testTimeout=60000` | 132 files, 2 285 tests, all pass |
| `npm run build` | pass; warnings: `VITE_UNFOLD_CONTACT_EMAIL` undefined (landing contact shows as unavailable), chunks above 500 kB. Neither blocks. |
| E2E `space-workspace` mock, 1440×900 and 390×844 | pass (review gate, build, orbit, pointer selection, explode, edit/undo, server-session mirroring, Meta proposal gating and verified evaluation with mocked paid routes, My Spaces, leave guard, idle renderer, GPU counters, clean console) |
| E2E `space-atlas` | pass |
| `unified-living` (26) and `unified-lifecycle` (6) | pass |
| Start-up as documented | backend `npm run server` (health ok; without a key `MODEL_API_KEY_MISSING`), frontend `npm run dev -- --port 5191 --strictPort` with `UNFOLD_LOCAL_ORIGINS`, `/living` served, `/api` proxied |

## Integrity

- All #26 fixes present: idle-safe `update()` in `director.ts`, floor-safe exploded view in `structure.ts`, `finish.ts` change, with their tests. Ancestors of HEAD: #26 `bcbe3d7`, #24 `3ac2abf`, #23 `ea4c522`, #22 `759d606`, #21 `b3659ef`, #25 `2cea25f`. The merges of main (#20), Anatomy and both #26 stages are real merge commits; no history was rewritten.
- Against `main` (`e197d07`, unchanged): merge-tree has no conflicts; 39 commits ahead.
- Secrets: no `.env` tracked; the key does not appear in any tracked file or in the repository history (scanned by value); no raw Meta response tracked (`reports/**/raw/` is git-ignored). Tracked evidence carries request ids, hashes and plan summaries only. `.env.example` contains no value.
- Resources: leaving a Space frees geometries and textures (4 / 7 before and after, in every run); the Director and layer dispose their objects; the renderer idles (0 frames per 2 s window once transitions end).
- Licences: no new dependency (only an npm script line differs from main). BodyParts3D heart atlas CC BY 4.0 and the illustration CC BY-SA 3.0 are attributed in `public/anatomy/` and in the inspector; the acceptance inputs (floor plan, lungs) were supplied by the requester and their licence was not verified, so they are test inputs, not distributable assets.
- Security posture (unchanged by this audit): localhost origin allowlist or local token, call budget, per-minute limits, body limits, strict request-key checks; `/v2/adopt` is local and validated like every plan.

## Known limits and blockers

No merge blocker found. Limits: Space output is a conceptual composition, not geometrically faithful; two image acceptance runs were completed by replay of their own stored plans after a harness assertion aborted the live runs; one real visual-evaluation reply failed validation (cause unknown, reply not kept); the review list is cramped at 1440×900; exploded view on a phone with the inspector open is partly clipped; software rendering only, no real GPU or device; Portuguese only. Production blockers: authentication, durable sessions and storage, HTTPS/CORS/CSP, data-retention policy, quotas and alerting.

## Recommendation

**MERGE GO** (to `main`, single merge commit, no squash, no rebase), once the requester authorises it. Merge not executed.

## Post-audit changes: Codex review P2 findings on PR #27 (functional, each with a failing test first)

1. **Edits during session adoption** (`flow.ts`, `layer.ts`): editing is locked («a preparar a sessão do servidor») until the server session is attached or declared absent, so an edit can no longer be applied locally and then silently overwritten by the server's plan. Layer test added.
2. **Provenance across the sync boundary** (`server/meta-server.ts`, `api-client.ts`, `layer.ts`, `flow.ts`): `/v2/operation` accepts an optional `origin` (`inferred` or `user_provided` only; anything stronger is refused with 400) and a short `evidence` note, and the layer passes the provenance of every operation, so the solver's results stay `inferred` on the server and in saved Spaces instead of being promoted to `user_provided`. Server tests and a layer test added.
3. **Anatomy review gate** (`src/anatomy/page.ts`): choosing or clearing the corrected component now revalidates the build gate. New browser test `tests/e2e/anatomy-review-correction.pw.ts` (mocked observation route, no model call).

Re-run after these changes: `tsc`, suite 132 files / 2 289 tests, build, the new anatomy test, `space-workspace` mock at 1440×900 and 390×844, `space-atlas`, `unified-living` (26), `unified-lifecycle` (6): all pass. Note for operators: restart the backend after pulling these changes; an older backend rejects the new `origin`/`evidence` fields and the workspace then reports the session as lost.
