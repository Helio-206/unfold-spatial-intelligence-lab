# V4 E0 — Auditoria independente e hardening de recuperação

- Branch de auditoria: `audit/v4-e0-recovery-hardening`, a partir de `feat/v4-e0-atomic-transactions@4f15d108ca1a7a6bd2321d675bbda7de3c1cd264` (baseline `c3adee33`). A branch auditada não foi modificada.
- SHA final desta branch: ver `git log -1` (o relatório entra no commit final e não pode citar o próprio SHA).

## 1. Estado remoto ambíguo — falha reproduzida

Na implementação auditada, se o servidor cometesse a transacção, a resposta se perdesse e o pedido a `/transactions/status` também falhasse:

1. `applySpatialPlanV2Transaction` relançava o erro de rede original, indistinguível de uma falha definitiva.
2. `PlanSpaceLayer` tratava-o como «edição bloqueada», limpava o pending e **não bloqueava nada**: a revisão local e a do servidor passavam a divergir sem registo.
3. A edição seguinte de operação única usava a `baseRevision` antiga, recebia 409 e caía no caminho legado de `syncLost` + aplicação local sobre um plano que não incluía a transacção cometida — divergência apresentada como edição local.
4. Não havia identidade persistente da transacção: o `SpaceFlow` gerava uma chave nova por tentativa, por isso um retry manual podia aplicar duas vezes.

Os 7 testes novos escritos para este cenário falharam todos na implementação auditada (7 failed / 37 passed) e passam depois da correcção.

## 2. Correcção implementada

**Cliente (`src/universal-spatial/api-client.ts:88`)**
- Novo `SpatialTransactionUnresolvedError` (`sessionId`, `idempotencyKey`, `reason`), lançado apenas quando o resultado é genuinamente desconhecido. Nunca é convertido em sucesso nem em falha definitiva.
- Resposta perdida → recuperação por `/status`. Se o servidor responde autoritativamente `SPATIAL_V2_TRANSACTION_NOT_FOUND`, a primeira submissão não cometeu: resubmete **uma vez com a mesma chave** (comete ou faz replay, nunca duplica). Se a recuperação falha por rede, ou a sessão desapareceu (`session-not-found`), lança `SpatialTransactionUnresolvedError` com a chave estável.

**Camada (`src/living/spatial-space/layer.ts:31`)**
- A camada gera a chave de idempotência uma única vez e guarda `{key, before, ops}` em `unresolvedTx` quando o sync lança `SpatialTransactionUnresolvedError`. `transactionUnresolved`/`unresolvedTransactionKey` expõem o estado; `isBusy`/`canUndo` reflectem-no.
- Enquanto `unresolvedTx` existir, `commit` (qualquer operação, incluindo únicas), `undo` e `closeGaps` estão bloqueados com notificação explícita. Previews continuam possíveis; aplicar, não.
- `reconcileTransaction()`: pede ao sync o resultado autoritativo para a mesma chave. `committed` adopta o plano do servidor como uma entrada de história desfazível; `recovered-not-committed` só acontece via `SpatialTransactionSessionRecoveredError` (recuperação explícita de sessão); qualquer outra falha mantém o estado e o bloqueio (`still-unresolved`). Nada inventa um desfecho.

**Fluxo (`src/living/spatial-space/flow.ts:290`)**
- O pedido exacto da transacção (sessão, revisão base, chave estável, operações, proveniência) fica guardado durante a sessão. A reconciliação resubmete/recupera esse pedido — mesma chave, mesmo corpo.
- Se a sessão desapareceu, a reconciliação faz a recuperação explícita: re-adopta o plano local pré-transacção como sessão nova e sinaliza `recovered-not-committed`; a transacção está autoritativamente ausente da sessão recuperada e as edições reabrem sobre o plano actual.
- O workspace expõe a ferramenta «Reconciliar transacção» apenas enquanto o estado está por resolver; `canAskMeta` já ficava falso porque `isBusy` inclui o estado por resolver.

Sem sleeps nem retries ilimitados: no máximo uma resubmissão após um `NOT_FOUND` autoritativo, e reconciliações explícitas uma de cada vez.

## 3. Testes

- API/cliente (HTTP real, sem Meta): timeout pré-commit com resubmissão única e um só commit; rede intermitente (resposta e recuperação falham → `Unresolved` com a chave; rede volta → recibo `revision 1, replayed: true` recuperado); restart do servidor a meio da recuperação (segundo servidor sem sessão → `reason: 'session-not-found'`); o teste pré-commit anterior foi corrigido para esperar `SpatialTransactionUnresolvedError` em vez de uma «falha» inventada.
- Camada: estado por resolver bloqueia edição única, edição agrupada, solver e undo; reconciliação repetidamente falhada mantém o bloqueio; reconciliação com sucesso adopta o plano autoritativo e o undo agrupado funciona a seguir; recuperação de sessão limpa o bloqueio sem aplicar a transacção e as edições retomam.
- Focados finais: `spatial-transactions-v2`, `spatial-space-layer`, `universal-spatial-v2-api`, `experimental-v4` — 55/55 verdes.

## 4. Browser — servidor HTTP real

`tests/e2e/v4-e0-atomic-browser.pw.mjs` (novo, auto-contido: arranca e pára o backend `server/index.ts` e o Vite com proxy `/api`):

- Só a rota paga de geração do plano é simulada (inferência Meta simulada, como permitido); **adopt, transacção, revisões e undo agrupado passam pelo servidor real** — nenhum endpoint de transacção é simulado.
- Resultado observado: grupo de 2 operações → `revision 1`, 1 entrada de história, posições alteradas; pedido directo com `baseRevision 0` → `409` com `currentRevision 1` (revisão autoritativa lida do servidor); undo agrupado pela camada → `revision 2` e plano exactamente igual ao pré-transacção; novo pedido obsoleto → `currentRevision 2`; zero erros de página. Screenshot em `/tmp/unfold-v4-e0-browser/after-grouped-undo.png`.
- Regressão: `v4-worker-integration.pw.mjs` (escavadora) continua verde — proposta, `V4_STALE`, aplicação autorizada, undo exacto.

## 5. Suite completa e os quatro timeouts herdados

- Suite: 2478 verdes, 4 falhas — exactamente os mesmos 4 timeouts da baseline e da branch auditada (`rendering-lifecycle`, `universal-spatial-buried` ×2, `bucket-width`), todos «Test timed out in 5000ms».
- Investigação: isolados, esses testes demoram ~2,3–3,5 s (compilação de geometria pesada) e passam; sob a carga paralela da suite (153 ficheiros) excedem o limite por omissão de 5 s. Não são afectados por este trabalho (ficheiros e código não tocados) e reproduzem-se igual em `c3adee3`. Não enfraqueci assertions nem alterei limites globais; a correcção adequada (timeout por teste ou redução de paralelismo, com medição) fica como item separado, fora do âmbito E0.
- `npm run build`: verde.

## 6. Riscos restantes

- **Operação única legada (inalterado, por desenho):** sem transacção por resolver, uma falha de rede numa operação única continua a declarar `syncLost` e a aplicar localmente. É o comportamento pré-E0, visível ao utilizador, mas diverge do servidor; merece o mesmo tratamento de estado desconhecido num passo futuro.
- **Undo agrupado com resposta perdida:** o cliente repete uma vez com a mesma chave (seguro no servidor), mas se ambas as tentativas se perderem não há estado `unresolved` persistente para o undo como há para a transacção; a revisão local fica desactualizada e o próximo pedido resolve por 409/`syncLost`. Recomendo estender o mesmo padrão antes de depender de undo remoto em redes fracas.
- **Durabilidade:** sessões, recibos e o pedido pendente vivem em memória (cliente e servidor). Um restart do servidor é tratado como sessão perdida recuperável; um refresh do browser com uma transacção por resolver perde a chave — o bloqueio desaparece com a camada, mas a sessão do servidor também não é recuperada nesse caso (a camada nova começa sem sync até nova adopção). Persistência continua fora de âmbito.
- O pedido pendente guarda as operações em memória na sessão do cliente; não é escrito em storage.

## 7. GO/NO-GO para V4 E1

**GO condicionado.** O risco auditado está fechado: um resultado desconhecido já não é inventado nem deixa o cliente divergir em silêncio — fica bloqueado, identificado por uma chave estável e reconciliável contra o servidor, incluindo restart de sessão; e a atomicidade está agora provada em browser contra o servidor HTTP real, sem endpoint simulado. As condições que restam são as mesmas de fundo já registadas (persistência, revisão humana autenticada) mais os dois itens da secção 6, que devem entrar no plano do E1 sem bloquear o seu desenho.
