# V4 E0 — Transacções Espaciais Atómicas

- Branch: `feat/v4-e0-atomic-transactions`, a partir de `integration/produto-v4@c3adee33fba74ea672c90d412238d1b5529e7a57`.
- SHA final: ver o topo da branch (`git log -1`); este relatório entra no commit final, por isso não pode citar o próprio SHA.

## Arquitectura

Antes, o servidor aplicava uma operação por pedido e o cliente recusava qualquer lote sincronizado (`BATCH_REQUIRES_ATOMIC_SERVER`), incluindo undo agrupado. Agora:

- `POST /api/spatial/v2/transactions` — submete 1–32 `SpatialOperationV2` como uma transacção (`src/universal-spatial/contracts-v2.ts:84` (`parseSpatialTransactionV2`)).
- `POST /api/spatial/v2/transactions/status` — recupera o recibo autoritativo de uma transacção já cometida.
- `POST /api/spatial/v2/undo` — aceita `idempotencyKey` opcional; sem chave, o comportamento anterior mantém-se.
- `PlanSpaceLayer.commit` usa `LayerSync.applyTransaction` para grupos e `LayerSync.undoTransaction` para undo agrupado (`src/living/spatial-space/layer.ts:26`). Sem esses métodos, continua a falhar fechado. `SpaceFlow` liga os dois métodos ao endpoint novo (`src/living/spatial-space/flow.ts:291`).
- O cliente (`src/universal-spatial/api-client.ts:84`) valida o recibo e o plano antes de os aceitar.

## Semântica da transacção e da revisão

1. Autenticação e guarda de rotas locais: as rotas novas estão em `LOCAL_SPATIAL_ROUTES`/`NO_META_SPATIAL_ROUTES`; não gastam chamadas Meta.
2. A sessão é resolvida e a expiração verificada (404 `SPATIAL_V2_SESSION_NOT_FOUND`).
3. Idempotência antes da revisão: uma chave já vista com o mesmo conteúdo devolve o recibo guardado com `replayed: true`; com conteúdo diferente, 409 `SPATIAL_V2_IDEMPOTENCY_KEY_CONFLICT`. A impressão digital é SHA-256 de JSON canónico (chaves ordenadas) de `{baseRevision, operations, provenance}`.
4. `baseRevision` diferente da revisão actual: 409 `SPATIAL_V2_REVISION_CONFLICT` com `currentRevision`.
5. Cada operação é aplicada em ordem a uma cópia isolada (`structuredClone`) com `applySpatialOperationV2`, que valida o plano resultante a cada passo; o plano final é compilado e avaliado com `evaluateSpatialConstraintsV2`.
6. Só depois disso a sessão muda: um único item de história, `revision += 1` (uma revisão por transacção, independentemente do número de operações), `pendingRefinement` limpo e recibo guardado. Não há `await` entre a verificação e o commit, por isso dois pedidos concorrentes não se intercalam na secção crítica; o segundo perde na revisão ou recupera o recibo.
7. Falha em qualquer operação deixa plano, revisão e história intactos (provado por um commit válido com a revisão original a seguir à falha).

O recibo (`unfold.spatial-transaction-receipt.v1`) traz `transactionId` determinístico derivado da chave, `baseRevision`, `revision`, `operationIds`, o plano autoritativo e o relatório de restrições. A proveniência declarada (`inferred` ou `user_provided`, com evidência) é a que fica gravada em cada operação; um resultado de solver não é promovido.

Limites: máximo 32 operações por transacção, 64 recibos de idempotência por sessão (FIFO), história limitada a 50 itens como antes, corpo limitado pela guarda existente.

## Idempotência e recuperação

- Resposta perdida depois do commit: o cliente volta a pedir `/transactions/status` com a mesma chave e adopta o recibo; uma repetição do POST também devolve `replayed: true` sem reaplicar.
- Timeout antes do commit: nada é guardado; a mesma revisão base continua válida.
- Undo agrupado: um único item de história por transacção, por isso um único undo repõe o plano exacto anterior e avança a revisão uma vez. Com `idempotencyKey`, repetir o undo devolve o recibo (`replayed: true`) sem desfazer outra vez; a chave reutilizada com outra `baseRevision` dá 409.
- As sessões e os recibos vivem em memória, como as sessões actuais: **não há durabilidade entre reinícios do processo** e nada neste trabalho a alega.

## Testes executados

- `tests/spatial-transactions-v2.test.ts` (novo, HTTP real com `withGuardedServer`, sem chamadas Meta): commit multi-operação com uma só revisão e proveniência preservada; operação inválida e tipo não suportado a meio do lote sem mudar plano/revisão/história; conflito de revisão; duas transacções simultâneas com a mesma base (exactamente um 200 e um 409); retry idêntico com `replayed: true`; reutilização da chave com conteúdo diferente (409); recuperação por `/status` depois de resposta perdida (fetch que deita a resposta fora depois do commit) e timeout antes do commit (fetch que falha antes de enviar); undo agrupado e repetição idempotente do undo; sessão desconhecida/expirada (404).
- `tests/spatial-space-layer.test.ts`: grupo de solver cometido por uma só chamada `applyTransaction` e desfeito por uma só `undoTransaction`; falha da transacção deixa plano e história intactos; dispose durante transacção pendente não reconstrói a camada. Os testes anteriores de recusa sem endpoint atómico mantêm-se.
- Focados: 3 ficheiros, 44 testes, todos verdes.
- Suite completa: 2472 verdes, 4 falhas por timeout (`rendering-lifecycle`, `universal-spatial-buried` ×2, `bucket-width`) — as mesmas 4 falhas, nos mesmos testes, corridas na baseline `c3adee3` sem as minhas alterações (2462 verdes aí; a diferença são os 10 testes novos). Isolados, esses ficheiros passam nas duas árvores.
- `npm run build` (tsc + vite): verde.
- Browser: `tests/e2e/v4-worker-integration.pw.mjs` com `UNFOLD_V4_CASES=excavator` contra Vite local: proposta do Worker, `V4_STALE` com edição durante o pedido, aplicação autorizada e undo exacto, sem erros de página. As rotas de plano/adopção são simuladas nesse ensaio, como no ensaio V4 original; a atomicidade remota é provada pelos testes HTTP reais acima.

Não cobri com teste automático novo: expiração por relógio (30 min) — o caminho 404 é o mesmo da sessão desconhecida e está coberto; «Space mudou antes da resposta» continua coberto pela protecção de dispose/stale existente e pelo ensaio de browser.

## Limites conhecidos

- Sem persistência: reiniciar o servidor perde sessões, história e recibos.
- Os recibos de idempotência expiram com a sessão e com o limite FIFO de 64 por sessão; um retry mais tardio que isso é tratado como pedido novo e falha na revisão, não reaplica em silêncio.
- A operação única mantém o comportamento anterior (perda de sincronização declarada e edição local) para não partir o contrato V2/V3; só os grupos passaram a falhar fechado quando há endpoint atómico e ele falha.
- V4 continua desligado por defeito; `/universal-spatial-v2` e a submissão do hackathon não foram tocados.

## GO/NO-GO para V4 E1

**GO condicionado**: a atomicidade remota, a idempotência e o undo agrupado estão implementados e provados contra o servidor real, e os lotes sincronizados (solver, cor, gaps) deixaram de ser recusados. Antes de activar V4 por defeito continuam a faltar persistência verificável e revisão humana autenticada, que já eram bloqueios no relatório V4 e não fazem parte desta etapa.
