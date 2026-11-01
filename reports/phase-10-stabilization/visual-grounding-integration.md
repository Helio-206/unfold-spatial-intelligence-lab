# UNFOLD — Visual Grounding e integração Muse

Data: 2026-11-01
Branch: `phase-10-mvp-stabilization`
Worktree: `/home/helio/HEr/META/unfold-spatial-intelligence-lab-final-stabilization`

## Resultado

**CONDITIONAL.** Foi acrescentado `visual_grounding.v1`, com identidade SHA-256 da imagem, dimensões e MIME, elementos semânticos, pontos/caixas normalizados, relações, confiança, evidência, ambiguidades e revisão humana. A UI envia a imagem original ao backend, mostra overlays e mantém todas as leituras como não revistas. Uma associação a linha local é apenas proposta; nenhuma resposta de grounding cria ou altera geometria CAD.

O caminho real de grounding funcionou duas vezes, incluindo através do botão “Localizar com Muse” no `/demo`. A integração da conversa espacial não passou: as duas chamadas reais feitas pela barra foram rejeitadas pela validação do resultado (`HTTP 502`, erros de schema). Não houve pergunta contextual aceite nem comando executado.

## Alterações principais

- `src/visual-grounding.ts`: contrato, validação de origem/coordenadas/relações, conversão normalizada→píxeis e associação conservadora a segmentos detectados.
- `server/meta-server.ts` e `src/meta.ts`: endpoint `/api/meta/grounding`, verificação dos bytes da imagem contra SHA/MIME/dimensões e chamada estruturada Muse sem retry/fallback.
- `src/spatial-editor.ts` e CSS: importação/localização, overlays, lista de elementos, aceitar/rejeitar leitura e contexto visual encaminhado ao agente. Aceitar um rótulo não confirma a geometria.
- `src/image-input.ts`: corrigida a leitura de JPEGs com marcadores restart `FFD0..FFD7` dentro do scan; a imagem original 1280×720 era anteriormente rejeitada pelo parser local.
- `src/spatial-agent.ts`: validação contextual da evidência visual; o agente não pode converter uma localização proposta em escrita directa no Scene Graph.
- Na associação visual, caixas extensas já não permitem “encaixar” segmentos distantes usando o centro/largura da caixa. Para paredes, é exigida sobreposição geométrica; pontos usam distância limitada.
- O tratamento de erro do agente agora preserva os metadados upstream (`requestId`, tokens, latência) quando a API respondeu mas a validação local rejeitou o conteúdo. Teste offline cobre este caso.

## Provas live Meta

Imagem testada: SHA-256 `8b85b3f98620257932a2ef20a48f628a659e27f37ea5c61576c9ff80fcad1488`, JPEG 1280×720. Chave não incluída no relatório.

| Uso | Resultado | Request ID / métricas |
|---|---|---|
| Tentativa antiga de grounding | Incomplete, 5000 tokens de saída | `4295cf56-0217-4173-9950-c0e710fe58d0`; input 1396, reasoning 1613, output 5000; 28.407 s; custo estimado US$0.022995. Evidência em `evidence/meta-grounding-live-01-incomplete.json`. |
| Grounding directo com contrato compacto | Completo; 14 elementos, todos `unreviewed` | `a4807a56-899e-4cb0-8726-2f65fc5b5ac7`; input 1381, reasoning 1542, output 3510, total 4891; 20.308 s; estimativa US$0.01664375. Evidência em `evidence/meta-grounding-live-02.json`. |
| Botão real “Localizar com Muse” em `/demo` | Completo; 12 elementos; overlays visíveis; nenhuma mutação | `2c9d5965-5a40-4f70-a57e-813f971a30cf`; input 1381, reasoning 1086, output 2919, total 4300; 18.338 s; estimativa US$0.014132. A resposta foi visível no browser, mas o payload bruto desta chamada não foi persistido separadamente. |
| Pergunta contextual real pela Command Bar | Rejeitada: `SPATIAL_AGENT_INVALID_RESULT`, categoria schema, HTTP 502; 10.617 s | O servidor registou 10.617 s de processamento observado. Não preservou request ID/tokens/custo nesta execução; ver falha de observabilidade abaixo. Nenhuma resposta foi aceite. |
| Intenção real “localizar e focar a parede sul…” | Rejeitada: `SPATIAL_AGENT_INVALID_RESULT_KIND`, categoria schema, HTTP 502; 15.166 s | Sem request ID/tokens/custo preservados nesta execução. Nenhuma acção foi executada. |

O contador persistente terminou exactamente em **5/5** (`evidence/meta-grounding-budget.json`). Não houve retries automáticos nem chamadas após o limite. As despesas estimadas conhecidas somam US$0.05377075; o custo das duas chamadas que falharam na validação não pôde ser reconstruído a partir dos logs locais. Não se deve interpretar esse subtotal como custo total facturado.

## Comparação local vs. grounding

No browser, a detecção geométrica apresentou **46 candidatos axiais**. O grounding apresentou 12 elementos semânticos. Apenas “parede sul terraço” obteve uma associação candidata local (`line-219`), a 239 px, confiança 0.46, estado `proposed`; continua por confirmar e não aponta para um nó de cena. As restantes regiões não têm associação geométrica aplicável.

O editor indicou 4 regiões propostas a partir dos segmentos seleccionados pelo utilizador, mas **0 ciclos exactos fechados**. A cena mostrava `SEM CENA`. Portanto, não há reconstrução 3D proveniente desta imagem, nem associação Muse→Scene Graph validada. O número de correcções humanas e o tempo de conclusão não foram medidos num ensaio A/B controlado; não se declara melhoria quantitativa de precisão.

O grounding contribuiu com rótulos/localizações visuais utilizáveis como contexto e overlay, mas não demonstrou topologia nem reconstrução automática. Todos os valores permanecem propostas, sem escala métrica.

## SAM 3.1

A documentação oficial descreve SAM 3.1 como segmentação por uma frase nominal de um conceito ou por caixas/pontos, devolvendo caixas e máscaras em píxeis; cada chamada de conceito é para um conceito de cada vez ([visão geral](https://dev.meta.ai/docs/sam/overview)). A documentação também separa explicitamente segmentação de raciocínio semântico de cena ([prompts de segmentação](https://dev.meta.ai/docs/sam/segmenting)).

Decisão: não integrado nesta intervenção. Máscaras podem ajudar a visualizar uma região depois de localizada, mas não resolvem por si só paredes, junções, vãos ou topologia. Não foi feita chamada SAM nem prova empírica neste domínio.

## Verificação offline

- `npm test`: **302 testes aprovados**, 43 ficheiros.
- `npm run build`: aprovado; aviso existente de chunk `OrbitControls` com 586.28 kB (minificado), acima do limiar de 500 kB.
- `npm audit --omit=dev`: **0 vulnerabilidades**.
- Testes novos cobrem hash/dimensões, bounds, relações inválidas, coordenadas, associação, caixa larga contra segmento distante, JPEG restart markers e preservação de metadados após rejeição schema.
- A resposta real de grounding foi renderizada na única aba já aberta em `http://127.0.0.1:5194/demo`; foram observados 12 overlays e a associação proposta de baixa confiança. Não foi guardada uma nova captura persistente desta sessão. As capturas anteriores da reconstrução manual permanecem em `evidence/user-plan/` e não são prova desta resposta Muse.

## Limitações e decisão

1. A conversa contextual real e a intenção de localizar/focar falharam na validação estruturada; o comportamento seguro foi não mutar a cena.
2. As duas falhas não conservaram request ID, uso nem custo, pois o handler perdeu `result.log` quando a validação local falhou. A correcção foi feita offline, mas não há chamada restante para revalidar live.
3. Não existe cena ligada à planta testada; logo, não foi demonstrado foco sobre geometria, alteração real, preview/commit ou associação a nó canónico.
4. O grounding é approximate visual evidence, não CAD, OCR verificado, escala nem prova geométrica.
5. A UI actual tem overlay/grounding, mas a imagem ocupa pouco espaço e a associação a segmento permanece débil; não foi redesenhada nesta intervenção.
6. SAM não foi testado empiricamente.

**Veredicto: CONDITIONAL.** A percepção multimodal real foi integrada e executada pelo caminho da aplicação, com identidade de imagem validada e sem alteração indevida da geometria. A contribuição para o modelo 3D e a conversa/comando contextual reais ainda não foram demonstrados. O orçamento desta autorização está esgotado.

## Recuperação do contrato espacial e prova offline

A investigação identifica uma incompatibilidade de fronteira, não um erro no envelope Responses:

- O pedido usa `POST /v1/responses` e `text.format = { type: "json_schema", name, schema, strict: true }`. O parser lê `output_text`/`output[].content[].text`, verifica conclusão e só depois valida IDs/capacidades contra o pedido.
- O contrato canónico `spatial_agent_result.v1` é uma união discriminada, mas a resposta anteriormente pedida era um único objecto plano que obrigava `question` e `action` como campos nullables independentemente de `kind`. O servidor entregava a saída do modelo directamente ao parser canónico. Essa forma não garantia coerência entre `kind`, `question` e `action`.
- Os JSON brutos das duas chamadas rejeitadas não foram preservados. Não é possível atribuir cada erro a um campo específico. `SPATIAL_AGENT_INVALID_RESULT` e `SPATIAL_AGENT_INVALID_RESULT_KIND` apenas demonstram rejeições locais; não permitem reconstruir os payloads.

Foi introduzida uma forma transportadora separada `spatial_agent_model_output.v1`: um objecto raiz com `outcome` e três ramos `anyOf` abaixo da raiz. Cada ramo exige todos os campos: `ANSWER` requer `action:null` e `question:null`; `PROPOSE_ACTION` requer acção e `question:null`; `REQUEST_CLARIFICATION` requer pergunta e `action:null`. `parseSpatialAgentModelOutput` converte essa saída para o contrato canónico e volta a executar a validação de evidência, capacidades, alvo, unidades e autorização textual. A resposta estruturada continua sem permissão para mutar a cena.

A forma estrita segue a [Responses API](https://dev.meta.ai/docs/protocols/responses) e a documentação de [Structured Outputs](https://dev.meta.ai/docs/structured-output), que define `text.format.strict` para Responses e permite `anyOf` abaixo da raiz. O contrato novo passou testes de integração HTTP com fixtures, respostas incompletas, erro upstream e envelopes/payloads inválidos. Isso não é replay das duas respostas reais antigas: o conteúdo bruto não existe no artefacto preservado.

## Grounding → geometria → Scene Graph

`associateGroundingsToCandidates` converte coordenadas normalizadas `0..1000` para pixels usando dimensões da imagem original. Caixas de divisões são comparadas apenas com polígonos candidatos locais existentes; calcula cobertura, IoU, score combinado e margem para a segunda opção. Paredes, portas e janelas são relacionadas com segmentos por intersecção da caixa/linha ou distância do ponto. Scores insuficientes ou empates resultam em `ambiguous`/`unmatched`. Grounding nunca cria comprimento, escala, parede ou polígono.

Resultado offline/browser na planta preservada, 1280×720, SHA-256 `8b85…1488`:

| Medida | A: detector local | B: detector + grounding Muse preservado |
|---|---:|---:|
| Segmentos candidatos | 46 | 46 |
| Ciclos exactos do grafo | 0 | 0 |
| Regiões ortogonais propostas | 4 | 4 |
| Elementos Muse preservados | — | 14 |
| Regiões com associação `proposed` | — | 2 |
| Associações de região `ambiguous` | — | 2 |
| Rótulos sem região associada | — | 4 |
| Associações a segmentos propostas | — | 2 |

Isto não demonstra melhoria de precisão: não existe referência-terreno independente nem medida de tempo/intervenções para comparar. As quatro regiões são propostas ortogonais heurísticas, não faces exactas do grafo nem divisões confirmadas. Nenhuma associação automática foi contada como correcta.

No E2E, “Cozinha” teve sobreposição 100%, mas score combinado 0,44 (abaixo do limite automático 0,45). Foi exigida revisão manual separada da aceitação da identidade. O utilizador E2E confirmou o rótulo e a associação à região `room-390-20-565-200`; o Scene Graph reteve o ID Muse, hash da imagem e método de revisão. Isto verifica apenas o vínculo de rótulo. Para construir a cena foi introduzida uma escala hipotética de teste (5 m/100 px), explicitamente não lida nem confirmada na imagem. Quatro paredes únicas e um pavimento candidato foram gerados a partir da região proposta; não se trata de reconstrução completa da habitação.

## SAM 3.1

Foi criado `src/sam-segmentation.ts`, adaptador offline isolado para construir o envelope Responses de `sam-3.1`, validando a identidade/dimensões declaradas e convertendo caixas/pontos normalizados Muse em prompts de píxel. Permite um conceito nominal único ou prompts localizados, nunca ambos. Não envia pedidos e não interpreta tokens de máscaras. `@meta-sam/parser` não está instalado; não foi inventado um parser próprio. Não houve chamada SAM nem prova de melhoria na planta. A documentação oficial descreve máscaras orientadas por conceito ou caixa/ponto, mas SAM não resolve topologia de cena por si ([visão geral](https://dev.meta.ai/docs/sam/overview), [prompts de segmentação](https://dev.meta.ai/docs/sam/segmenting)). Integração no percurso principal fica condicionada a parser oficial e avaliação com referência humana.

## E2E e evidências persistentes

Chromium headless isolado executou o `/demo` com a resposta Muse real previamente preservada; não foram interceptadas respostas para simular o agente e não houve pedidos para `/api/meta/*` ou `/api/spatial-agent`. O fluxo importou a imagem original, detectou 46 segmentos, apresentou 4 regiões, aceitou a identidade e confirmou manualmente uma associação ambígua, calibrando apenas com o valor hipotético de teste. Foram verificadas as malhas Three.js e o `spatial_scene.v1` serializado; a cena foi restaurada, enquadrada e capturada.

Ficheiros em `evidence/grounding-integration/`:

- `01-source-with-preserved-muse-grounding.png` — imagem e resultado Muse preservado.
- `02-grounding-to-geometric-candidates.png` — linhas, regiões e scores.
- `03-human-reviewed-grounding-link.png` — revisão manual.
- `04-scene-graph-and-threejs-from-grounded-region.png` — geometria criada a partir do Scene Graph.
- `05-restored-grounded-scene.png` — restauração e enquadramento.
- `result.json` — SHA, métricas, associação, bounds/meshes, confirmação, ausência de chamadas e escala de teste.

Os screenshots foram capturados pelo Chromium headless com SwiftShader, não GPU física. A captura 3D mostra uma única região quadrilateral com paredes; não é visualmente comparável à referência Blender nem prova uma casa inteira. A aba visível existente permaneceu aberta no `/demo` sem nova aba.

## Estado final

- Ledger de chamadas Meta preservado em **5/5**; nenhuma chamada Muse ou SAM executada nesta intervenção.
- Grounding Muse: resposta real preservada, reusada e vinculada ao SHA da imagem; nenhuma nova percepção live.
- Conversa/pergunta e comando após correcção do contrato: testes offline aprovados; **sem validação live**.
- Clarificação retomada no Spatial Agent com a pergunta original e a resposta do utilizador anexadas; **sem validação live**.
- Associação Grounding→geometria→Scene Graph: browser E2E funcional com revisão explícita; correção da topologia não demonstrada.
- A/B: sem melhoria quantitativa demonstrada; 0 ciclos exactos nos dois lados.
- SAM: adaptador de pedido offline testado, sem segmentação executada.

**Veredicto desta entrega: CONDITIONAL.** O contrato de conversação foi corrigido e testado offline; a cadeia visual real preservada chegou a uma cena Three.js editável após revisão humana. Ficam por demonstrar conversa/comando Muse live, contribuição topológica quantitativa, reconstrução completa da planta e utilidade empírica de SAM.

Verificação final desta execução: `npm test` **308/308** (44 ficheiros); `npm run build` passou com aviso existente de chunk `OrbitControls` de 586,28 kB; `npm audit --omit=dev` reportou **0 vulnerabilidades**; `git diff --check` passou. O ledger continua 5/5.
