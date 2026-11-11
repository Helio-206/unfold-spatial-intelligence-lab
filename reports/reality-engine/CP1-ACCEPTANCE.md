# Checkpoint 1 — Evidence Contracts, incerteza e fidelidade (relatório de aceitação)

Branch `claude/unfold-fase-01-reality-engine-lvhbn9`. Fase 01 continua **NO-GO**. Nada aqui certifica fidelidade geométrica.

## 1. Pendências do baseline (as 5 falhas)
| Falha | Causa confirmada | Estado |
|---|---|---|
| `spatial-persistence-failures` ×2, `spatial-review-binding-transition` ×1 | Limitação de ambiente: simulam disco só de leitura com `chmod 0555`; root ignora permissões | Reproduzidas como utilizador `nobody`: **6/6 passam**. Continuam a falhar como root nesta sessão (não alterados, não saltados). |
| `universal-foundry-fitting` ×2 | **Defeito de desempenho confirmado** (não ambiente): cada avaliação do fitting regenerava as texturas PBR procedurais (`finishPixels`/`heightField`), ~60% de ~260 ms, sem influência na silhueta | Corrigido: `compileFoundry({ geometryOnly })` / `createUniversalMaterials({ textures:false })`, usado só em `objectiveOf`. Ficheiro: **112 s → 34 s**; 12/12 passam. |

Medição por avaliação (perfil em processo, sedan, lod 0): ~370 ms → ~50 ms. Os testes de fitting passaram a ter timeouts derivados do custo medido (`FIT_BUDGET_MS`, ~1,5–3,5 s/fitting aqui, folga ~4x), não valores arbitrários. Teste de regressão `foundry-fitting-cost.test.ts` (falhou antes): a silhueta é byte-idêntica com e sem texturas, e o modo geometria-apenas tem de custar < 60% (razão, independente da máquina).
Resto do custo (~50 ms/avaliação) é construção de malha (RoundedBox, merge); optimizações adicionais ficam para o CP4, onde o motor de geometria é revisto.

## 2. Código entregue
- `src/core/evidence.ts`: tipos OBSERVED / MEASURED / INFERRED / APPROXIMATED / UNKNOWN, `Uncertainty` com calibração (`by_construction | validated | declared`), `Measurement`, `evidenceKindOf`, `makeEvidenced`, `validateEvidenced`. Regras: sem promoção acima do tecto da origem (verificado por propriedade sobre origem × validação × contexto); validação humana nunca muda o tipo (`humanConfirmed` à parte); derivados herdam o elo mais fraco; fixture/synthetic/unknown = UNKNOWN; "observado" sem referência rastreável = UNKNOWN; MEASURED exige incerteza calibrada, unidade e evidência.
- `src/core/fidelity.ts`: `classifyFidelity` → Reconstrução fiel / parcialmente verificada / Aproximação conceptual / Resultado não validado, com `reasons`, `blockers` e `unvalidatable`. Resíduo do próprio fitting (não held-out) não conta como validação; IoU de uma vista dá no máximo "parcialmente verificada"; "fiel" exige ground truth 3D independente ou consistência multivista independente (≥3 vistas), suporte ≥ limiar e zero componentes UNKNOWN. Política marcada `provisional: true`: limiares (0.8 / 3 vistas) ainda não derivados de dados; o CP2 tem de os calibrar.
- `src/universal-spatial/reality-ledger.ts`: leitura pura do `SpatialPlanV2` (mesmo Spatial Core, sem grafo paralelo, sem escrita no plano). Fonte só de texto não pode dar geometria observada.
- `src/living/universal-foundry/camera-evidence.ts`: o azimute por regiões de pneu é APPROXIMATED (incerteza apenas declarada; o erro medido nos casos reais foi 18–22° contra ±10° declarados, logo MEASURED seria falso); ambíguo/só silhueta = INFERRED; **elevação, roll, FOV, escala e sentido = UNKNOWN sempre**.
- `src/living/universal-foundry/panel.ts`: o painel Foundry mostra a classe de fidelidade, % sustentado por observação e nº de componentes sem evidência.
- `src/core` continua sem importar nada de fora (teste estrutural existente passa).

## 3. Testes
| Verificação | Resultado |
|---|---|
| Novos: core-evidence, core-fidelity, reality-ledger, camera-evidence, foundry-fitting-cost | 57 testes; escritos primeiro e confirmados a falhar (módulos inexistentes / asserções de custo) |
| `npm test` (root) | 2660 passam, 3 falham (só os 3 que exigem não-root; passam como `nobody`) |
| `npm run build` | passa |

## 4. O que o CP1 NÃO faz (para não confundir progresso com certificação)
- Não melhora ainda nenhuma reconstrução: é infraestrutura de honestidade. Geometria além de veículos e câmara continuam como no CP0 (CP3/CP4).
- Os limiares de fidelidade são provisórios; não há ainda `ValidationRecord` produzido por um benchmark real (CP2).
- O ledger classifica pelo que o plano declara; não verifica que o plano declare a verdade (um plano "observed" de um modelo mal comportado continua a exigir validação held-out para sair de "não validado").
- Sem ground truth 3D: Chamfer e erros dimensionais continuam impossíveis; declarado em `unvalidatable`.
- Painel: só uma linha informativa; a revisão/comparação com a referência é CP6.

## 5. Próximo: CP2 (Benchmark Engine)
Ampliar o conjunto para além das 8 fotos com separação desenvolvimento/aceitação, produzir `ValidationRecord` reais, calibrar a política de fidelidade e congelar o baseline antes/depois (incl. o custo do fitting). Pedido de decisão: onde obter fotografias adicionais com direitos claros (Wikimedia/CC) — as chamadas de rede estão sujeitas à allowlist do ambiente.
