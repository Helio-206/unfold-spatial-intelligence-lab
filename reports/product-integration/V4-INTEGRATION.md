# Integração experimental V4

## Origem e isolamento

Base `ac8e4e1c74dafbc2a3af70fba0017e20cc31a61d` (V3, Voice e shader lifecycle), origem `a5aa384281a826ca91d11845276df5338ac616a2`. O merge commit `ff311fc` tem ambos como pais, preservando os commits V4 `9644be9`, `697e867`, `7bf52ea` e `a5aa384`. Não se integrou em `produto`. A remoção da rota `/universal-spatial-v2` e os seus ficheiros/testes, proposta no branch V4, foi excluída da integração; a rota permanece.

## Percurso experimental

V4 permanece desligado por defeito. Apenas `/living?debug-living&experimental-v4` expõe `window.__v4`: `run({ sourceSha256, evidence, allowContradicted?, confirmed? })` para o solver estrutural, `runShapes(...)` para alternativas de primitivas, `preview()`, `cancel()` e `dispose()`. `evidence` usa `EvidenceJSON` do V4, limitado a 3–24 vistas e máscaras até 256×256; alternativas exigem pelo menos quatro vistas independentes. As propostas não alteram o plano: `preview()` abre a proposta no inspector; aplicar exige autorização explícita. `confirmed` e `allowContradicted` são decisões afirmadas pelo chamador, não uma identidade humana autenticada. Não há UI de revisão persistente de relações nesta integração.

Cada trabalho executa num Worker dedicado, com timeout de 15 s e cancelamento por Space, fonte, revisão, pedido novo ou dispose. O resultado é descartado se a camada, a versão da explicação/geometria ou o hash declarado do plano mudar; `preview()` volta a verificar. O hash comparado é o hash declarado no plano, não uma prova de que os bytes da imagem foram verificados nem um vínculo autenticado entre máscaras e fonte. Não enviar dados de terceiros ou alegar que a evidência é observada apenas por passar esta comparação. O código V4 existente continua disponível como biblioteca e é síncrono se chamado diretamente; o percurso experimental do produto usa o Worker.

O endpoint atual de sessão aplica uma operação por pedido. Por isso **qualquer lote sincronizado de várias operações é recusado antes da primeira chamada**, incluindo undo agrupado após anexar uma sessão; não há rollback nem atomicidade remota alegados. O modo local suporta aplicação agrupada e um undo exato. É necessária uma transação atómica de servidor, revisionada e idempotente, para suportar estes lotes com sessão sem divergência em falhas parciais. A operação única mantém o comportamento anterior de perda de sincronização e edição local. Este bloqueio também afeta outras operações agrupadas sincronizadas, incluindo correções de cor ou solver com múltiplos passos.

`meshWorldTriangles` expande matrizes de `InstancedMesh` em mundo; é usado na extração do solver, alternativas e geração de evidência. Não muda o compilador nem a geometria apresentada. O shader lifecycle, a coalescência V3, a revisão Voice, a seleção e o Director são mantidos no layer resultante. Resultados de undo atrasados não reconstroem uma camada já descartada.

## Evidência de browser

`tests/e2e/v4-worker-integration.pw.mjs` abre `/living` com rota de plano e adoção simuladas, sem rede paga. Resultados completos e screenshots locais em `/tmp/unfold-v4-final/`:

- Escavadora e harpa: planos Meta guardados com perturbação sintética; evidência renderizada a partir do plano guardado, não da fotografia. Sob override explícito de relações contraditas no teste, o Worker propôs, manteve o plano intacto até preview/autorizar, aplicou e fez undo exato. Na escavadora, edição durante o pedido causou `V4_STALE`.
- Pulmões e microscópio: planos manuais degradados sinteticamente, evidência renderizada da fixture manual. O motor recusou inicialmente `NO_STRUCTURAL_SUPPORT`; um passo do teste simulou explicitamente confirmar as hipóteses, após o qual propôs, aplicou com autorização e fez undo exato. Isto não comprova revisão por pessoa. No microscópio, a execução de alternativas examinou 6 peças e devolveu 1 proposta sem alterar o plano.
- O contador de callbacks continuou a avançar durante o cálculo no Worker. Isto demonstra responsividade nesse ensaio, não um limite de latência de dispositivos reais. As capturas são reproduções e não demonstram fidelidade fotográfica.

Os testes unitários cobrem cancelamento/dispose/respostas obsoletas, hash de fonte, validação básica de evidência, expansão de instâncias, bloqueio de lotes sincronizados e undo após dispose. A cobertura completa do produto e os resultados no SHA do PR devem ser consultados na descrição do PR.

## Limites e recomendação

**NO-GO para Fase E como integração produtiva** até existir transação atómica remota, revisão humana e persistência verificáveis, vínculo de evidência à fonte real, testes de falhas reais de rede e validação de desempenho/recursos em hardware físico. As propostas V4 e a confirmação de hipóteses são experimentais; não há prova de fidelidade à escavadora real nem de precisão anatómica. O passo seguinte pode preparar desenho e testes da fase E, preservando o estado dos commits de origem; não ativar o V4 por defeito nem fazer merge.
