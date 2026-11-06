# Diagnóstico temporal do PR #31

## Resultado

**NO-GO para performance em produção; defeito específico identificado para investigação/correção.** No Chromium headless com SwiftShader, as reconstruções V2 após editar e desfazer libertam programas de shader e a renderização seguinte volta a compilá-los. O bloqueio observado está em `gl.getProgramInfoLog`, chamado por `WebGLProgram` do Three.js durante a inicialização de programas, dentro de `EffectComposer.render` → `WebGLRenderer.render`. Isto não determina quanto tempo corresponde a compilação, sincronização ou trabalho do driver internamente. Não demonstra o comportamento de uma GPU física.

O trace separado usou um ciclo de aquecimento e três ciclos medidos. Com instrumentação da API WebGL, registou no undo 1 (tempos `performance.now`, ms):

| Operação | Início | Duração |
|---|---:|---:|
| `build` do layer | 13730,6 | 11,5 |
| 2 × `deleteProgram` | 13730,9 | < 0,1 cada |
| compilador do plano | 13731,0 | 1,9 |
| renderer / composer / WebGLRenderer | 13801,2 | 1286,5 / 1286,3 / 1286,0 |
| `compileShader` × 2; `linkProgram` | 13803,1–13803,4 | < 0,1 cada |
| primeiro `getProgramInfoLog` | 13803,4 | 1169,1 |
| segundo `getProgramInfoLog` | 14976,3 | 108,5 |

Em cada um dos três ciclos edit/undo do trace foram registados dois `deleteProgram`, quatro `compileShader`, dois `linkProgram` e dois `getProgramInfoLog`. O segundo `getProgramInfoLog` nem sempre é o mais lento. Estes são intervalos aninhados, não somáveis como operações independentes. O profile de CPU indica a mesma chamada; o trace registou 15 eventos Minor/Major GC, máximo 2,325 ms, insuficientes para explicar picos de segundos nesse ensaio. O trace mostra também tarefas no processo gráfico; não distingue trabalho efetivo na GPU, bloqueio do driver e sincronização interna.

O mecanismo observado é coerente com `PlanSpaceLayer.build()` chamar `release()`, que dispõe os materiais da geometria anterior, antes de compilar a nova cena. O trace prova a sequência de eliminação e recriação destes programas no cenário medido; não prova que todos os planos, drivers ou modos tenham o mesmo comportamento. Não foi alterado `checkShaderErrors`: desativar diagnóstico sem resolver o ciclo de vida seria uma alteração especulativa com custo de observabilidade.

## Condições

- SHA de código em análise: `a6457948c56977b05feb39b79701e24ad3923c3a`; plano de harpa guardado em `reports/universal-spatial-v2/evidence/blind-harp-plan.json`, originalmente resposta guardada com parâmetros do reparador antigo, reproduzida localmente. Nenhuma chamada Meta paga.
- `/living`, Chromium de sistema headless, SwiftShader, 1440 × 900, device scale 1, reduced motion. Mesma câmara inicial, plano, componente `harp-neck` e operações locais `x+` e undo; a sessão remota foi desligada depois de estabelecer o Space para remover latência de rede. Seleção e ID foram verificados após cada operação.
- Cada configuração: 3 ciclos de aquecimento e 12 ciclos medidos (12 edições e 12 undo). As linhas seguintes apresentam mediana e máximo, não P95/P99 conclusivos para 12 amostras. Execuções sequenciais; amostras não são observações independentes de dispositivos.
- A: Worker indisponível, V2. B: Worker real e substituição V3 ativas. C: Worker concluiu geração mas o agendamento da substituição foi interceptado pelo ensaio, mantendo V2. D: B sem wrappers detalhados, com apenas relógio das operações/chamada de render. B com capturas: mesma sequência com screenshot após cada ação. As configurações de teste alteram o ambiente apenas no browser do ensaio.

| Ensaio | Edição operação mediana/máx. ms | Render após edição mediana/máx. ms | Undo operação mediana/máx. ms | Render após undo mediana/máx. ms |
|---|---:|---:|---:|---:|
| A V2, sem screenshots | 99,1 / 199,0 | 1186,2 / 1857,3 | 78,1 / 187,6 | 1201,3 / 1317,9 |
| B V3 ativo, sem screenshots | 147,4 / 158,4 | 1842,8 / 1912,5 | 75,8 / 92,8 | 1824,4 / 1880,2 |
| C geração V3, sem troca | 183,2 / 236,9 | 1975,4 / 2099,9 | 82,1 / 172,8 | 1067,7 / 2117,9 |
| D V3, sem wrappers detalhados ou screenshots | 150,4 / 209,6 | 1912,2 / 1964,7 | 74,4 / 92,8 | 1901,2 / 1967,3 |
| B V3, com screenshots | 148,4 / 184,3 | 101,6 / 135,3 | 99,6 / 250,8 | 104,7 / 415,1 |

Com screenshots, a captura subsequente custou mediana/máximo 1954,5/2477,0 ms após edição e 1887,5/1925,0 ms após undo (relógio externo Playwright). O tempo deslocou-se entre chamadas; isto é compatível com sincronização/composição, mas não demonstra por si só a causa interna. Os máximos de A, B e C provam que V3, a troca de malha, os screenshots e os wrappers detalhados não são necessários para reproduzir um bloqueio grande. Diferenças entre medianas não isolam efeito causal V3: são séries sequenciais num único host com variabilidade do renderer.

Nos 24 eventos medidos de A, máximos: compilador 7,7 ms; `build` inclusivo 38,8 ms; `release` inclusivo 7,6 ms; uma chamada externa à atualização da scene graph 0,2 ms; dispose individual de geometria 0,2 ms; inspector 1,8 ms. Em B, upgrade 3,2 ms máximo nos eventos medidos. As chamadas de atualização e dispose são numerosas e aninhadas; os máximos individuais não representam o total por operação. A construção inicial tem uma amostra por configuração e não permite distribuição. `longtask` foi registado quando entregue pelo browser, mas não é uma medição de GPU.

## Reprodução e limites

Os ensaios estão em `tests/e2e/performance-root-cause.pw.mjs` e `tests/e2e/performance-shader-trace.pw.mjs`. Com backend local na porta 8796 configurado com `UNFOLD_ACCEPTANCE_MAX_META_CALLS=0`, chave vazia e `UNFOLD_LOCAL_ORIGINS=http://127.0.0.1:5195`, iniciar Vite na porta 5195 com `UNFOLD_API_TARGET=http://127.0.0.1:8796` e executar os scripts a partir da raiz. `UNFOLD_SPACE_URL`, `UNFOLD_RCA_OUT` e `CHROMIUM_PATH` são configuráveis. O trace CDP, JSONs com timestamps e screenshots deste ensaio estão em `/tmp/unfold-rca/`; são artefactos locais, não resultados Meta live.

Critérios não demonstrados: comportamento em GPU física e Safari/iOS, latência de apresentação GPU, tempos de GC fora desta captura e isolamento exato entre compilação de shader e sincronização no driver. O teste usa chamadas diretas ao workspace para executar a mesma operação, não prova o custo completo do percurso humano. Os critérios funcionais existentes continuam sujeitos à suite do projeto e ao teste anterior de Voice simulado. Não foram feitas correções de produto nesta investigação.

Defeito delimitado: **edição/undo reconstroem a cena e libertam programas de shader ainda necessários, forçando nova inicialização no render seguinte**. Uma eventual solução deve gerir o ciclo de vida de materiais/programas mantendo dispose, identidade, seleção, Director, Voice e limites de memória; medir antes e depois em GPU física e SwiftShader. Não presumir que desativar verificações de shader corrige o custo subjacente.
