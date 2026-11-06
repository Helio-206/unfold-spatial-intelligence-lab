# UNFOLD — Final Certification (experimental, scoped)

**Branch:** `integration/unfold-full-living-experience` · **SHA final:** o commit que contém este documento.
**Âmbito certificado:** o declarado em `LIMITATIONS.md`. Nada fora dele está aprovado.

## Matriz de aceitação (executada, não herdada)

Fonte: `tests/e2e/final-certification.pw.ts` — **20/20 PASS** (`certification-results.json`, capturas em `captures/`).

| # | Etapa | Veredicto | Evidência |
|---|---|---|---|
| A1 | Identidade fonte→plano | PASS | `source.sha256` completo; componentes `body,wheel-0..3` |
| A2 | Fitting com câmara dos píxeis (Worker) | PASS | az=21,5° (método: regiões de pneu), IoU 0.647→0.703, máscara `user_confirmed` |
| A3 | Componente real explicado | PASS | wheel-0 do plano, explicação ancorada |
| A4 | Proposta não altera o plano | PASS | pendente tipada, plano byte-idêntico |
| A5 | Commit muda o plano | PASS | transacção E1.4.1 pela UI do inspector, backend real |
| A6 | Undo restaura | PASS | plano byte-idêntico após undo |
| A7 | Guardar e reabrir | PASS | save + openRecord, mesma identidade de fonte |
| A8/B4/C3 | Sem erros de browser | PASS | três experiências limpas |
| B1–B3 | Máquina sintética: explicar, mover, experimentar | PASS | cinemática verificada; declarada sintética |
| C1–C2 | Não-automóvel: explorar e interagir | PASS | porta conceptual rotulada; movimento inferido |
| N1 | Vista frontal recusada | PASS | gate de câmara |
| N2 | Falha do modelo sem bloquear | PASS | fallback devolve null |
| N3 | Fitting cancelado sem aplicar | PASS | `aborted` |
| N4 | Flags desligadas por omissão | PASS | sem painéis experimentais em `/living` simples |
| M1 | Mobile 390×844 | PASS | sem erros; painel como folha inferior (cena visível) |

## Veredicto

**PASS — produto experimental demonstrável dentro do âmbito declarado**, atrás das flags existentes, sem activação por omissão. Critérios do utilizador no âmbito: (1) objecto espacial visível ✓ (2) componentes compreensíveis ✓ (3) interacção com componentes reais ✓ (4) movimento funcional onde suportado ✓ (5) experimentação disponível ✓ (6) experiência guardada recuperável sem inconsistências ✓.

**Não certificado (ver `LIMITATIONS.md`):** reconstrução fotográfica universal, segmentação automática fiável, vistas frontais, física validada, Muse Spark ao vivo, metas absolutas de IoU 0.82/0.88.
