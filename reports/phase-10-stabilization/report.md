# PHASE 10 — Final Stabilization

**Branch:** `phase-10-mvp-stabilization`
**Base:** `62fe7eb118067d35140c02ed7410cf37f7e85c47`
**Worktree:** `/home/helio/HEr/META/unfold-spatial-intelligence-lab-final-stabilization`
**Estado:** código isolado, sem commit ou integração na branch principal.
**Veredicto do produto:** **CONDITIONAL**.
**Veredicto da estabilização offline:** **PASS**, sujeito a revisão independente final não obtida.

## Correcções implementadas

- O `semantic_spatial_map.v1` fica vinculado ao documento aceite e ao hash da imagem; cada origem tem uma chave de persistência própria. Carregar outra imagem, mesmo sem documento técnico, já não apaga o mapa da origem anterior. Workspaces legados são migrados apenas quando a origem coincide.
- As gravações do Scene Graph usam Web Locks para serializar leitura/validação/escrita entre separadores da aplicação actual. Rebuild substitutivo também fica vinculado à revisão que o utilizador confirmou; uma revisão concorrente mais recente causa conflito, não overwrite.
- Scene Graph valida consistência entre medidas da parede e mesh, unidades, polígonos de sala, arestas/boundaries e posições de aberturas dependentes em coordenadas globais. Transformações positivas já válidas em cenas `spatial_scene.v1` antigas continuam legíveis; edições paramétricas de paredes com escala global não unitária são recusadas explicitamente até existir uma operação que preserve essas escalas.
- A auditoria final encontrou que constraints válidas podiam ser ignoradas por comandos de geometria. Como não existe solver geral de constraints, agora qualquer edição geométrica de um nó restringido — incluindo parede, aberturas e regiões dependentes — é recusada atomicamente com `GEOMETRIC_CONSTRAINT_REQUIRES_SOLVER`; sem mutação parcial ou revisão criada.
- Pré-visualização continua sem alterar a revisão canónica; commit reexecuta a operação e rejeita preview adulterado ou obsoleto.
- Alterar parâmetro `verified` ou `corrected` requer confirmação explícita; a correcção conserva o valor anterior e unidade. Foi adicionada regressão para impedir que uma propriedade `corrected` perca o histórico numa edição posterior.
- Respostas contextuais locais distinguem Undo disponível em Redo de histórico inexistente; clarification target-bound pode ser retomada por resposta “Parede N”, vinculada à cena/revisão original, sem mutação antes do preview.
- Ledger hard-cap requer ficheiro partilhado; reserva é sincronizada entre processos, troca por rename atómico e lock é removido apenas após comparar inode. Lock inválido persistente falha fechado com diagnóstico.
- E2E consulta a versão real do browser, verifica renderer/mesh Three.js, falha perante rotas inesperadas e identifica explicitamente provider de fixture.

## Validação

| Verificação | Resultado |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npm test` | PASS — 42 ficheiros, 281 testes (após as regressões adicionais) |
| `npm run build` | PASS; permanece aviso de chunk `OrbitControls` 586,26 kB minificado / 149,71 kB gzip |
| `npm audit` | PASS — zero vulnerabilidades reportadas |
| `git diff --check` | PASS |
| Persistência concorrente / rebuild obsoleto / transformações hierárquicas / proveniência de resize | PASS — regressões unitárias focadas; sincronização testada com lock manager serializado em ambiente de teste |
| Regressões de constraint (comando genérico + edição paramétrica) | PASS — preview bloqueado e estado/revisão base preservados |
| E2E espacial Muse-agent, respostas fixture | PASS; Chrome headed / renderer AMD; preview, commit, mesh, Undo e resposta contextual local conferidos (`evidence/phase-8f-final/`) |
| E2E planta A, `/demo` | PASS; tracing manual, edição, abertura, preview/commit, clarification/continuação, Undo/Redo, guardar/restaurar (`evidence/plan-e2e-final/A/`) |
| E2E planta B, `/demo` | PASS; tracing manual e guardar/restaurar (`evidence/plan-e2e-final/B/`) |
| Chamadas Meta reais nesta estabilização | **0** |

O E2E de esclarecimento verificou que “Aumenta esta parede em 50 centímetros” sem selecção mantém o Scene Graph intacto, pede alvo e, após “Parede 1”, cria preview vinculado à mesma revisão. Só foram observados dois pedidos `/api/spatial-agent` esperados no caso A; a continuação não chamou `/api/conversation`. O endpoint foi interceptado como indisponível, portanto isto é prova do parser/executor local, não do Muse Spark.

O E2E do agente detectou ainda uma resposta temporalmente imprecisa após Undo quando coexistiam pilhas Undo e Redo. A resposta grounded foi corrigida e o E2E passou depois da correcção: menciona que a última alteração foi desfeita, a revisão disponível em Redo e as revisões históricas ainda disponíveis em Undo.

Na revisão final, o contrato de constraints foi exercitado adversarialmente: havia validação de referências, mas a execução de comandos não preservava nem recusava a alteração. Como o sistema não implementa um solver que possa manter `fixed`, `coincident`, `parallel` e restantes relações, a política segura é recusar mudanças nos nós afectados. A cobertura inclui `MoveComponent`, `RotateComponent`, `ResizeComponent`, `UpdateGeometry`, `UpdateParameter` e a edição paramétrica de parede que afecta uma região dependente; os previews não têm candidate e a revisão canónica permanece intacta.

## Browser e plantas

Executado em Google Chrome 155 headed, viewport 1440×960, com renderer `ANGLE (AMD Radeon Graphics (radeonsi renoir ACO), OpenGL ES 3.2)`. Emulação móvel 390×844 não apresentou overflow horizontal. Não é prova em dispositivo físico.

### Planta A — 650×446 px

- Original SHA-256: `54f4162e73cc1563b403a18a56ece8a99dc8d98e27c6edc48663a645cb8f0fc8`.
- Detecção automática: 16 candidatos axiais, 0 regiões, 0 aberturas.
- Cena final: 13 paredes e uma região, inteiramente através de tracing manual. A escala está `unreviewed`; altura e espessura são hipotéticas.
- E2E verificou bounds reais do mesh Three.js contra o Scene Graph: parede 9,663 × 2,72 × 0,15 m; alteração de abertura, mudança de parede +0,50 m e Undo foram reflectidos no estado e na geometria.
- Amostra do renderer: ~32 FPS, 34 draw calls, 2.456 triângulos, 33 geometrias. Trata-se de uma execução local, não de benchmark geral.

### Planta B — 3700×2996 px

- Original SHA-256: `1d78e739dad568ea49eb193416dc5f91c8b62b904a0170c63af803dd87750026`.
- Detecção automática: 162 candidatos, 3 regiões propostas, 11 faces rejeitadas por qualidade e 9 candidatos ambíguos de abertura.
- As propostas não foram promovidas. A cena final contém 4 paredes de perímetro e uma região manual; não é prova de reconstrução automática de interiores.
- Amostra do renderer: ~38 FPS, 5 draw calls, 434 triângulos, 4 geometrias.

As capturas, resultados JSON, imagem-fonte e cenas persistidas estão em `reports/phase-10-stabilization/evidence/`. São evidência privada local e não devem ser adicionados a commits.

## Revisões independentes e limites

As quatro revisões iniciais (SECURITY, CHAOS, SENIOR e TEST) encontraram, entre outros, riscos no lock obsoleto, normalização de unidades, polígonos/limites de sala, restauração sem documento confiável e asserções E2E incompletas. As correcções correspondentes estão implementadas e cobertas por regressões.

Foi solicitada uma re-revisão read-only aos quatro revisores. As quatro sessões terminaram sem resultado de auditoria devido ao limite de utilização do serviço. **Não existe aprovação independente pós-correcção.** Isto não é tratado como PASS.

Uma auditoria sénior posterior identificou cinco findings confirmados: corrida de persistência, incompatibilidade de cenas antigas escaladas, helpers de abertura em espaço local, respostas do agente válidas após reconstrução da mesma origem/revisão, e perda do valor imediatamente anterior em correcções sucessivas. Foram corrigidos nesta worktree:

| Finding | Correcção | Regressão |
|---|---|---|
| Escrita concorrente substituía revisão | Web Locks em todos os escritores da aplicação; CAS lógico revalidado dentro do lock; rebuild vinculado à revisão confirmada | Duas gravações concorrentes: uma vence; a outra recebe conflito; rebuild obsoleto e ausência de lock falham fechado |
| Cena legada com escala positiva era rejeitada | O schema actual volta a aceitar transformações positivas previamente permitidas; geometria paramétrica continua validada | Desserialização e round-trip de parede escalada |
| Aberturas e limites de salas divergiam sob pais transformados | Helpers partilhados compõem transformações globais; criação/edição de abertura e recálculo dependente convertem de/para o espaço local do pai | Parede sob pai traduzido/rodado e abertura aninhada editada após resize |
| Resposta assíncrona do agente podia aplicar-se a outro rebuild com `r0` igual | Context token inclui geração de cena, ID, revisão e selecção; substituição/rebuild aborta pedidos e clarificações | Mesmo ID/revisão, geração alterada invalida resposta pendente |
| Revisões sucessivas registavam valor de origem antigo | Proveniência de resize regista valor e unidade imediatamente anteriores | 100 → 120 → 130 conserva 120 como valor substituído na última correcção |

Esta correção final foi validada por TypeScript e testes focados (4 suites, 57 testes), depois pela suite integral (42 ficheiros, 281 testes), build, audit e diff check. O endpoint CDP `127.0.0.1:9227` não estava activo, por isso o E2E headed completo não foi reexecutado após estes últimos fixes. A inspecção visual foi feita no separador existente, sem abrir outro browser.

Limitações residuais:

1. A reconstrução Drawing-to-World permanece manual para A e manual para a cena final B; a detecção de faces de B ainda é apenas proposta, não validada contra referência humana independente.
2. Muse Spark real e conversação contextual não foram testados nesta estabilização. O orçamento anterior está esgotado; não houve reset nem nova chamada.
3. Lock de ledger corrompido falha fechado. Se o processo morrer enquanto mantém o directório `.reclaim`, o próximo processo pode exigir intervenção operacional; a recuperação automática foi evitada para não remover um lock alheio.
4. O chunk Three.js/OrbitControls continua acima de 500 kB minificado.
5. As métricas são de um cenário de teste; não validam desempenho em hardware de utilizadores nem dispositivo móvel físico.
6. Integridade de provenance é validada estruturalmente e por fluxo explícito local; não existe autenticação multi-utilizador nem serviço de identidade para provar a identidade civil do `actor`.

## Alterações e isolamento

Alterados: `server/meta-server.ts`, `src/plan-scene.ts`, `src/semantic-spatial-map.ts`, `src/spatial-command-protocol.ts`, `src/spatial-editor.ts`, `src/spatial-scene.ts`, novo `src/spatial-persistence.ts`, testes e scripts CDP. As alterações permanecem sem commit para revisão.

Confirmado nesta execução: a branch e HEAD da worktree isolada continuam em `phase-10-mvp-stabilization` / `62fe7eb118067d35140c02ed7410cf37f7e85c47`; a branch principal não foi modificada. Nenhuma chamada Meta, merge, deploy ou submissão foi feita.

**Conclusão:** a camada de integridade offline está estabilizada e as regressões reproduzidas passam, incluindo a recusa de mutações sob constraints não resolvidas. O produto completo não cumpre o critério final de sucesso: falta aceitação live autorizada do Muse e reconstrução automática fiel com confirmação independente. Portanto, a classificação global permanece **CONDITIONAL**, não PASS.

## Refinamento visual pedido pelo utilizador

Foi verificada a rota `/spatial-editor` no separador existente do browser (viewport mostrado pelo cliente). No estado vazio, a grelha e a barra de edição competiam com a importação; também havia duas entradas paralelas para começar. A interface agora apresenta um único cartão central “Comece pela planta”, com acção funcional `Importar planta`; o painel lateral e as ferramentas de edição só aparecem após carregar uma fonte/cena. A grelha também permanece oculta até existir uma imagem de referência. A rota principal `/demo` foi aberta no mesmo separador e manteve o seu estado vazio e a Floating Spatial Command Bar.

Validação visual: observação headed no separador IAB existente, sem criar outro separador. A captura mostrada durante a sessão não foi persistida como ficheiro; as imagens E2E existentes em `evidence/visual-refinement/plan-a/A/` são da execução anterior e **não** devem ser usadas como captura do novo cartão. Os estilos e a asserção E2E da entrada vazia foram alterados; o fluxo E2E completo não foi reexecutado nesta última alteração porque o endpoint CDP headed da automação já não estava disponível. `npm test` (42/272), build, audit e `git diff --check` foram executados depois das alterações.

Limite: esta mudança resolve a hierarquia do estado inicial, não transforma a reconstrução técnica num fluxo visual final. A tela com geometria ainda conserva ferramentas densas e continua a representar tracing manual; o veredicto geral não muda de **CONDITIONAL**.

### Ajuste responsivo após inspecção do browser

Na largura observada de 709 × 684 px, o breakpoint mobile terminava em 700 px e deixava o tablet com escala de desktop: título e acções pareciam pequenos em relação à área útil. Foi acrescentado um intervalo específico de 701–900 px para escala tipográfica, navegação, rail de etapas, acções iniciais e barra de comandos. A alteração foi observada no mesmo separador da rota `/demo`; não foi aberto outro browser. `npm test` passou com 42 ficheiros/281 testes e `npm run build` passou. A captura foi apresentada na sessão, mas não persistida no repositório. O E2E após esta alteração CSS não foi executado; a reconstrução completa continua **CONDITIONAL** pelas limitações descritas acima.
