# UNFOLD — Fase 01: Reality Engine — avaliação consolidada (continuação integral)

Branch `claude/unfold-fase-01-reality-engine-lvhbn9`, sem merge em `produto`. Esta avaliação **substitui** a anterior (preservada abaixo como histórico). Investigação: `INVESTIGATION.md`. Benchmark: `benchmark/README.md`. Revisão visual independente: `visual-review/README.md` (**por fazer**).

## Estado final: **NO-GO** (Fase 01 integral). Fase 02 não iniciada.

O produto deixou de depender de imagens sintéticas perfeitas: aceita fotografias com fundo complexo através de um editor de contorno interactivo, avisa o que falta capturar, escolhe e explica a estratégia, mede relações e oclusão entre partes, e continua a recusar o que não consegue sustentar. Continua **sem** validação em fotografias reais de objectos com 3D de referência, sem revisão visual independente e sem GPU real; por isso nenhuma categoria é "fiel" e o estado não sobe.

### O que mudou nesta continuação (todo medido, ver números)
| Área | Entrega | Evidência |
|---|---|---|
| Captura real | Segmentação interactiva (caixa + pincéis, corte mínimo, Worker), «Ajustar contorno» no intake | 8 fotografias reais de veículos: automática 0.298 IoU → caixa 0.535 → 3 rondas de correcções **0.866** (holdouts 0.884/0.876). Correcções simuladas com o polígono como oráculo; referência de um só anotador. |
| Captura real | Pipeline completo sobre **fundos de fotografias reais** | Automática credível em **13/112 vistas (12%)**; com contorno ajustado **14/14 reconstruídos**; Chamfer médio 2.63% (dev, máx. 4.03) / 2.57% (aceitação, máx. 3.12); IoU retido 0.78 / 0.81; 3/14 ficam "não validados". |
| Captura real | Qualidade de imagem (desfoque, exposição, resolução, objecto cortado), cobertura angular e de altura, vistas redundantes ou insuficientes, instruções em português | `capture-quality.ts`, 7 testes; limiares heurísticos declarados como não calibrados em fotografias reais. |
| Estratégia | Selecção por tipo de entrada e evidência, com limites e "o que fazer", sem fallback silencioso | `strategy.ts`; mostrada no intake. Texto/foto única → IA (conceptual); foto única de veículo → ajuste existente; ≥2 vistas credíveis → casco; contorno não credível → «precisa de entrada»; desenho/planta → não certificados. |
| Componentes | Estrutura **medida**: contactos, pares espelhados, eixos paralelos, visibilidade/oclusão por parte e vista; relações no plano como inferidas (não impostas) | `structure.ts`; vistas por parte < 2 declaradas como desconhecidas. Contra a estrutura de nós do ground truth: **7/9** (dev) e **7/25** (aceitação) partes significativas recuperadas — **o reconhecimento de peças continua a ser geometria, não compreensão**. |
| Componentes | Separação de membros finos (`limbs`) | Funciona em sólidos sintéticos; **não melhorou** na referência real e sobre-segmentou → desligado por defeito (experiência registada). |
| Visual | Cor por mediana robusta, verificação fotométrica em vistas novas, materiais assumidos declarados, regiões não vistas visíveis | Erro de cor em vistas novas 14–21/255 (camião 37); mediana melhor em 5/5 activos de desenvolvimento. Rugosidade/metal/normais finas **não inventadas**. |
| Câmara | SfM (pycolmap) avaliado e **não integrado** | 8 vistas a 45°: 0 modelos; 24 vistas: 15/24 registadas, passos irregulares. Poses assumidas + refinamento por consistência (6.5° → 4.7°) mantêm-se. |
| Certificação | Pacote de revisão visual independente + folha de pontuação; calibração de tolerâncias passa a distinguir contornos automáticos de ajustados à mão | `visual-review/`; `PRODUCT_PATH_ASSISTED_ERROR`. |

## Critérios de aceitação
| # | Critério | Estado |
|---|---|---|
| 1 | Percepção | **Parcial:** objecto único, fundos complexos com assistência, poses assumidas/refinadas, qualidade e cobertura, estratégia. Falta categoria semântica, landmarks genéricos, segmentação aprendida, leitura com Muse Spark (sem chave). |
| 2 | Geometria | **Parcial:** medida contra 3D em renders (clean e fundo real); fotografias de câmara sem 3D de referência: **não validado**. |
| 3 | Multivista | **Cumprido (âmbito restrito).** |
| 4 | Arquitectura | **Cumprido:** Core → ledger → plano → seam; sem grafo paralelo. |
| 5 | Visual | **Parcial:** sem mapas de normais/PBR por região sustentados por evidência, sem LOD, sem GPU real, sem revisão independente. |
| 6 | Refinamento | **Cumprido (âmbito restrito);** linguagem natural via Meta não validada. |
| 7 | Integração | **Cumprido:** 8 objectos × 19/19 E2E + captura em fundo complexo 7/7. |
| 8 | Regressão | **Cumprido:** 2729 testes passam (3 falhas só como root); `final-certification` 20/20. |
| 9 | Evidência | **Cumprido (reprodutível).** Revisão humana independente: **pendente**. |
| 10 | Estabilidade | **Parcial** (sem longa duração nem GPU real). |

## Categorias certificadas
Nenhuma é "fiel". "Parcialmente verificada", âmbito exacto: multivista de objecto único, 8 vistas de volta de mesa, elevação declarada, **em renders** de activos licenciados; automático em fundo liso (aceitação 6/8 reconstruídos, Chamfer 1.45–3.62%) e com contornos ajustados à mão sobre fundos reais (aceitação 8/8, 1.96–3.12%, **protocolo de utilizador simulado**). Fotografia real de objecto, vídeo, desenho técnico, arquitectura, anatomia, imagem única não-veículo: **não certificadas**.

## Bloqueios e verificações pendentes (não inventadas)
1. Fotografias reais de objectos **com 3D de referência** (scan/CAD): inexistentes aqui; Wikimedia bloqueada pela rede.
2. Revisão visual humana independente: pacote pronto (`visual-review/`), sem revisor.
3. GPU real e FPS; dispositivos móveis.
4. Muse Spark ao vivo (sem `MODEL_API_KEY`): leitura semântica e refinamento por linguagem natural não validados.
5. Utilizadores reais no editor de contorno (o esforço medido é simulado com oráculo).
6. SfM/MVS/neuronal em fotografias reais de objectos: não avaliados.
Condições para a Fase 02: os itens 1, 2, 5 e a decisão sobre o significado das partes.

## Testes e commits
+115 testes (2614 → 2729). E2E: BoomBox, CesiumMilkTruck, AntiqueCamera, Avocado, Corset, MaterialsVariantsShoe, ChairDamaskPurplegold, IridescenceLamp (19/19 cada), captura em fundo complexo (7/7), `final-certification` (20/20). Zero chamadas pagas.

---
# Histórico: avaliação anterior
## (relatório anterior) Fase 01 — relatório consolidado

Branch `claude/unfold-fase-01-reality-engine-lvhbn9` (sem merge em `produto`). Documentos anteriores: `CP0-AUDIT.md`, `CP1-ACCEPTANCE.md`. Benchmark e protocolo: `benchmark/README.md`.

## 8. Estado final: **NO-GO** para a Fase 01 integral

Existe uma capacidade nova, integrada e medida: **reconstrução multivista de um objecto único sobre fundo liso** (várias imagens, vídeo de uma volta, ou três vistas de desenho técnico), no `/living`, sobre o mesmo Spatial Core. Está certificada **só** como "reconstrução parcialmente verificada" e **só** para o âmbito exacto da secção 6. Os critérios eliminatórios abaixo (secção 8.1) não estão cumpridos, por isso a fase não recebe GO nem apresenta o resultado parcial como conclusão.

### 8.1 Critérios de aceitação (honestos)
| # | Critério | Estado | Nota |
|---|---|---|---|
| 1 | Percepção | **Parcial** | Segmentação de objecto único sobre fundo liso, poses assumidas com direcção e refinamento por consistência, contornos visíveis, pressupostos escritos, recusas fail-closed. **Não feito:** categoria semântica, landmarks além de rodas de veículo, segmentação em fundo complexo, leitura semântica com Muse Spark (sem chave: bloqueado). |
| 2 | Geometria | **Parcial** | Medida contra 3D real em renders (secção 2). Fotografias de câmara: **não validado**. Imagem única fora de veículos: continua conceptual (IA). Arquitectura/anatomia: não tocadas. |
| 3 | Multivista | **Cumprido (âmbito restrito)** | O erro desce com o número de vistas e o IoU retido sobe (secção 3.1); vista redundante é detectada e não altera o sólido. |
| 4 | Arquitectura | **Cumprido** | `src/core` (evidência, fidelidade) → ledger sobre `SpatialPlanV2` → seam de geometria; sem segundo grafo de cena; transacções/undo existentes. |
| 5 | Visual | **Parcial** | Regiões não vistas visíveis (azul-acinzentado), cor derivada das vistas, orçamento de triângulos com degradação declarada. **Não feito:** mapas de normais/tangentes derivados, PBR por material, LOD contínuo, medição de FPS em GPU real, avaliação visual independente. |
| 6 | Refinamento | **Cumprido (âmbito restrito)** | Acrescentar vista com pré-visualização → aplicar → desfazer/refazer, ids e transformações preservados, versões persistidas. Pedido em linguagem natural via Meta: caminho existente, **não validado** (sem credenciais). |
| 7 | Integração | **Cumprido** | E2E no `/living` em 3 objectos + vídeo + caso negativo (secção 4). |
| 8 | Regressão | **Cumprido** | `npm test` 2705 passam; `final-certification.pw.ts` 20/20. 3 falhas = ambiente root (passam como não-root). |
| 9 | Evidência | **Cumprido** | Tudo reproduzível por scripts; manifest com sha256, autoria, licença. |
| 10 | Estabilidade | **Parcial** | Limites declarados; geometrias GPU libertadas ao sair (15→4 num camião de 12 partes). Sem teste de longa duração nem GPU real. |

## 1. Sistemas implementados e integrados
```
entrada (N fotos | vídeo | 3 vistas de desenho)            src/living/reality/intake.ts, intake-panel.ts
  └ segmentação genérica + credibilidade (fail-closed)         segmentGeneric, segmentationCredibility
  └ enquadramento partilhado, poses 'assumed'|'given',         intakeOrbit, intakeDrawing, intakeAddView
    sentido da volta por evidência, pressupostos escritos
RealityEvidence (máscaras RLE, poses, cores RGB565, hash)     src/living/reality/evidence.ts  (a evidência original é o que se guarda)
  └ refinamento de poses (porta: só se a concordância sobe)    compute.ts / multiview.ts refinePoses
  └ casco visual contínuo (campo = máx. das distâncias         src/universal-spatial/reconstruction/multiview.ts
    assinadas 2D) + partes (watershed com persistência)          parts.ts
  └ cascas fechadas por parte + cor só de píxeis bem dentro     src/living/reality/model.ts
    da silhueta + visibilidade por vértice
SpatialPlanV2 (1 componente por parte, ids estáveis,          src/living/reality/plan.ts
  proveniência inferred/unknown) ── Spatial Core existente
RealityGeometry (seam: malha da parte no grupo do componente) src/living/reality/geometry.ts
Ledger + fidelidade em 4 classes (Core)                       src/core/evidence.ts, fidelity.ts; universal-spatial/reality-ledger.ts
Revisão: comparar com a referência, evidência por componente, src/living/reality/review-panel.ts, refine.ts, host.ts, store.ts
  pré-visualizar vista nova, aplicar, desfazer/refazer
Worker (cancelável, 1 job)                                    compute.ts, reality.worker.ts
```
Também corrigido: custo do fitting de veículos (112 s → 34 s; causa: texturas PBR regeneradas a cada avaliação) e as 5 falhas do baseline (CP1).

**`/living` usa os motores integrados — confirmação.** O botão «Reconstruir de várias vistas» está no ecrã de novo espaço (`SpaceFlow`), a revisão é a revisão ordinária, a construção usa `PlanSpaceLayer` com o seam `RealityGeometry`, as edições passam por `applyEdit`/transacção/undo do servidor, guardar/reabrir usa `SpaceStore` + evidência com versões. Não existe viewer alternativo. Os exemplos preparados continuam disponíveis e rotulados; nenhum é usado neste percurso.

## 2. Qualidade geométrica comprovada (e o que não está)
Contra **ground truth 3D** de activos licenciados, **em renders** (não fotografias).

### 2.1 Caminho do produto — renders em perspectiva, contorno automático, azimutes assumidos, elevação declarada, 8 vistas de volta de mesa
| split | objecto | categoria | Chamfer % diag | IoU retido | resultado |
|---|---|---|---|---|---|
| dev | Lantern | mecânica | 1.07 | 0.859 | reconstruído |
| dev | BoomBox | mecânica | 1.46 | 0.892 | reconstruído |
| dev | CesiumMilkTruck* | mecânica | 3.10 | 0.887 | reconstruído (11 partes) |
| dev | WaterBottle | não mecânica | 1.62 | 0.905 | reconstruído |
| dev | SheenChair | não mecânica | 2.39 | 0.865 | reconstruído |
| dev | ToyCar | mecânica | — | — | **recusado** (objecto sobre tecido: contorno não credível) |
| acc | AntiqueCamera | mecânica | 1.82 | 0.827 | reconstruído |
| acc | IridescenceLamp | mecânica | **3.62** | 0.853 | reconstruído (acima do máx. de desenvolvimento 3.10) |
| acc | CarConcept | mecânica | — | — | **recusado** (contorno fragmentado) |
| acc | Avocado | não mecânica | 1.45 | 0.915 | reconstruído |
| acc | ChairDamaskPurplegold | não mecânica | 2.38 | 0.860 | reconstruído |
| acc | MaterialsVariantsShoe | não mecânica | 2.20 | 0.889 | reconstruído |
| acc | Corset | não mecânica | 2.73 | 0.886 | reconstruído |
| acc | GlamVelvetSofa | não mecânica | — | — | **recusado** (contorno fragmentado) |

*movido de aceitação para desenvolvimento após revelar uma fraqueza de segmentação (benchmark/README.md).
Aceitação: 6 de 8 reconstruídos (taxa de recusa 25%); Chamfer médio 2.37%, mediana 2.29%; IoU retido médio 0.872. Desenvolvimento: 5 de 6; Chamfer médio 1.93%.
**Os 3 recusados são o comportamento previsto (fail-closed), não sucessos.**

### 2.2 O que NÃO está provado
- **Fotografias reais de câmara**: nenhuma tem 3D de referência aqui. O erro numa fotografia é desconhecido e o painel diz-o.
- **"Fiel"**: nunca atribuído a vistas do utilizador (referência não independente do capturador). Só seria possível com ground truth 3D ou consistência multivista independente com ≥3 vistas.
- **IoU de silhueta não é exactidão 3D.** O IoU retido prova concordância entre vistas; a exactidão 3D é o Chamfer.
- **Superfícies não observadas**: o casco é um limite superior (concavidades preenchidas). Medido no camião: 41–44% da superfície é vista por alguma vista; o resto aparece como hipótese.
- **Ambiguidade de espelho**: a elevação 0° não distingue um objecto do seu espelho (verificado por teste com objecto quiral e declarado ao utilizador); com câmara elevada o sentido é escolhido pela evidência.
- Estruturas mais finas que ~2 voxels e aberturas de pegas pequenas são perdidas ou preenchidas; transparência e reflexo (lâmpada de vidro: 3.62%) pioram o resultado.

## 3. Benchmarks antes/depois (mesmas entradas, mesmas condições)
### 3.1 Mais evidência → melhor resultado (renders ortográficos, câmaras conhecidas; `results/results.json`)
| vistas | dev Chamfer médio | dev IoU retido | acc Chamfer médio | acc IoU retido |
|---|---|---|---|---|
| 1 (antes: o que uma imagem sozinha suporta) | 8.33% | 0.396 | 9.68% | 0.359 |
| 2 | 1.72% | 0.848 | 2.36% | 0.794 |
| 3 (ortogonais) | 1.36% | 0.900 | 1.74% | 0.882 |
| 6 | 1.31% | 0.911 | 1.69% | 0.902 |
| 12 | 1.21% | 0.943 | 1.34% | 0.948 |
A segunda vista é a que mais pesa (profundidade observada). Em média, o IoU retido sobe com o número de vistas nos dois splits.

### 3.2 Mudança de algoritmo (voxels+blur → campo contínuo), mesmas entradas (12 vistas; os 10 activos da primeira corrida, com as etiquetas de split dessa altura)
IoU retido médio: dev 0.880 → 0.937, acceptance 0.844 → 0.950; Chamfer médio: dev 1.29 → 1.13, acceptance 1.40 → 1.17. Maior ganho em estruturas finas: AntiqueCamera 0.564 → 0.871. (Escolha feita no desenvolvimento; a aceitação confirmou.)

### 3.3 Outros
| Medida | Antes | Depois |
|---|---|---|
| Fitting de veículos, ficheiro de testes | 112 s, 2 timeouts | 34 s, 12/12 |
| Custo por avaliação do fitting | ~370 ms | ~50 ms |
| Pose: erro médio de azimute com ~6.5° de erro nominal (14 objectos) | 6.5° | 4.7° (melhora 10/14; 2 simétricos não identificáveis, mantidos; piora ligeiramente 2 — por isso o refinamento só é aceite se a concordância entre vistas sobe) |
| Pipeline do sistema anterior sobre as mesmas entradas | requer plano da Meta (sem chave: **não medível aqui**) | — |
O sistema anterior não tinha caminho multivista; comparar com ele nestas entradas exigiria chamadas pagas que não foram feitas.

## 4. Evidências visuais (reais, não fixtures)
`board-BoomBox.png`, `board-AntiqueCamera.png`, `board-CesiumMilkTruck.png` (entradas à esquerda, Space reconstruído no `/living` à direita); `e2e*/0*.png` (intake, revisão, Space, pré-visualização de refinamento, refinado, reaberto, vídeo, **recusa**). As imagens de entrada são renders texturados com perspectiva de activos licenciados.
Leitura honesta: BoomBox e AntiqueCamera são reconhecíveis (corpo, tripé, cores vindas das vistas) mas faltam asa, antena e foles; o camião de leite sai **mau** (placas "em camadas", 41–44% de superfície vista, vistas só a 20° sem topo): é o limite superior real com esta evidência, mostrado como tal. Avaliação visual independente: **não existe** (único revisor: o implementador).

## 5. Testes, segurança e desempenho
- Testes: +91 (2614 → 2705 passam; 172 → 185 ficheiros). Escritos primeiro e vistos falhar: evidência, fidelidade, custo de fitting, hull, partes, intake, refinamento, host, cascas, guardas. A suite apanhou, depois de escrita, um defeito real de cascas por parte (cada parte desenhava uma pele do objecto inteiro) — corrigido com teste de regressão.
- E2E (Chromium/SwiftShader): `tests/e2e/reality-engine.pw.ts` 19/19 para BoomBox, CesiumMilkTruck, AntiqueCamera; `final-certification.pw.ts` 20/20 (sem regressões).
- Chamadas pagas: 0 (contador do duplo = 0; nenhum pedido de plano ao modelo). `MODEL_API_KEY` não tocada.
- Entradas: tipo/tamanho (≤10 MB), dimensões lidas do cabeçalho **antes** de descodificar (≤40 MP), ≤24 vistas, vídeo ≤40 MB/60 s, redução a ≤640 px, evidência validada por contrato e com soma de verificação em cada leitura; evidência ou plano adulterado é recusado.
- Desempenho (CPU, sem GPU): reconstrução 1.3–2.0 s por objecto (Worker no browser, cancelável), ~20k triângulos típicos, orçamento 160k com degradação **declarada**; benchmark pico 421 MB RSS. Não medido: GPU real, dispositivos móveis, longa duração.
- Riscos: `localStorage` não cifrado e limitado (versões ≤6); a segmentação por cor de fundo falha com fundos complexos ou objecto da cor do fundo (recusa em vez de falso sucesso); um contorno corrigido à mão para este caminho não existe ainda.

## 6. Categorias efectivamente certificadas
| Categoria / modalidade | Estado | Âmbito exacto |
|---|---|---|
| Objectos mecânicos, multivista (≥8 vistas em volta de mesa, fundo liso, elevação declarada) | **Certificada: parcialmente verificada** | Renders; acc 1.82–3.62% Chamfer (2 de 3 reconstruídos). Foto real não validada. |
| Objectos não mecânicos do quotidiano, multivista (idem) | **Certificada: parcialmente verificada** | Renders; acc 1.45–2.73% (4 de 5 reconstruídos). Foto real não validada. |
| Qualquer categoria "fiel" | **Nenhuma** | Sem ground truth 3D independente em fotografias. |
| Veículo, uma só fotografia (fitting existente) | Inalterada: aproximação/parcial (IoU 0.69–0.81, um anotador) | CP0. |
| Vídeo de uma volta | Funcional, **não certificada** | E2E sobre vídeo gravado de render; sem métrica contra 3D. |
| Desenho técnico (3 vistas) | Funcional, **não certificada** | Só testes sobre sólido sintético; sem desenhos reais. |
| Arquitectura/plantas, anatomia, imagem única não-veículo | **Não certificadas** | Não tocadas nesta fase. |

## 7. Limitações e bloqueios
- Bloqueado (ambiente): sem `MODEL_API_KEY`/orçamento → sem Muse Spark ao vivo; sem GPU; Wikimedia Commons inacessível (política de rede) → conjunto de renders de activos Khronos em vez de fotografias; sem anotador independente; sem avaliador visual independente.
- Não implementado: mapas de normais/tangentes derivados de evidência, materiais PBR por região, LOD contínuo, landmarks genéricos, segmentação aprendida para fundos complexos, contorno corrigido à mão no caminho multivista, elevação/roll/FOV/escala **medidos** (continuam UNKNOWN; elevação é declarada pelo utilizador), reconstrução de plantas/arquitectura, refinamento por linguagem natural validado.
- Defeitos conhecidos: partes por watershed são hipótese de estrutura (um camião sai em 11 partes sem significado); sem vista de topo/baixo o casco "levanta" tampas (camião); thin parts perdidas.
- Ambiente: 3 testes (`spatial-persistence-failures` ×2, `spatial-review-binding-transition` ×1) falham como root e passam como `nobody`.

## 9. Branch e commits
`claude/unfold-fase-01-reality-engine-lvhbn9`: 5cea433 (CP0 auditoria), 8f45069 (CP1 contratos de evidência, fidelidade, custo do fitting), 0767b4f (núcleo multivista, intake, partes, plano/seam, benchmark), 62c11ad (percurso `/living`, campo contínuo, refinamento, Worker, E2E), ae614c7 (avaliação do caminho do produto, segmentação genérica, cascas por parte, guardas) e o commit deste relatório. Sem merge, sem PR.

## 10. Condições para iniciar a Fase 02
1. Validar o caminho multivista em fotografias reais com referência 3D independente (scan ou CAD) — sem isso nenhuma categoria sobe de "parcialmente verificada".
2. Segmentação robusta fora de fundo liso (modelo local validado + contorno corrigido à mão neste caminho).
3. Avaliação visual por pessoa independente das capturas e do camião de leite.
4. Decidir o destino das partes (nomear/fundir em revisão; hoje são só geometria).
5. Medição em GPU real e orçamento de desempenho por dispositivo.
O contrato estrutural (ids estáveis, transformações, proveniência, versões da evidência, pontos de preparação) está pronto para a Fase 02 consumir; nada de movimento funcional foi implementado.

## 11. Continuação (12 nov) — validação, componentes, reconstrução, Visual Foundry

**Estado: NO-GO mantido.** Esta secção só afirma o que foi medido; cada número tem o ficheiro que o gerou em `reports/reality-engine/benchmark/`.

### 11.1 Validação da segmentação (prioridade 1)
- **A interrupção da última avaliação** ("Execution context was destroyed") não era do pipeline: o servidor Vite da avaliação tinha HMR/watch e recarregava a página de render quando eu escrevia ficheiros ou usava `git stash` durante a corrida. Corrigido (`hmr:false, watch:null`); a avaliação completa corre agora de ponta a ponta (14 activos).
- **Referência independente:** o alpha exacto do renderizador (nenhum algoritmo de segmentação o vê). Entradas: renders dos 14 activos sobre fotografias reais em três condições — `fixed` (um fundo por captura), `varied` (um fundo diferente por vista, volta à mão), `degraded` (varied + exposição, ruído, desfoque). Scripts: `segmentation-validation.ts` (browser, rede ao vivo), `seg-composites.py` + `seg-cached.ts` (cache, iteração rápida), `product-eval-cached.ts` (caminho de produto de ponta a ponta).
- **Resultado (política final do produto, `segmentation-cached.json`):**

| condição | vistas | IoU médio dos contornos aceites | aceites errados (IoU < 0,8) | melhor escolha possível entre os mesmos candidatos |
|---|---|---|---|---|
| fixed | 112 | **0,754** (era 0,610 antes de esta sessão) | 48% | 0,815 |
| varied | 109 | 0,606 | 59% | 0,642 |
| degraded | 109 | 0,590 | 67% | 0,614 |

  A segmentação automática **continua insuficiente fora de câmara fixa**: com fundo a mudar, mais de metade dos contornos aceites estão errados e nem a escolha óptima entre candidatos (oráculo) o resolve — o conjunto de candidatos é que não chega. Alternativas medidas e rejeitadas (`segmentation-candidates.json`, 56 vistas): U²-Net-P 0,49; SAM ViT-B com caixa larga 0,42; SAM caixa+ponto 0,51; GrabCut com caixa central 0,48–0,51; escolha de candidato por concordância geométrica com o casco das outras vistas: **AUC 0,23–0,31 (pior que o acaso)**, porque os erros são consistentes entre vistas (o mesmo objecto saliente de fundo) e o casco de uma região estática é um prisma perfeitamente "consistente". Não foi adoptada.
  Também testada e **retirada**: co-segmentação multivista (mapas de saliência elevados a um volume por votação leave-one-out com tolerância a vistas dissidentes, reprojectados e refinados por graph cut; entrada oráculo → 0,84–0,90 de IoU final, por isso a geometria está correcta). Com os mapas reais da rede, em `varied` (5 activos): 0,56 de IoU médio contra 0,59 da política actual — ganha onde mais de metade das vistas acertam (SheenChair 0,59→0,72, BoomBox 0,66→0,73) e perde onde acertam menos (ToyCar 0,62→0,28 a 0,65 conforme a tolerância). Sem ganho médio, sem critério fiável para saber em que caso se está: não integrada.
- **Melhorias adoptadas (medidas):** (1) fundo estático passa a ter prioridade quando credível (0,61 → 0,75 em `fixed`); (2) o fundo estático já não declara fundo as ilhas estáticas encerradas pelo objecto nem os pixels estáticos junto dele, e re-estima o fundo por pixel nas vistas onde ficou descoberto (teste sintético com referência exacta: 0,75 → 0,92 de IoU médio).
- **Segurança do resultado (`product-eval-cached.json`, caminho de produto):** em `varied` 2 de 14 recusados e 3 `partially_verified`; em `degraded` 3 recusados e 1 `partially_verified`; **nenhum** resultado com geometria má (> 6% da diagonal) foi chamado `partially_verified` nessas condições. Em `fixed` 12/14 são `partially_verified` e um deles (AntiqueCamera, 6,1%) tem geometria má: concordância entre vistas não prova forma quando todos os contornos erram da mesma maneira. **Nenhum contorno automático recebe agora tolerância de erro** (`outlineMethod` registado na evidência; só contornos de cor clássica em fundo liso ou confirmados à mão a recebem).
- **Confirmação humana rápida:** cada contorno automático credível tem agora «O contorno está certo»; só essa vista passa a `confirmed` (E2E mede 1 confirmada, 7 automáticas), as categorias nunca se misturam.
- **Corrigido:** contornos inconsistentes esvaziavam o casco e o construtor do plano falhava com `SPATIAL_V2_PLAN_INVALID_FIELDS` (teste falhou primeiro). Agora `REALITY_EMPTY_RECONSTRUCTION` com mensagem a dizer que há contornos errados.
- Fora do âmbito sintético: **fotografias reais de objectos em fundo real com contorno de referência** continuam a ser a validação que falta (só há 1 conjunto pequeno em `tests/fixtures/photos-real`).

### 11.2 Compreensão das peças (prioridade 2)
Harness `component-eval.ts` no caminho de produto (8 renders, contornos exactos), dois referenciais: **nós glTF** (decisão do autor; muitas vezes são grupos de material, não peças) e **cascas físicas** (componentes conexos de cada nó, mais próximo de "peça física"). Métricas só em voxels a ≤ 1,5 voxel da superfície GT. `reconstruction/appearance-parts.ts`, `reconstruction/multiview-parts.ts` (propostas SAM elevadas a 3D por afinidade Jaccard ponderada) e uma decomposição convexa aproximada (só no harness) foram medidos:

| método | nós (dev / acc recuperadas) | cascas (dev / acc recuperadas) | ARI cascas acc | pureza cascas acc |
|---|---|---|---|---|
| watershed (actual) | 7/11 · 8/27 | 6/18 · 4/45 | 0,042 | 0,491 |
| cor (2-means por parte) | 7/11 · 10/27 (ARI acc 0,53→0,31) | 6/18 · 6/45 | 0,106 | 0,511 |
| SAM elevado a 3D | 5/11 · 6/27 | 5/18 · 4/45 | 0,101 | 0,541 |
| cor ∧ SAM (consenso) | 7/11 · 9/27 | 6/18 · 5/45 | 0,062 | 0,508 |
| decomposição convexa (τ 0,10) | 5/11 · 6/27 | **8/18 · 6/45** | 0,146 | 0,556 |

**Conclusão honesta:** nenhum método melhora os dois referenciais; os ganhos num referencial são perdas no outro (a cor e a decomposição convexa dividem peças que o autor modelou como um só nó). Nenhum foi ligado por defeito. O limite é estrutural: um casco de silhuetas funde o que está entre pernas/braços e os nós GT misturam material com forma. Recuperação de peças continua **7/25 nos activos de aceitação com o watershed e sem método melhor demonstrado**; as partes continuam apresentadas como hipótese editável (rever/renomear/fundir). Um referencial de peças com anotação humana independente é dependência externa.

### 11.3 Para além do casco (prioridade 3)
- **Câmara perspectiva** (`orbitPinhole`, FOV estimado por concordância held-out; renders a 40° e 65°, `recon-perspective-fov*.json`): com o FOV verdadeiro a mediana do chamfer desce 23% (40°) / 28% (65°); com o FOV **estimado** só 17% / 8% (a concordância held-out é um mau selector em vários activos). Com portão de 0,04 de ganho de concordância não piorou nenhum activo a 65° (4 melhores, 0 piores) mas o ganho médio é ~5% (≈0,15 pontos percentuais da diagonal). **Não integrado** (tocaria cor, visibilidade, refinamento e revisão, todos ortográficos, por um ganho dentro do ruído). O benchmark só tinha FOV 12°; passa a ter 12°, 40° e 65°, e a hipótese ortográfica custa ≤ 3,5% da diagonal até 65°.
- **Carving por foto-consistência** (`reconstruction/photo-carve.ts`, `carve-fov12.json`): mediana do chamfer 2,00 → 2,00–2,03 (variantes), com perdas em WaterBottle. Sem ganho demonstrável; **não integrado**.
- O casco continua o motor; nenhum motor redundante foi introduzido. Câmaras pinhole calibradas (DTU/ETH3D) continuam suportadas e testadas com dados sintéticos.

### 11.4 Visual Foundry e editor (prioridade 4)
- **LOD** (`lod.ts`): agrupamento de vértices, erro medido e limitado pela célula (deslocamento máximo ≤ diagonal da célula, verificado em teste), nada inventado (`observed`, cores dentro do intervalo, vértices dentro da caixa original). O palco usa um nó `LOD` para cascas grandes e o relatório do `RealityGeometry` indica níveis, triângulos e erro (% da diagonal da parte).
- **Material:** o acabamento brilhante (clearcoat) inventava reflexos que nenhuma fotografia mostrou; passou a mate (`roughness 0,92`, `metalness 0`, `clearcoat 0`) com a base declarada em `userData.realityMaterialBasis` ("assumed-matte"). **Não há materiais PBR fundamentados**: as fotografias não medem reflectância, e a cor amostrada tem a iluminação cozida.
- **Normais:** auditoria em teste (unitárias, finitas, concordam com o enrolamento, volume com sinal positivo) — passa em todas as cascas.
- **Editor, medido (não só presença de elementos):** nomes acessíveis, contraste ≥ 4,5:1 calculado a partir dos estilos (pior 6,24:1), alvos ≥ 24 px, 25 paragens de Tab com indicador de foco, sem sobreposição nem oclusão (`elementFromPoint`) e área de desenho ≥ 240×240 a 1500×1000, 1280×680 e 390×800. A medição apanhou **três defeitos reais** que a inspecção anterior não viu: barra de ferramentas a sobrepor o rodapé, a doca do prompt a cobrir «Calcular/Usar este contorno» e o canvas colapsado a 0 em ecrã de telemóvel (+ raio de círculo negativo com canvas pequeno: teste falhou primeiro). Corrigidos; capturas em `reports/reality-engine/e2e-capture/02f-*.png`.

### 11.5 Datasets externos (preparado, não executado)
`scripts/datasets/`: split congelado por função pura do nome (`splits.json`, teste que o recalcula), carregador de directoria de scan + avaliação pinhole (`scan-directory.ts`, `dataset-eval.ts`, testados com um scan sintético escrito e lido do disco), protocolo e README. **Licenças não afirmadas** (marcadas UNVERIFIED); **os datasets não foram descarregados** (política de rede). Nenhum número DTU/ETH3D existe.

### 11.6 Dependências externas que continuam a bloquear a decisão de aceitação
1. DTU/ETH3D (rede) · 2. fotografias reais de objectos com contorno de referência em fundos reais variados · 3. anotação humana independente de peças · 4. revisão visual por pessoa independente · 5. GPU real e orçamento por dispositivo · 6. (opcional) SAM de produção no servidor: o encoder ViT-B tem 359 MB e não serve no navegador.

### 11.7 Ambiente
`npm test`: 3 falhas, as mesmas de sempre (`spatial-persistence-failures` ×2, `spatial-review-binding-transition`), falham igualmente sem as minhas alterações porque o contentor corre como root. `npm run build` passa.
