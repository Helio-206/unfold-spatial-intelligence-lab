# V4 E1.1 — Correcção da ligação revisão→solver

- Branch isolada: `feat/v4-e1-review-correctness`, a partir de `feat/v4-e1-human-review@14aaa192918cde97189d85ce71a1ff3370d06a53`. Sem merge, sem branches protegidos tocados, V4 desligado por defeito, sem E2-A.
- SHA final: ver `git log -1` nesta branch (o relatório entra no commit final).

## Defeitos reproduzidos

Os 9 testes novos falharam todos na implementação E1 (antes da correcção):

1. **Binding por fonte apenas.** `openRelationReview` escolhia o primeiro registo com o mesmo `source.sha256`; duas geometrias diferentes da mesma fonte partilhavam decisões. A elegibilidade não verificava a que plano pertencia um `reviewId` vindo do cliente.
2. **Relações rejeitadas continuavam impostas.** O gate produzia `rejectedSubjectIds`, mas o Worker só recebia `confirmed` e `allowContradicted`; o `classifyRelations` impõe qualquer relação declarada e geometricamente suportada, confirmada ou não — incluindo uma que uma pessoa rejeitou.
3. **Correcções eram decorativas.** `correctedValues` nunca chegava ao Worker; uma relação corrigida era avaliada com o tipo e os extremos originais.
4. **Corrida preview→autorização.** Entre o fim do Worker e o `preview()` síncrono (e entre preview e autorização), uma decisão nova não invalidava a proposta.

## Correcções

**P0 — Binding exacto** (`review-v1.ts:canonicalPlanJson`, servidor, `api-client.ts:spatialPlanFingerprintV2`, `flow.ts:openRelationReview`)
A fingerprint é o sha256 do JSON canónico do plano (chaves ordenadas), calculada da mesma forma no servidor e no cliente. A lista de revisões filtra por fonte **e** fingerprint; o `SpaceFlow` só reabre um registo cuja fingerprint e fonte confiram exactamente com o plano em palco — caso contrário cria um registo novo para este plano. A elegibilidade aceita `planFingerprint`/`sourceSha256` esperados e responde `409 SPATIAL_REVIEW_BINDING_MISMATCH` se o registo pertencer a outro plano ou fonte; o `ExperimentalV4` calcula a fingerprint do plano actual e exige essa verificação ao servidor e outra vez localmente antes de correr. Um `reviewId` fornecido pelo cliente nunca é aceite sem esta verificação.

**P1+P2 — Projecção de relações revistas** (`review-v1.ts:projectReviewedPlan`)
O solver passou a consumir uma projecção validada do plano, construída só das decisões registadas:
- relação **rejeitada**: ausente da projecção — o solver não a pode continuar a impor só por existir no plano; o plano original e o histórico mantêm-na intactos (a projecção é uma cópia só para o solver);
- relação ou hipótese **corrigida**: presente na projecção com o tipo e os extremos corrigidos, marcada `user_provided`, e é essa versão que o classificador avalia (uma correcção para `adjacent_to` deixa de ser imposta como junção; uma hipótese corrigida para `attached_to` passa a relação real imposta);
- hipótese **adiada** ou por decidir: fora do conjunto imposto, nunca promovida;
- correcção que o contrato do plano não representa (componente inexistente, tipo inválido, auto-relação) faz `projectReviewedPlan` lançar `REVIEW_CORRECTION_UNSUPPORTED` — resultado explícito de recusa, nunca a relação original aplicada em silêncio.
O Worker recebe a projecção (clonada), o conjunto confirmado e o `allowContradicted` do gate. Nenhuma relação original é apagada do plano nem da história para os testes passarem, e nenhuma assunção física nova é introduzida: a projecção só reafirma decisões sobre afirmações existentes.

**P3 — Protecção de corrida** (`experimental-v4.ts:preview`, `layer.ts:applyEdit`)
Cada resultado pronto guarda `reviewId`, `reviewRevision` e `planFingerprint`. O `preview()` é agora assíncrono: revalida no servidor (revisão fixada + binding) e recusa se a revisão mudou, se o plano mudou ou se a revalidação falhar por rede — fail closed. Ao fazer preview, arma o `authorisationGuard` da proposta na camada com a mesma revalidação; em `applyEdit`, um guard que falhe (ou lance) invalida a proposta com notificação e nada é aplicado. Propostas sem revisão associada mantêm o comportamento anterior (o guard é trivialmente válido).

## Testes (regressão: falham no E1, passam agora)

- `tests/spatial-review-projection.test.ts` (novo): rejeitada suportada não imposta (classificador + recusa do motor por `NO_STRUCTURAL_SUPPORT`); corrigida muda a semântica real avaliada; hipótese corrigida vira relação imposta e adiada fica de fora; correcção não representável lança `REVIEW_CORRECTION_UNSUPPORTED`; registo de outra fonte lança `REVIEW_BINDING_MISMATCH`; preview recusa quando a revisão muda depois do Worker (teste 6); review em falta faz o run falhar fechado antes do Worker (teste 8).
- `tests/spatial-space-layer.test.ts`: guard de autorização que falha entre preview e autorização impede a aplicação e notifica (teste 7); com o guard válido, aplica.
- `tests/spatial-review-v1.test.ts`: mesma fonte/diferente fingerprint não reutiliza registo (lista filtrada) e elegibilidade com fingerprint/fonte estrangeiros dá 409 (testes 1–2); persistência, corrupção, hashes, concorrência e não-autorizado de E1 continuam verdes (teste 9). Os testes existentes de `preview()` síncrono foram actualizados para a nova assinatura assíncrona, sem enfraquecer asserções.
- Focados: 63/63 (`spatial-review-projection`, `spatial-review-v1`, `spatial-space-layer`, `spatial-transactions-v2` — transacções atómicas e undo E0 intactos, teste 10 — e `experimental-v4`).
- Browser: `v4-e1-review-browser` verde com store isolada por execução (a reutilização da store antiga expôs precisamente o binding a funcionar: o registo antigo era reaberto — decisões de 2 execuções somadas — por isso o ensaio passou a usar um directório novo por corrida); `v4-e0-atomic-browser` verde (revisão 1, undo agrupado → 2, plano exacto); `v4-worker-integration` (escavadora) verde, com recusa sem revisão e `V4_STALE` mantidos.
- Build verde. Suite completa: 2489 verdes e 7 falhas, todas «Test timed out in 5000ms» em testes pesados de geometria/solver (`reconstruction-hierarchy`, `universal-spatial-buried`, `rendering-lifecycle`, `bucket-width`, `foundry`); o conjunto exacto varia com a carga entre corridas (3–9) e todos passam isolados (verificado: `reconstruction-hierarchy` + `handoff` + `buried`, 26/26). São os timeouts herdados já documentados, em ficheiros não tocados por este trabalho; não afirmei suite verde nem alterei limites.

## Limites que ficam

- A projecção é calculada no cliente a partir do registo devolvido pelo servidor e a fingerprint é verificada nos dois lados; um cliente malicioso pode ignorar a revisão por completo e chamar o motor de biblioteca directamente — a protecção vale para o caminho do produto (`ExperimentalV4`), que é o que está ligado ao workspace. O motor de biblioteca continua a aceitar `confirmed`/`allowContradicted` como opções de baixo nível para os seus próprios testes e benchmarks.
- Entre a revalidação do guard e o commit da camada existe ainda a janela de uma decisão gravada exactamente nesse intervalo; o commit posterior continua a exigir autorização humana e a decisão não é sobrescrita — mas a proposta pode aplicar-se com a revisão anterior por uma margem de um pedido. Fechar isso exigiria uma precondição de revisão dentro da transacção do servidor (trabalho E0/E2, fora deste âmbito).
- Correcções a relações que o motor não sabe impor (p. ex. `contains`) são avaliadas como não-impostas: semanticamente correctas para o solver actual, mas o motor não verifica contenção.
- Persistência, autenticação inexistente e os casos ambíguos de operação única/undo agrupado mantêm-se como documentados em E0/E1.

## GO/NO-GO para integrar E1 com E2-A

**GO.** Os três defeitos estão corrigidos com testes que os reproduziam: decisões não atravessam planos nem fontes, relações rejeitadas/adiadas não são promovidas pelo solver, correcções são avaliadas como corrigidas (ou recusadas explicitamente), e uma proposta fica invalidada se a revisão mudar antes da autorização. A integração com E2-A deve consumir apenas a projecção e o gate aqui definidos, mantendo preview e autorização.
