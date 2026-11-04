# V4 E1.2 — Revisão vinculada à transacção e integridade da autorização

- Branch isolada: `feat/v4-e1-transaction-bound-approval`, a partir de `feat/v4-e1-review-correctness@14ebd603881003dfd7cb063b9d8f978d2d1e231e`. Sem merge, sem branches protegidos, V4 desligado por defeito, sem trabalho E2.
- SHA final: ver `git log -1` nesta branch (o relatório entra no commit final).

## Os três factos, separados

1. **O solver inferiu** — a proveniência das operações é `inferred`, com a evidência original do solver.
2. **Uma pessoa autorizou** — registado à parte, na evidência, como `Authorisation: a person authorised applying this inferred result in the workspace (client-asserted, reviewer identity not authenticated)`, com review ID e revisão quando existe binding. Autorização nunca promove geometria inferida a `user_provided` (antes promovia: ver defeitos).
3. **O servidor cometeu** — só quando a transacção fenced passa a precondição de revisão dentro da secção crítica síncrona do commit.

## Contrato da precondição (Milestone A)

`SpatialTransactionV2` ganha um campo opcional e retrocompatível, `reviewPrecondition: { reviewId, reviewRevision, planFingerprint, sourceSha256 }` (`contracts-v2.ts`, validado por `parseSpatialTransactionV2`; entra na impressão digital de idempotência). Sem o campo, as transacções E0 comportam-se exactamente como antes (testado). Com o campo, o servidor, **sem nenhum `await` entre a verificação e a publicação**:

- resolve o registo de revisão persistido e exige: revisão actual igual à do fence, fingerprint igual à do registo, hash da fonte igual, fingerprint do registo igual à fingerprint calculada do plano actual da sessão, fonte do registo igual à do plano, e gate elegível (`reviewSolverGate` sem bloqueios);
- qualquer divergência responde `409 SPATIAL_REVIEW_PRECONDITION_STALE` antes de qualquer mutação, com a revisão actual da sessão e da revisão;
- só depois valida as operações na cópia isolada e publica plano+revisão+história de uma vez, como no E0. O recibo devolve o fence confirmado.

Uma decisão de revisão concorrente não se pode intercalar: o handler é síncrono depois do parse do corpo, por isso a decisão ou entra antes (e o fence falha) ou depois (e o fence já cometeu contra o estado exacto que leu). Replays idempotentes são resolvidos **antes** do fence e nunca re-mutam: repetir a mesma chave depois de a revisão avançar devolve o recibo original com `replayed: true` (testado).

## Proveniência (Milestone B)

`PlanSpaceLayer.applyEdit` passou a submeter propostas de solver/Meta com `origin: 'inferred'` e a evidência original do solver, acrescentando a nota de autorização separada (com review ID/revisão quando há binding); edições da própria pessoa continuam `user_provided`. As expectativas dos e2e V4 que afirmavam `user_provided` para resultados de solver foram corrigidas para `inferred`. O servidor grava exactamente a proveniência declarada na transacção — o teste HTTP confirma `provenance.transform === 'inferred'` depois da autorização e do commit. Nenhuma autenticação é inventada.

## Corridas do guard assíncrono (Milestone C)

Reproduzido e corrigido em `applyEdit`:
- a aplicação é reclamada sincronamente (`applying`) antes de qualquer `await` — um segundo `applyEdit` durante o guard ou o commit é no-op, nunca uma submissão duplicada (testado: 1 submissão);
- o pending, a autorização e o plano são fotografados antes do guard; quando o guard resolve, exige-se `pending` idêntico, plano idêntico, autorização idêntica e ainda presente — proposta **cancelada** ou **substituída** durante o voo nunca comete quando o guard antigo resolve `true` (testado), e a proposta de substituição sobrevive por aplicar;
- dispose durante o guard não reconstrói nem comete (padrão existente, mantido).
Mesmo que todas estas verificações passem, o fence do servidor (Milestone A) continua obrigatório para propostas com binding — a camada não é a autoridade.

O binding viaja assim: `ExperimentalV4.preview()` revalida e passa `reviewBinding` à proposta; `applyEdit` inclui-o no commit; commits fenced usam o endpoint de transacção mesmo com uma só operação; o `SpaceFlow` encaminha o fence para a API. Propostas sem binding (solver local, sem revisão) mantêm o caminho anterior.

## Recuperação de falhas (Milestone D)

O mecanismo E0 mantém-se: chave de idempotência estável gerada uma vez, estado `unresolved` que bloqueia edições dependentes, reconciliação contra o resultado autoritativo. Novo neste trabalho: commit fenced com resposta perdida recupera o recibo por `/transactions/status` com a mesma chave (testado por HTTP com fault injection); restart do servidor mata a sessão espacial (404 definitivo, correcto para sessões em memória — o registo de revisão, persistido em ficheiro, sobrevive); no undo agrupado, o `SpaceFlow` passou a reutilizar uma chave de undo estável por tentativa, para um retry após resposta perdida fazer replay do recibo em vez de desfazer duas entradas. **Risco legado que fica, declarado:** o undo agrupado ainda não tem estado `unresolved` persistente na camada como a transacção tem, e a operação única continua com o comportamento pré-E0 (`syncLost` + edição local declarada); nenhum dos dois foi enfraquecido nem é usado por commits fenced.

## Testes

- `tests/spatial-review-fenced-transactions.test.ts` (novo, HTTP real): commit válido fenced com undo agrupado; fence obsoleto rejeitado antes de mutar (a mesma base comete a seguir); replay idempotente válido depois de a revisão avançar e fence fresco obsoleto rejeitado; review de outro plano, fingerprint fabricado e review inexistente rejeitados; relação rejeitada não pode ser re-fenced na revisão pré-rejeição; recuperação após resposta perdida com proveniência `inferred`; transacção E0 sem fence compatível. Os 7 testes novos (estes + camada) falhavam antes da correcção.
- `tests/spatial-space-layer.test.ts`: cancelada/substituída durante o guard nunca comete; duplicados submetem uma vez; proveniência de solver autorizado fica `inferred` com autorização registada.
- Focados: 84/84 em 7 ficheiros (fenced, camada, transacções E0, revisão, projecção, ExperimentalV4, hierarquia). Build verde.
- Browser (backend real, só a rota paga simulada): `v4-e1-review-browser` — rever, confirmar contraditas, commit fenced pela via propose→autorizar→aplicar com uma só revisão e proveniência `inferred` com nota de autorização, undo agrupado exacto, e fence obsoleto rejeitado (o ensaio apanhou primeiro um `defer` numa contradita a bloquear o gate — comportamento correcto do servidor); `v4-e0-atomic-browser` e `v4-worker-integration` verdes.
- Suite completa: 2499 verdes, 4 falhas — exactamente os quatro timeouts herdados da baseline (`rendering-lifecycle`, `universal-spatial-buried` ×2, `bucket-width`, todos «timed out in 5000ms», passam isolados). Nada foi enfraquecido.

## Limites que ficam

- O fence protege commits com binding de revisão (caminho solver+revisão do produto). Propostas de solver sem revisão associada correm sem fence, com guard do cliente e autorização — não ganharam autoridade nova.
- Entre a verificação do fence e o `writeJson` não há janela (mesmo turno síncrono), mas um cliente que ignore o cliente do produto pode submeter transacções sem fence directamente à API local: o fence é obrigatório para quem o declara, não é uma política global do servidor para propostas de solver (o servidor não distingue a origem de uma transacção sem fence). Torná-lo global exigiria marcar a origem solver na sessão, trabalho futuro se o E2 o exigir.
- Persistência de sessões continua em memória; autenticação de revisor continua inexistente e declarada.

## GO/NO-GO para combinar E1.2 com o motor E2

**GO.** Uma proposta derivada de relações revistas só comete contra o estado revisto exacto que a autorizou, verificado pelo servidor no acto do commit; se a revisão mudar, falha sem mutar; se o resultado se perder, fica por resolver em vez de inventado; e a geometria autorizada permanece inferida com a aprovação registada à parte. O E2 deve submeter as suas propostas com `reviewBinding` e tratar `SPATIAL_REVIEW_PRECONDITION_STALE` como recusa terminal daquela proposta.
