# Dívida técnica do Reality Engine — encerramento da Fase 01

Gerado por `npx tsx scripts/reality-debt-report.ts` a partir de `src/living/reality/debt.ts` e dos ficheiros de medição; um teste verifica que este ficheiro coincide com o gerado. **Um item só passa a «cumprido» quando o ficheiro de medição indicado for regenerado pelo script indicado e o critério se verificar.** Itens sem medição possível são «bloqueados» e nunca «cumpridos».

| # | Prioridade | Dívida | Critério de resolução | Valor actual | Estado |
|---|---|---|---|---|---|
| D1-geometry-real-photos | 1 | Fidelidade geométrica em fotografias reais contra referência 3D independente | <= 3 (% da diagonal, chamfer oficial em scans de aceitação DTU/ETH3D) | — | **blocked** — depende de: download dos datasets (ficheiros locais) e script oficial de avaliação |
| D2-outline-handheld | 1 | Contornos automáticos errados com fundo a mudar | <= 0.2 (fracção de contornos aceites com IoU < 0,8) | 0.587 | **open** |
| D3-outline-fixed | 1 | Qualidade do contorno automático com câmara fixa | >= 0.85 (IoU médio dos contornos aceites) | 0.754 | **open** |
| D4-parts-physical | 1 | Recuperação de peças físicas sem correcção humana | >= 0.6 (peças significativas recuperadas (IoU ≥ 0,5), activos de aceitação) | 0.089 | **open** |
| D5-parts-nodes | 2 | Recuperação de peças contra os nós do activo | >= 0.6 (peças significativas recuperadas, activos de aceitação) | 0.296 | **open** |
| D6-hull-accuracy | 1 | Exactidão do casco com contornos confirmados | <= 2 (% da diagonal, chamfer mediano) | 2.572 | **open** |
| D7-camera-estimation | 2 | Estimação do campo de visão a 65° | >= 0.15 (redução relativa do chamfer mediano) | 0.091 | **open** |
| D8-human-evaluation | 1 | Avaliação humana independente | >= 3 (avaliadores independentes por scan) | — | **blocked** — depende de: pessoas independentes (reports/reality-engine/HUMAN-EVALUATION-PROTOCOL.md) |
| D9-materials-grounded | 3 | Materiais PBR fundamentados em evidência | >= 0.7 (correlação com os factores de material do GT) | — | **blocked** — depende de: método de estimação ainda não existe (investigar com referência de material) |
| D10-device-budget | 3 | Orçamento de desempenho em GPU real por dispositivo | <= 16.7 (ms por fotograma no dispositivo-alvo) | — | **blocked** — depende de: GPU real |
| D11-structure-on-built-space | 2 | Alterar a estrutura de um Space já construído | >= 1 (operações add/remove-component existem (1 = sim)) | 0.000 | **open** |

## Porquê cada uma importa
- **D1-geometry-real-photos** — Todo o benchmark é de renders; nenhuma afirmação sobre fotografias é sustentada.
- **D2-outline-handheld** — Sem câmara fixa a automação é insuficiente; obriga a confirmação vista a vista. Medição: `reports/reality-engine/benchmark/segmentation-cached.json`, regenerada por `scripts/benchmark/seg-cached.ts`.
- **D3-outline-fixed** — O caminho automático mais favorável ainda erra quase metade das vistas. Medição: `reports/reality-engine/benchmark/segmentation-cached.json`, regenerada por `scripts/benchmark/seg-cached.ts`.
- **D4-parts-physical** — A estrutura automática é hipótese; só a correcção assistida atinge valores úteis. Medição: `reports/reality-engine/benchmark/components-product-shells.json`, regenerada por `scripts/benchmark/component-eval.ts --gt shells --near 1.5`.
- **D5-parts-nodes** — Referencial do autor; mede a coincidência com a decomposição humana original. Medição: `reports/reality-engine/benchmark/components-product.json`, regenerada por `scripts/benchmark/component-eval.ts --gt nodes --near 1.5`.
- **D6-hull-accuracy** — O casco é limite superior; o erro mediano ainda é maior que o objectivo de uma reconstrução fiel. Medição: `reports/reality-engine/benchmark/product-results-realbg/product-results.json`, regenerada por `scripts/benchmark/reality-product-eval.ts`.
- **D7-camera-estimation** — O ganho com a câmara verdadeira é maior do que o que a estimação recupera. Medição: `reports/reality-engine/benchmark/camera-eval.json`, regenerada por `scripts/benchmark/camera-eval.ts`.
- **D8-human-evaluation** — Requisito de aceitação que não pode ser simulado.
- **D9-materials-grounded** — A reflectância não é medida; o material é mate assumido.
- **D10-device-budget** — Medições feitas em renderização por software.
- **D11-structure-on-built-space** — O Spatial Core não tem operações de acrescentar/remover componentes. Medição: `src/universal-spatial/contracts-v2.ts`.
