# UNFOLD — Fase 01: Reality Engine — relatório consolidado

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
