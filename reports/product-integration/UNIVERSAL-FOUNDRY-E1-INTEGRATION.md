# Universal Foundry × E1.4.1 — Integração

- Branch isolada: `integration/universal-foundry-e1-4`, a partir de `fix/v4-e1-4-review-binding-transition@ab22b38fa54ffecc5b58a5894bad93918ce7ab47`. Sem merge para `main`/`produto`, sem activação em produção, sem inferência paga.
- SHA final: ver `git log -1` nesta branch (o relatório entra no commit final).

## A — Integração das duas implementações

O Foundry (`feat/universal-visual-foundry@587854b`, baseado em E1.3) entrou por cherry-pick revisto dos seus três commits (`b839486` operadores/receitas/materiais e as oito famílias, `9492f24` provider experimental em `/living`, painel e e2e, `177ac48` testes core e relatório) — **sem conflitos**, porque as alterações partilhadas eram pequenas e ortogonais às do E1.4:

| Ficheiro partilhado | Foundry | E1.4 preservado |
|---|---|---|
| `spatial-space/flow.ts` | seam opcional `geometry`/`onImage` nos `SpaceFlowOptions`; `GeometrySeam` substitui `ProductGeometry` quando fornecido | sessões, binding de revisão, política, reconciliação — intactos |
| `spatial-space/layer.ts` | `regenerate()`: rebuild da cena a partir do mesmo plano | commit fenced, estado unresolved, guard de autorização — intactos |
| `unified-workspace/shell.ts` | Foundry só com `debug + ?experimental-foundry`; `__foundry3d` exposto em debug | `__v4` com `currentReviewId`, dispose — intactos |
| `fidelity/types.ts`, `router.ts`, `product-geometry.ts` | família `universal_foundry` no relatório do router | relatórios existentes ganham a chave nova com zeros |
| `server/meta-server.ts` | — (não tocado) | endpoint review-binding, política imutável, fences, aprovações estruturadas, persistência, undo idempotente — verificados por grep e pela suite E1 |

Nenhum ficheiro E1.4 foi substituído por uma versão anterior; a geometria procedural, materiais, receitas, editor de parâmetros e comportamento de rendering do Foundry ficaram como vieram.

## B — Geometria visual separada do estado autoritativo

O provider compila **a partir** do plano: `compileFoundry(plan)` e `FoundryGeometry.compile(plan)` nunca escrevem no plano, e `layer.regenerate()` reconstrói a cena a partir do mesmo plano sem tocar em história, proveniência ou qualquer conceito de revisão do servidor (que nem sequer é consultado). Teste novo (`tests/universal-foundry-integration.test.ts`): mudar parâmetros/semente e regenerar deixa os bytes do plano idênticos e `editCount` a 0; uma edição autorizada pelo caminho tipado normal muda o plano, a regeneração seguinte segue o plano novo sem o reescrever, e o undo restaura o original. Detalhes visuais inferidos pela receita continuam marcados como inferidos nos relatórios (`universal_foundry` com a razão por componente); nada disto é um facto de engenharia aprovado.

## C — Cenário completo verificado (backend real)

`tests/e2e/v4-e1-review-browser.pw.mjs` corre agora com `&experimental-foundry`:

Criar Space → rever componentes → construir → visualização Foundry (família desenha componentes, painel presente) → regeneração só-visual (plano byte-idêntico) → rever relações → sessão transita para `review_fenced` → pedido sem fence rejeitado (403) → decidir contraditas → autorizar modificação → commit fenced (1 revisão, proveniência `inferred`) → plano muda → abrir revisão cria o registo B e a **mesma sessão** transita o binding sem reset → segundo commit fenced → undo ×2 → plano original exacto. Persistem: sessão fenced nos dois commits, bindings correctos, nenhuma transição reinicia história, respostas perdidas continuam sem sucesso falso (regressões E0/E1.4), e reabrir o Space mantém a autoridade. Screenshots: `foundry-visualisation.png`, `review-decided.png`, `review-reopened.png`, `two-reviewed-edits-undone.png` em `/tmp/unfold-v4-e1-browser-*/`. Spaces legacy são exercitados separadamente pelos e2e existentes (sem flag, sem review) e pela suite.

## D — Produto preservado

As oito famílias (`appliance, architecture, construction, electronics, furniture, organic, tool, vehicle`) estão no registo e testadas; selecção, inspector, isolamento, foco, câmara, guardar/reabrir e edição de parâmetros são os do Foundry e do workspace actuais — nenhuma UI foi substituída. O Foundry continua atrás de `experimental-foundry` em debug; sem a flag, o produto usa `ProductGeometry` como antes. O exemplo da escavadora corre no e2e do Foundry (`miniExcavator`: V3 2 196 triângulos → Foundry 18 640, sem erros) e no cenário C acima.

## E — Testes e evidência

- Cherry-picks + teste de integração novo: focados Foundry/camada/fenced 31–74 verdes por conjunto; `tsc` limpo.
- Browser contra backend real: cenário C completo (Foundry + revisão + 2 commits fenced + 2 undos), `v4-e0-atomic-browser`, `universal-foundry-living` (miniExcavator + hatchback). O ensaio C continua a espaçar o segundo ciclo pela janela do limite de 20 pedidos espaciais/minuto do servidor, sem o enfraquecer.
- Falhas de persistência e binding obsoleto: cobertos pelas suites E1.4 (`spatial-persistence-failures`, `spatial-review-binding-transition`) que correm nesta branch sem alterações.
- Build verde. Suite completa: 2542 verdes, 4 falhas — exactamente os quatro timeouts herdados da baseline (`rendering-lifecycle`, `universal-spatial-buried` ×2, `bucket-width`; «timed out in 5000ms», passam isolados), na corrida por defeito, sem limites alterados.

## Limites

- O Foundry interpreta o plano por heurísticas de vocabulário: objectos fora das oito famílias caem para V2 (`NO_RECIPE`), e parâmetros visuais são escolhas de apresentação persistidas localmente por fonte — nunca decisões revistas nem factos.
- A evidência de imagem é extraída localmente no browser; não verifica a verdade física da fotografia.
- Persistem os limites E1.4: sessões V1 voláteis, sem fsync (sem garantia contra perda de energia), single-processo, sem autenticação de revisor.

## GO/NO-GO

**GO.** O Foundry está integrado como representação visual derivada, atrás de flag experimental, sem tocar em nenhuma garantia de autoridade do E1.4.1 — e o cenário revisto completo (Foundry + revisão + commits fenced + undos) está provado contra o backend real. A integração transaccional está fechada; esta branch fica disponível para o Foundry V2 condicionado por imagem. Não expandir mais o E1.
