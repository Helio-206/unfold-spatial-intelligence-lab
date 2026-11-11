# Reality Engine, Fase 01 — Checkpoint 0: auditoria e baseline

Branch: `claude/unfold-fase-01-reality-engine-lvhbn9` (idêntica a `produto` @ c35ce94; sem PRs/branches não integrados: só existem `produto` e esta).
Nenhum código de produto foi alterado neste checkpoint.

## Baseline reproduzível (Linux, root, CPU lenta, sem GPU)
| Verificação | Resultado |
|---|---|
| `npm run build` (tsc + vite) | passa |
| `npx vitest run` | 2614 passam, 5 falham (3 ficheiros) |

Falhas (todas pré-existentes e ambientais, não regressões):
- `spatial-persistence-failures` (2) e `spatial-review-binding-transition` (1): simulam falha de disco com `chmod 0555`; o utilizador é root (uid 0), por isso a escrita nunca falha. Não é defeito do código; validar como não-root.
- `universal-foundry-fitting` (2: determinismo, controlo negativo de cor): excedem o timeout de 5 s do vitest; o fitting corre ~50 s aqui (o relatório de certificação regista 15–20 s no Worker). Passam em máquina rápida; aqui ficam por validar.
Não foram marcados como skip nem alterados.

## Estado dos motores (o que existe)
- Core de proveniência: `src/core/provenance.ts` (origins observed/heuristic/model_inferred/human_entered/derived/solver/fixture/synthetic/unknown + validation). Não tem os rótulos OBSERVED/MEASURED/INFERRED/APPROXIMATED/UNKNOWN pedidos; há mapeamento parcial por `InformationCategory`.
- Spatial: SpatialPlanV2 + transacções/undo (`src/universal-spatial`, `src/living/spatial-space`).
- Foundry: `src/living/universal-foundry` (evidência de imagem, landmarks, fitting, Worker `fitting.worker.ts`, correcção de contorno).
- Reconstrução: `src/universal-spatial/reconstruction` e `src/living/reconstruction`.
- Benchmark fotográfico: `tests/fixtures/photos-real` (8 fotos de câmara, CC0/CC BY; anotações de um só anotador).

## Hipóteses do prompt vs. estado real
| # | Hipótese | Veredicto |
|---|---|---|
| 1 | Geometria conceptual demasiado simples | **Confirmada fora de veículos**: ajuste a evidência só existe para a família veículo; restantes categorias são composição por operadores (rotulada "conceptual"). |
| 2 | Câmara por heurística | **Parcialmente corrigida**: `estimateCamera` (landmarks.ts) usa excentricidade das rodas por foto e pixels reais. Mas só estima azimute, só para veículos em vista lateral; sem elevação/roll/FOV, vistas frontais/traseiras recusadas, sem equivalente para outras categorias. |
| 3 | Landmarks/fitting/Worker | **Integrados** para veículos (provider.ts → fitting.worker.ts). Só rodas como landmarks. |
| 4 | Exemplos vs. entradas do utilizador | Persistem: segmentação automática tem IoU 0.20–0.27 (clássico) e o modelo local 0.54–0.77, com recusa fail-closed; o bom resultado depende de máscara confirmada pelo utilizador. |
| 5 | Inconsistência geometria/apresentação | Não auditado ainda (CP1). |
| 6 | Validação insuficiente | **Confirmada**: IoU ajustado 0.69–0.81 (metas 0.82/0.88 não atingidas), um anotador, sem Chamfer/landmark/proporção/multivista/memória por categoria, sem ground truth 3D. |

Lacunas face à Fase 01 (nenhuma está implementada hoje): multivista (associar várias fotos / vídeo), desenho técnico → geometria fora de plantas, ledger de evidência com os cinco rótulos, classificação de fidelidade em 4 níveis (fiel / parcialmente verificada / aproximação conceptual / não validada), suite de métricas por categoria e modalidade.

## Limites desta sessão (declarados, não contornados)
- Sem `MODEL_API_KEY`/orçamento verificado: qualquer validação Muse Spark ao vivo fica **BLOQUEADA**; testes usam `fetch` simulado com contador.
- Sem GPU: desempenho de renderização só mensurável em SwiftShader.
- Sem ground truth 3D independente nem segundo anotador: Chamfer e erros dimensionais não são mensuráveis agora.

## Estado
GO/CONDITIONAL GO: **NO-GO** (por definição, a fase mal começou). Nada foi certificado.

## Proposta de checkpoints seguintes (a aprovar)
1. CP1 — contrato de evidência (`OBSERVED|MEASURED|INFERRED|APPROXIMATED|UNKNOWN` sobre a proveniência do Core, sem migração em massa) + classificador de fidelidade em 4 níveis, com testes a falhar primeiro.
2. CP2 — harness de métricas (IoU, landmarks, proporções, câmara, completude) por categoria/modalidade e baseline congelado das 8 fotos.
3. CP3 — câmara: elevação/roll a partir de evidência; multivista com redução de ambiguidade medida.
4. CP4 — ligação ao /living (revisão, comparação com a referência, regiões aproximadas) e E2E.
