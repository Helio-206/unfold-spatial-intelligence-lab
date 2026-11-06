# Resultados de regressão (executados nesta certificação)

| Comando | Resultado exacto |
|---|---|
| `npx vitest run --testTimeout=30000` | **2619/2619 testes, 172/172 ficheiros** |
| `npx tsc --noEmit` | limpo |
| `npm run build` | ✓ built (inclui chunk do fitting worker) |
| `npx tsx tests/e2e/final-certification.pw.ts` | **CERTIFICATION OK — 20/20 PASS** |
| `npx tsx tests/e2e/living-intelligence.pw.ts` | `LIVING-INTELLIGENCE-E2E OK` |
| `npx tsx tests/e2e/full-living-experience.pw.ts` | `FULL-LIVING-EXPERIENCE-E2E OK` |
| `npx tsx tests/e2e/real-photo-recovery.pw.ts` | OK (6 PASS) |
| `npx tsx tests/e2e/real-photo-proportions.pw.ts` | OK (4 PASS: proposta, commit implícito por proposta pendente, segmentação) |
| `npx tsx tests/e2e/real-photo-fitting.pw.ts` | OK (10 PASS: recusa automática das 3 fotos) |
| `scripts/verificar-texto.sh` | limpo |

**Falhas encontradas e corrigidas durante a certificação (só defeitos que impediam a demonstração):**
1. O script de certificação apontava a foto da porta para o directório errado (`photos-real` em vez de `photos/`) — corrigido o caminho, não o produto.
2. Callbacks nomeados em `page.evaluate` quebravam com `__name is not defined` (transform do tsx) — o caso negativo passou a string avaliada na página.
3. O caso N3 era recusado no gate antes de começar (evidência sintética inválida) — a evidência de teste passou a ser uma silhueta válida para exercitar o cancelamento a meio.
4. Em mobile (390×844) o painel vivo cobria a cena quase por completo — folha inferior com `max-height:46dvh` abaixo de 640 px (CSS de 3 linhas, sem redesenho); recapturado em `captures/M-01-mobile.png`.

Nenhum teste foi enfraquecido para fazer passar resultados. Timeouts herdados da suite completa continuam a exigir `--testTimeout=30000` (documentado nas entregas anteriores).
