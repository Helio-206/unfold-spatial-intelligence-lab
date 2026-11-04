# V4 E1.4 — Auditoria de durabilidade, continuidade de política e exactly-once

- Branch isolada: `audit/v4-e1-4-durability-policy-hardening`, a partir de `feat/v4-e1-3-durable-spatial-integrity@08f0d326fdf90a47c0d6cbb38d3378700990bd8b`. Commits por achado. Sem merge, sem V4 por defeito, sem tocar no E2.2 do Codex.
- SHA final: ver `git log -1` nesta branch (o relatório entra no commit final).

## Achado 1 — Falhas de persistência reconhecidas como sucesso

**Reprodução** (`tests/spatial-persistence-failures.test.ts`, injecção real: directório da store tornado só de leitura a meio do ensaio): antes da correcção, undo, operação legada e criação de sessão por plano respondiam 200 (ou criavam a sessão) com a escrita a falhar; só a transacção tinha rollback.

**Correcção** — o padrão da transacção foi estendido a todas as rotas que mudam sessões V2:
- `/api/spatial/v2/undo`: snapshot completo (plano, revisão, história, pendingRefinement) antes do pop; persistência a falhar repõe tudo, apaga o recibo de undo tentado e responde `500 SPATIAL_SESSION_PERSISTENCE_FAILED` — sem história fantasma, sem incremento, sem recibo;
- `/api/spatial/v2/operation|edit|refine`: snapshot antes da mutação (inclui `refinementsUsed`), mesmo rollback e 500;
- `/api/spatial/v2/plan` (sessão criada a partir de plano): a sessão é apagada e a resposta é 500, nunca um plano com sessão não durável;
- `/api/spatial/v2/adopt` e `/transactions` já tinham este comportamento e mantêm-no.
Depois de cada falha induzida, a mutação equivalente com o disco desbloqueado comete exactamente uma vez na revisão esperada, e um restart confirma que só o estado reconhecido existe. Ao carregar, planos, história e recibos são agora validados contra os contratos reais (`validateSpatialPlanV2`, fingerprint hex, contrato do recibo): um documento com um plano ou recibo corrompido é posto em quarentena inteiro, nunca carregado a meio. O modo volátil continua explícito (`sessionDurability: 'volatile'`) e não se alega garantia contra perda de energia (sem fsync).

## Achado 2 — Undo fenced de uma só operação

As entradas de história guardam agora `fenced: true` quando a transacção trazia precondição de revisão (incluindo entradas reconciliadas). O undo de uma entrada fenced — tenha ela uma operação ou muitas — usa sempre o caminho agrupado idempotente (`undoTransaction`/`reconcileUndo`, chave estável, estado `undoUnresolved`), nunca o `sync.undo` legado: uma resposta perdida já não pode disparar um rollback local sem confirmação. Teste novo na camada: commit fenced de 1 operação, undo com resposta perdida → `legacyUndo` nunca chamado, estado por resolver, reconciliação adopta o plano autoritativo. Sessões legacy não mudam.

## Achado 3 — Continuidade da política no SpaceFlow

`openRelationReview` passou a vincular a sessão ao registo: depois de obter/criar a revisão para o plano exacto em palco, o `SpaceFlow` re-adopta a sessão como `review_fenced` (o servidor valida o binding) e regista `sessionPolicy`/`sessionDurability` reportados pelo servidor. Se o plano em palco não puder ser vinculado ao registo (fingerprint incompatível), fecha: a sessão é largada para local-only com a razão visível, em vez de continuar como legacy irrestrito. As recuperações explícitas (transacção e undo) re-adoptam com a mesma política quando ela é fenced e o binding confere; quando não confere, falham fechadas — uma sessão fenced nunca é recuperada como `legacy`.

**Refresh de revisões após mutação:** uma mutação bem sucedida muda o plano, logo a fingerprint muda e o registo antigo deixa de vincular — nunca é reutilizado para o plano novo. Abrir «Rever relações» depois de uma mutação cria (ou reabre, por fingerprint exacta) um registo novo para o plano actual; o registo antigo fica preservado para o plano a que pertence. Isto é intencional e está documentado aqui porque é o comportamento que o próximo revisor vai observar.

No browser (backend real), abrir a revisão muda `sessionPolicy` para `review_fenced` e um pedido directo sem fence à mesma sessão passa a receber 403.

## Achado 4 — Integridade do conteúdo da idempotência

A fingerprint da transacção incluía operações, proveniência e fence, mas não `approvalActor`: a mesma chave com outro actor fazia replay silencioso. Passou a incluir `approvalActor` (e, desde E1.2, o fence); a mesma chave com actor diferente dá `409 SPATIAL_V2_IDEMPOTENCY_KEY_CONFLICT`, e o replay fiel devolve o recibo original imutável, com o actor original (testado).

## Invariantes de persistência (estado final)

Para qualquer mutação V2 respondida com sucesso: o estado foi validado, publicado em memória e gravado (ou a sessão é declaradamente volátil). Para qualquer falha de gravação: 500, memória restaurada exactamente, nenhum recibo/história/revisão fantasma, e restart mostra só o que foi reconhecido. Testes 1–9, 13 e 14 da matriz estão cobertos por HTTP real com injecção de falha e restart sequencial de servidores sobre os mesmos ficheiros.

## Testes e evidência

- Novos: `spatial-persistence-failures` (4), undo fenced de 1 operação (camada), política no browser E1. Focados do sistema revisto: 80/80.
- Browser: `v4-e1-review-browser` (revisão, sessão fenced após abrir revisão, 403 sem fence, commit fenced, undo, reabertura após reload; screenshots em `/tmp/unfold-v4-e1-browser-*/`), `v4-e0-atomic-browser` e `v4-worker-integration` verdes (testes 10–12, 15).
- Build verde. Suite por defeito: 2509 verdes, 4 falhas — exactamente os quatro timeouts herdados (`rendering-lifecycle`, `universal-spatial-buried` ×2, `bucket-width`; «timed out in 5000ms», passam isolados), sem workers/timeouts alterados e sem assertions enfraquecidas.

## Limites que ficam

- Sessões V1 (`/api/spatial/*`) nunca foram persistidas e continuam voláteis por desenho; as garantias de rollback por persistência aplicam-se às sessões V2, que são as que têm store.
- Sem fsync não há garantia contra perda de energia; single-processo apenas.
- A sessão fenced nasce de uma re-adoção quando a revisão abre: durante a janela entre a adopção inicial legacy e a abertura da revisão, a sessão é legacy com fence por transacção (E1.2) — a política torna-se de sessão a partir daí, e nenhuma mutação revista pode ter sido cometida antes sem fence no cliente do produto.
- Autenticação de revisor/aprovador continua inexistente e declarada.

## GO/NO-GO para integrar com E2.2

**GO.** Os quatro achados estão corrigidos com testes que os reproduziam: nenhuma mutação durável é reconhecida sem estar gravada, o undo fenced é exactamente-once para qualquer tamanho de lote, a política de sessão sobrevive a adopção, recuperação e restart sem downgrade, e a chave de idempotência identifica o pedido completo. O E2.2 deve submeter propostas com binding e esperar `SPATIAL_SESSION_PERSISTENCE_FAILED`/`SPATIAL_REVIEW_PRECONDITION_STALE` como recusas terminais daquela proposta.
