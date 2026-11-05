# UNFOLD — Product Quality Acceptance

**Branch:** `integration/unfold-full-living-experience` · **SHA final:** o commit que contém este documento. **Estado:** experimental atrás de flags, sem activação por omissão, sem merge.

## O que mudou nesta missão

1. **Representação vehicle com graus de liberdade reais** (`families/vehicle.ts`): além de `cabinHeight/cabinStart/cabinEnd/rearSlope`, a receita exprime agora `hoodHeight`, `tailHeight`, `shoulderHeight`, `roofCurvature`, `roofFront`, `roofRear`, `bodyHeightScale`, `wheelArchScale` e `wheelScale` — parâmetros limitados, interpretáveis, com defaults do arquétipo (1 = sem deformação onde aplicável). A posição das rodas continua a ser do plano; a receita nunca move componentes.
2. **Fitting v3** (`fitting.ts`, `FITTING_VERSION=3`): descida por coordenadas determinística grosso→fino sobre 12 parâmetros, objectivo ponderado documentado (0.55·IoU total + 0.45·média de IoU frente/meio/traseira) sobre silhuetas rasterizadas de triângulos, hipóteses de câmara explícitas (`side` / `three-quarter` aproximada declarada / `front-rear` recusada), baseline genuíno, saturação reportada, recusa abaixo de 5% de melhoria. Worker + fallback assíncrono, progresso, cancelamento, stale rejection e identidade de cache por versão+plano+máscara mantidos.
3. **Benchmark congelado** (`tests/fixtures/photos-real/benchmark.json`): 6 casos vehicle (4 development, 2 holdout genuínos — van CC BY-SA 3.0 e coupé fastback CC BY-SA 3.0 — congelados antes de qualquer fitting sobre eles), mais referências mecânica (escavadora) e não-veículo (cadeira) do manifest da auditoria. Um candidato a van foi rejeitado por inutilizável e ficou registado, não apagado.

## Resultados medidos (máscaras corrigidas pelo utilizador, IoU de silhueta projectada)

| Caso | Split | Baseline | Ajustado v3 | Melhoria | Saturação |
|---|---|---|---|---|---|
| car (hatchback) | dev | 0.654 | 0.708 | +15.5% | nenhuma |
| bus (template SUV declarado) | dev | 0.671 | 0.731 | +18.3% | nenhuma |
| porsche-911 | dev | 0.672 | 0.742 | +21.3% | nenhuma |
| skoda-kodiaq | dev | 0.647 | 0.713 | +18.8% | nenhuma |
| holdout-van | **holdout** | 0.649 | 0.696 | +13.6% | nenhuma |
| holdout-coupe | **holdout** | 0.643 | 0.717 | +21.0% | nenhuma |

Segmentação: automática IoU 0.20–0.27 (recusada, fail-closed); corrigida pelo utilizador IoU 0.935–0.962, erro de bbox 1–3 px. Diferenciação: silhuetas projectadas de sedan/hatchback/SUV diferem mensuravelmente (IoU cruzado < 0.97–0.99); cada novo DOF move a silhueta de forma independente (testes). Holdouts comportam-se como development (sem fosso de sobreajuste), mas **abaixo das metas**: dev ≥ 0.88 e holdout ≥ 0.82 **não foram atingidos** (0.70–0.74). O plateau é estrutural: proporções e distância entre eixos vêm do plano (fixtures semânticos genéricos), o perfil de loft tem granularidade fixa e a projecção é uma só vista. Aumentar mais parâmetros dentro desta representação rendeu +0.01 (wheelScale) — medido e parado.

## GO / NO-GO por capacidade

| Capacidade | Veredicto | Evidência |
|---|---|---|
| Segmentação automática em fotos complexas | **NO-GO** | IoU 0.20–0.27 vs anotação; recusada correctamente. Investigação de segmentadores locais: modelos acessíveis (MediaPipe selfie) são para pessoas; U2Net/ONNX (~170 MB) sem caminho de deployment justificado nesta missão. Fica híbrido clássico + correcção, declarado. |
| Segmentação assistida (contorno) | **GO** | IoU 0.935–0.962 nas 6 fotos; editor no fluxo real com proveniência distinta. |
| Fitting geométrico vehicle (assistido) | **GO parcial** | Melhoria reprodutível 14–21% sem saturação, holdouts incluídos; abaixo das metas de IoU absolutas. |
| Fidelidade de forma (metas 0.88/0.82) | **NO-GO** | 0.70–0.74 medidos; causa identificada (proporções do plano + perfil de loft), não escondida. |
| Multi-vista / 3D genuíno | **GO parcial** | Geometria 3D real (lofts), integridade de malhas testada (normais, NaN, bbox); sem ground truth fotográfico de outras vistas — plausibilidade, não medição. |
| Rendering photoreal | **GO** (como antes) | Mesmo palco, identidade preservada; sem comparações em GPU real disponíveis (SwiftShader declarado). |
| Living Intelligence (Spaces + escavadora) | **GO** | E2E existentes verdes; componentes reais seleccionáveis/explicáveis/móveis. |
| Interpretação Muse Spark ao vivo | **UNVERIFIED** | Sem credenciais/orçamento autorizado: adaptador e contratos testados com fixtures rotulados; nenhuma chamada feita nem simulada como real. |
| Autoridade E1.4.1 | **GO** | Suite completa verde; nenhum caminho novo escreve no plano. |
| Performance | **GO parcial** | Fitting no Worker (~300 ms/candidato fora da main thread, 73 avaliações ≈ 15–20 s com progresso e cancelamento); sem métricas de GPU real. |

## Testes

Suite completa **2611/2611** (170 ficheiros, `--testTimeout=30000`), `tsc --noEmit` e `npm run build` verdes (inclui chunk do fitting worker). Novos: `vehicle-geometry-v3.test.ts`, fitting v3, benchmark e resultados em `real-photo-evidence/fitting-v3-results.json`, comparações de máscaras dos 6 casos. Um teste de fitting recebeu timeout explícito de 120 s documentado (dois fits de ~15 s; falhava só sob carga paralela).

## Veredicto global

**NO-GO para aceitação completa do produto nos termos da secção 13 da missão.** O que está provado: pipeline honesto de ponta a ponta, recuperação de segmentação que funciona, fitting com DOF reais que melhora a forma de forma reprodutível (incluindo holdouts), e a experiência viva intacta. O que falta é da ordem de grandeza seguinte: proporções/distância entre eixos derivadas da evidência ao nível do plano e um perfil de loft mais rico — redesign da representação, identificado com números. Declarar GO seria repetir o erro que esta missão foi instruída a não cometer.

## Correcção arquitectural (sobre `2b011ca`): proporções derivadas da evidência

A limitação identificada foi corrigida na origem, sem acrescentar parâmetros ao `vehicle.ts`:

1. **Derivação da evidência** (`evidence-geometry.ts`): contactos de roda com a linha de chão, emparelhamento por eixos, orientação (espelho) decidida pelo centróide da cabina, raio pelo mergulho da aresta inferior, e aspecto global — tudo a partir da silhueta confirmada, com método e incerteza declarados e falha fechada quando não há dois contactos (autocarro e van: indisponível, sem proposta).
2. **Proposta tipada, nunca aplicação silenciosa:** `buildProportionsProposal` produz `SpatialOperationV2[]` validadas contra o contrato; no `/living`, o painel Foundry cria a proposta via `proposeSolverEdit` existente — demonstrado no browser: proposta pendente com 4 operações e o **plano autoritativo byte-a-byte intacto** até autorização humana pela transacção E1.4.1.
3. **Decomposição de erros medida** (`proportions-effect.json`), separando erro semântico, de câmara e de representação:

| Caso | Câmara | Baseline semântico | + proporções (baseline) | + fitting de receita |
|---|---|---|---|---|
| car | three-quarter | 0.654 | 0.630 (piora: mapping 3/4) | 0.668 (genérico: 0.708) |
| porsche-911 | side | 0.672 | 0.743 | 0.753 (gate de melhoria recusa aplicar a receita) |
| skoda-kodiaq | three-quarter | 0.647 | 0.731 | **0.766** |
| holdout-coupe | three-quarter | 0.643 | 0.799 | **0.810** |
| bus / holdout-van | three-quarter | — | indisponível (sem contactos) | fitting genérico mantém-se |

Duas correcções dentro da própria derivação foram encontradas medindo, não presumindo: o emparelhamento inicial ignorava o espelho da fotografia (rodas trocadas) e o raio pela altura da coluna media o corpo inteiro; e a escala de corpo por aspecto só é proposta em vista lateral (em três-quartos corrompia: 0.654→0.564). A proposta mostra a medição e deixa a decisão à revisão humana — em três-quartos pode legitimamente ser rejeitada.
4. **Reconstrução por modelos, avaliada com execução real:** MediaPipe ImageSegmenter (já era dependência) com DeepLab v3 local no browser: IoU automático **0.54–0.77** contra anotações (vs 0.20–0.27 clássico), integrado atrás de `experimental-mediapipe` com proveniência `model-mediapipe-deeplab-v3` e o mesmo gate de fiabilidade (no carro, a máscara do modelo cobre 71% e é **recusada fechado** — registado, não disfarçado). Modelos generativos de malha (tipo Trellis/Tripo): sem GPU local, sem pacote permissivo no repositório e com serviços pagos proibidos — bloqueio externo concreto para essa via; a via procedural+evidência é a executável aqui.

**Veredicto actualizado:** a arquitectura já não congela proporções nos planos genéricos — deriva-as da evidência e propõe-nas com revisão. Os melhores resultados sobem para **0.77–0.81** nos casos favoráveis, ainda abaixo da meta de 0.82/0.88 na maioria dos casos. **NO-GO mantém-se para aceitação fotográfica completa**, agora com o gargalo correctamente localizado (mapeamento em três-quartos e cobertura de detecção de rodas), não na falta de parâmetros.
