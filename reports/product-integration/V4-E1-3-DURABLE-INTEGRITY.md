# V4 E1.3 — Integridade espacial durável e política fail-closed

- Branch isolada: `feat/v4-e1-3-durable-spatial-integrity`, a partir de `feat/v4-e1-transaction-bound-approval@d76b7b00464e6504c1495d7727961c6a0b64b7d1`. Commits por milestone: A (fail-closed), B/C/E (política, aprovações, durabilidade), D (undo por resolver). Sem merge, sem V4 por defeito, sem tocar no E2 do Codex.
- SHA final: ver `git log -1` nesta branch (o relatório entra no commit final).

## Falhas reproduzidas na baseline

1. **Fallback local de proposta fenced (A).** Com `reviewBinding` mas sem `LayerSync`, `PlanSpaceLayer.commit()` chegava à aplicação local e a proposta era apresentada como aplicada sem qualquer commit autoritativo. O teste novo falhou no E1.2 e passa agora.
2. **Fence opcional contornável (B).** Uma sessão podia receber uma transacção sem fence ou uma mutação por `/operation` mesmo quando o trabalho era review-bound; nada no servidor ligava a sessão a uma política.
3. **Aprovação em texto livre (C).** A autorização vivia dentro da string de evidência (sujeita a truncagem a 500 caracteres).
4. **Undo agrupado sem estado desconhecido (D).** Uma resposta de undo perdida duas vezes deixava o cliente sem estado explícito e capaz de tentar outro undo.
5. **Sessões voláteis (E).** Sessões, recibos, revisão e história existiam só em memória, sem declaração desse facto nas respostas.

## A — Fail-closed

`commit()` lança `REVIEW_FENCED_REQUIRES_SERVER_SESSION` quando há `reviewPrecondition` e não há sync, antes de qualquer aplicação local. Em `applyEdit`, uma proposta fenced que falha **não é descartada em silêncio**: fica pendente (plano, história e revisão intactos), o utilizador é notificado de que nada foi aplicado, e a mesma proposal pode commitar quando uma sessão aparecer (testado). Operações explicitamente locais sem binding não são afectadas.

## B — Política de mutação da sessão

Cada sessão V2 tem agora uma política imutável, `legacy` (default, comportamento anterior) ou `review_fenced`, vinculada na adopção a um registo de revisão validado para exactamente aquele plano e fonte (`SPATIAL_SESSION_POLICY_BINDING_INVALID` caso contrário). A política vive no estado da sessão no servidor — não numa flag por pedido:
- `/transactions` sem fence numa sessão fenced: `403 SPATIAL_REVIEW_POLICY_REQUIRES_FENCE`; fence de outra revisão: 409;
- `/operation`, `/edit` e `/refine` numa sessão fenced: o mesmo 403 — não há desvio pelo caminho legado;
- undo continua permitido (reverte, não introduz uma mutação revista nova) e o estado/status continua legível;
- sessões legacy mantêm compatibilidade total E0 (testado).
O `SpaceFlow` continua a adoptar sessões legacy (o fence por transacção do E1.2 aplica-se); criar sessões fenced é uma escolha explícita da API nesta etapa, declarada como limite abaixo. Isto não é autenticação: a guarda local e o nome afirmado continuam a ser os únicos controlos, e hipóteses inferidas não viram decisões autenticadas.

## C — Aprovação estruturada

Com fence, o recibo da transacção inclui `approval` (`unfold.spatial-approval.v1`): transactionId, reviewId, reviewRevision, planFingerprint, sourceSha256, actor `{displayName, authenticated: false, attribution: 'client_asserted_unverified'}`, `approvedAt` do servidor e `commitRevision` — o mesmo objecto que é persistido com o recibo. A proveniência do plano continua `inferred` com a evidência do solver; aprovação, inferência e commit são três factos separados e a truncagem da evidência já não pode apagar a aprovação. Clientes antigos ignoram o campo novo; planos antigos não são alterados.

## D — Undo e operação única

Undo agrupado: chave estável por tentativa guardada no fluxo; se nem a repetição interna produz resposta, o fluxo lança `SpatialTransactionUnresolvedError` e a camada entra em estado `undoUnresolved` — a entrada de história fica **retida** nesse estado (nem reposta, o que deixaria outro undo consumir a entrada seguinte, nem consumida, o que inventaria o undo), e commits/undos ficam bloqueados. `reconcileUndo()` resolve contra o servidor com a mesma chave (replay do recibo ou commit único) e só aí consome a entrada; recuperação explícita de sessão repõe a história. A ferramenta «Reconciliar» do workspace cobre transacção e undo e distingue os desfechos. Operação única: em sessões fenced está bloqueada no servidor e, com binding, a camada já usa a transacção fenced mesmo para uma operação; em sessões legacy mantém-se o comportamento `syncLost` + edição local declarada — **limite legado conhecido**, não usado por trabalho review-bound. Um resultado desconhecido nunca é apresentado como sucesso nem como falha definitiva.

## E — Sessões duráveis

Mecanismo opcional com as convenções existentes: um documento JSON (`unfold.spatial-sessions.v2`) no directório de estado, escrita atómica (temporário `0600` + rename, directório `0700`), validação de contrato/esquema ao carregar, corrupção posta em quarentena com o servidor saudável, sessões expiradas descartadas à carga e nunca ressuscitadas, no máximo as 100 sessões já limitadas. Guarda plano, revisão, história (≤50), política e binding, recibos de idempotência de transacções e de undo, e expiração.
**Modelo de crash:** um commit de transacção só é respondido depois de `persistSessions()` ter sucesso; se a escrita falhar, a mutação em memória é revertida (snapshot) e o pedido falha com `SPATIAL_SESSION_PERSISTENCE_FAILED` — memória e disco nunca discordam sobre a revisão autoritativa. Sem fsync, **não** se alega durabilidade contra perda de energia, nem armazenamento multi-processo. Sem ficheiro configurado (testes, embedded), as sessões são voláteis e as respostas de adopção/plano declaram `sessionDurability: 'volatile'` (com ficheiro, `'file'`). O servidor suportado (`server/index.ts`) configura reviews e sessões por defeito. Segredos: o documento não contém tokens nem chaves Meta; contém planos e recibos, com permissões `0600`.

Testes de restart reais (dois servidores sequenciais sobre os mesmos ficheiros): commit fenced + replay da mesma chave sem reaplicar + política intacta + undo agrupado funcional após restart; corrupção em quarentena sem sessão fabricada; sessão expirada não ressuscitada.

## F — Concorrência

Sem `await` novo dentro da secção crítica: política, fence, validação, commit e persistência síncrona acontecem no mesmo turno. Cobertos por testes anteriores e novos: duas transacções concorrentes (uma comete), decisão de revisão vs commit fenced (fence obsoleto sem mutação), undo vs mutação (revisões), retries com a mesma chave, expiração e restart após commit antes da resposta (replay durável). Browser: proposta cancelada/substituída durante o guard (E1.2) e refresh com decisões persistidas (E1) continuam verdes.

## G — Experiência

Sem dashboard novo: estados autoritativos aparecem onde já apareciam — `syncNote`, notificações da camada, estado `unresolved`/ferramenta «Reconciliar», e agora `sessionDurability`/`mutationPolicy` nas respostas. Uma operação fenced nunca mostra sucesso por ter sido aplicada localmente: ou há recibo do servidor, ou fica pendente/por reconciliar com a explicação visível.

## Impacto de desempenho

Não medido com benchmark dedicado; o custo novo por mutação é uma serialização JSON síncrona do documento de sessões (limitado a 100 sessões × planos limitados a 256 KB pela guarda existente) nas rotas de mutação V2. É o preço declarado da garantia de crash; sessões voláteis não pagam nada.

## Validação

- Focados: camada, fenced, transacções E0, revisão, projecção, política/durabilidade, ExperimentalV4 — todos verdes em cada milestone (75/75 no conjunto final focado).
- Browser: `v4-e1-review-browser` (revisão, commit fenced, undo, reabertura) e `v4-e0-atomic-browser` verdes, contra backend real.
- Build verde. Suite completa: 2504 verdes, 4 falhas — exactamente os quatro timeouts herdados da baseline (`rendering-lifecycle`, `universal-spatial-buried` ×2, `bucket-width`; «timed out in 5000ms», passam isolados). Corrida por defeito, sem workers/timeouts alterados; nada foi enfraquecido.

## Limites conhecidos

- O produto adopta sessões `legacy` por defeito; sessões `review_fenced` são criadas explicitamente via API com review pré-criado. Ligar a criação fenced ao fluxo de abertura de revisão é trabalho de produto futuro.
- Persistência é single-processo e sem garantia contra perda de energia; dois backends sobre o mesmo ficheiro não são suportados.
- Operação única legacy e o caminho `syncLost` mantêm-se para sessões legacy.
- Autenticação de revisor/aprovador continua inexistente e declarada em todo o lado.

## GO/NO-GO para integração

**GO.** Para sessões review-bound, uma mutação geométrica só se torna autoritativa por uma transacção do servidor que verifica a política e o fence, ou por um recibo durável recuperado; o resto fica explicitamente por resolver e bloqueado. As garantias E0/E1/E1.1/E1.2 mantêm-se e as sessões legacy não mudaram de comportamento.
