# Spatial Fidelity V4 — transferência e integração

## Identidade e âmbito

Origem remota verificada: `feat/spatial-fidelity-v4@a5aa384281a826ca91d11845276df5338ac616a2`. Base comum com o PR #31: `4d383683dbdf5612f25531c44c3d536ea24500ec`. Commits originais em ordem: `9644be9` (A/primeira B), `697e867` (B), `7bf52ea` (C), `a5aa384` (D). Não existe PR publicado para esse head na consulta efetuada; não se integrou nem ativou V4. A referência do Claude é só leitura. Este documento prepara a integração; as medidas V4 aqui descritas são as reportadas pelo autor, não foram repetidas neste branch.

Fontes: `reports/fidelity-v4/PHASE-A.md` a `PHASE-D.md` no commit de origem, e `src/universal-spatial/reconstruction/` no mesmo commit. Os relatórios distinguem malhas CC0 conhecidas, planos sintéticos, planos guardados da Meta e fotografias reais; não há ground truth fotográfico do plano da escavadora nem evidência para atribuir fidelidade à fotografia original.

## Arquitetura existente

- `silhouette.ts` rasteriza vistas ortográficas calibradas e produz visual hull; `fit.ts` e `structural-fit.ts` fazem ajuste de posição/escala e constraints; `hierarchy.ts`/`hierarchical-fit.ts` compõem transformações locais e resolvem a hierarquia, incluindo rotação local na fase D.
- `engine.ts` devolve proposta ou recusa, com limites de componentes, avaliações, duração, melhoria e generalização, relações, partes não resolvidas e métricas. A entrada inclui máscaras e vistas; `evidence.ts` serializa dados de máscara. `relations.ts` separa declaração suportada, contradita, hipótese e confirmação declarada. Relações contraditas bloqueiam por defeito; o override não as impõe automaticamente.
- `shapes.ts` propõe alternativas primitivas para nós existentes; `unexplained.ts` assinala candidatos de regiões não explicadas, sem criar ou identificar peças; `diagnose.ts` testa limites de transformações. `glb-geometry.ts` é leitor de dados de benchmark, não intake de produção. `types.ts` descreve uma arquitetura proposta; `StructuralProposal.operations` é `unknown[]`, enquanto a proposta operacional de `engine.ts` usa `SpatialOperationV2[]`: não tratar a interface conceptual como contrato validado de produção.
- O único ponto de ligação adicionado no produto V4 é `PlanSpaceLayer.proposeSolverEdit`: valida operações numa cópia, apresenta proposta agrupada, exige autorização e suporta undo. Não altera automaticamente o plano. Uma decisão `user_provided` e `confirmed` é afirmada pelo cliente, não identidade humana autenticada nem prova física.

## Compatibilidade com o PR #31

Uma verificação não mutante `git merge-tree --write-tree 57467a1 a5aa384` terminou sem conflito textual; isto não certifica semântica e não inclui o commit de correção de shader posterior. A integração deve partir do head atualizado do PR #31 num branch independente, preservando os commits originais; não substituir ficheiros pelo snapshot V4 nem mexer no branch original.

O `layer.ts` do V4 adiciona fonte `solver`, `proposeSolverEdit`, pré-visualização, truncagem da evidência a 500 caracteres e limpeza da proposta no dispose. O PR #31 posterior à base acrescenta coalescência de upgrades, tratamento de cache e orçamento cooperativo no router, além de preservar `explanationVersion` para Voice. A correção de shader acrescenta libertação de materiais após render/timeout/dispose. Todos têm de coexistir; testar edição agrupada, cancelamento, undo, bloqueio da sessão, substituição V3, seleção, Director, Voice e recursos.

O V4 remove a rota `/universal-spatial-v2` e o respetivo harness/testes de V2. Essa remoção é alteração distinta do motor e deve ser revista explicitamente, não introduzida inadvertidamente numa simples integração. O V4 não muda `contracts-v2.ts`; o fluxo de relações confirmadas ainda não tem operação persistente de revisão no plano nem UI de produto. A fonte `human_confirmed` não garante autoria autenticada.

Riscos a resolver antes de ativação: execução do solver síncrona com teto declarado até 60 s não é garantia de responsividade; rever Worker/cancelamento e limites de custo; correlacionar proposta com Space e revisão para rejeitar resultados obsoletos; verificar transações de várias operações com falha parcial na sincronização do servidor e undo; associar máscaras/calibração à identidade e hash da fonte, visto que o contrato de evidência V4 contém `calibrated` declarado mas não o vínculo autenticado da imagem. Validar também a extração de triângulos para `InstancedMesh` (as matrizes de instância não são explicitamente aplicadas em `worldTris`), sem assumir equivalência com a cena renderizada.

## Plano da fase E — Geometry Reconstruction

1. Congelar fonte, hashes, calibração, permissões de uso e convenção de referenciais para exemplos reais. Onde faltam dados, marcar desconhecido; o plano guardado da escavadora serve para mecânica, não como referência fotográfica.
2. Exercitar `diagnoseContradictions`, `relations`, hierarquia e propostas existentes. A fase D reporta na cadeia lança–braço–balde três relações não fecháveis dentro dos limites testados; não implica impossibilidade fora desses limites nem autoriza alterar relações.
3. Definir corpos paramétricos locais e limitados para essa cadeia, com juntas/âncoras explícitas, parâmetros e unidades declaradas, formas substituíveis e limites de complexidade. Avaliar quais operadores V2 já servem antes de adicionar outros. Produzir apenas propostas `set-geometry`/`set-transform` tipadas, com proveniência inferida e revisão humana.
4. Projetar uma revisão explícita e persistente para relações contraditórias e candidatos em falta, com IDs de fonte/Space/revisão e confirmação atribuída honestamente; candidatos não são peças e não se tornam verdade por uma pontuação. O override deve continuar explícito e auditável.
5. Preservar operação agrupada, undo e cancelamento transacionais; impor limites de recursos e respeitar V2/V3 fallback, geometria, seleção, Director e Voice. Validar reconstrução após edição/undo e corridas assíncronas obsoletas.
6. Comparar progressivamente contra geometria conhecida e vistas não usadas no ajuste, depois contra evidência visual real licenciada/calibrada quando disponível, com comparação cega e mesma câmara/escala. Reportar falhas e peças invisíveis; não promover aproximações a precisão mecânica ou anatómica.

Não há implementação extensa da fase E neste branch, nenhuma ativação V4 por defeito, chamada paga ou merge.
