# Unified Spatial Workspace — integração da UX com a reconstrução e o workspace

Branch `feat/unified-workspace-integration-prep`. Contém, por ancestralidade, o PR #15 (workspace + motor), o PR #17 (API de reconstrução, `9a3b3e0`) e os PRs #16/#18 do Claude Design (`fd31ba1`). Não toca na Foundry, no Cinema nem no servidor.

## O percurso (`/living`)

`/living` abre como antes: o workspace com a máquina de referência. A sua barra de ferramentas ganhou «Reconstruir uma máquina», que leva (por navegação real, para o histórico do browser continuar a funcionar) a `/living?flow=reconstruct`:

```
fonte ─▶ reconstrução (porta real) ─▶ revisão das entidades ─▶ o que o servidor pede ─▶ transição ─▶ workspace
 vazio     POST /api/living/reconstruction   portão 1 (humano)    POST … action:review     (Design)     montagem aprovada
```

O laboratório é **um só**: o `SpatialWorkspace` de `/living`, agora construído a partir da montagem aprovada. O palco cinemático do Design serve só o estado vazio e a transição; quando o workspace monta, esse palco pára de renderizar e fica escondido.

## Arquitectura

| Peça | Onde | Papel |
|---|---|---|
| `LiveReconstructionPort` | `unified-workspace/live-port.ts` | Implementa o `ReconstructionPort` do Design sobre a rota real. Pede sempre `mode: live`; recusa uma resposta *offline* a um pedido live; mapeia cada falha para os resultados que a UI já mostra; converte WebP em PNG antes de enviar; guarda o `sessionId`. |
| `ReviewGateway` | `unified-workspace/review-bridge.ts` | Traduz a revisão da UI para o contrato do backend, envia-a para a **mesma** sessão do servidor, adopta a montagem e pede o portão 2 ao motor. |
| `ReconstructionSession` | `unified-workspace/reconstruction-session.ts` | Máquina de estados (propor, rever, cancelar, expirar, reabrir) com descarte de respostas obsoletas. |
| `adoptReviewed` | `unified-workspace/workspace-adapter.ts` | Única passagem de uma reconstrução para o workspace; falha fechado. |
| `validateWithEngine` | `unified-workspace/engine-gate.ts` | Portão 2: o motor resolve a pose de referência desta montagem. |
| `WorkspaceLabHost` | `unified-workspace/lab-host.ts` | Monta/desmonta o workspace com a montagem aprovada. |
| `mountLivingShell` | `unified-workspace/shell.ts` | Rota `/living`. |
| Interfaces `ReviewHandoff`, `LabHost` | `experience/integration.ts` | As costuras que o Design deixou por preencher, do lado da experiência: ela nunca importa o cliente da API. |

### Decisões da UI → contrato do backend (sem confirmação automática)

A UI do Design decide **por entidade**; o backend exige mais. Nada é inferido:

- `confirmada → confirm`; `rejeitada → reject`; `corrigida → reject` (a pessoa substituiu a interpretação do modelo, logo a afirmação do modelo não fica confirmada); `pendente →` sem decisão, e bloqueia.
- O que os cartões não mostram e o servidor exige (afirmações do modelo, relações em hipótese, pedidos de alteração) aparece no passo 2, «o que o servidor pede», cada item com decisão explícita. Os botões em bloco só actuam sobre o que ainda não foi decidido e são um clique da pessoa. Um pedido de alteração só pode ser ignorado: não existe adaptador para o confirmar.
- Família, caçamba, revisor, largura e a sua origem começam **vazios**; o botão fica bloqueado até a pessoa os preencher.
- Decisões que a API não recebe (rejeitar/corrigir algo que não é hipótese, valores introduzidos) são listadas no ecrã como «ficam só neste ecrã». As correcções não são aplicadas pela API.

### Validação estrutural ≠ validação pelo motor

| | Quem | O que prova | Onde aparece |
|---|---|---|---|
| contrato válido | servidor + `adoptReviewed` | a estrutura da montagem e a proveniência cumprem o contrato | nunca como «validada» |
| portão 2 | Engineering Engine | o solver resolveu a pose de referência desta montagem (`solver@versão` visível) | portão 2 e aviso do laboratório |

Se o contrato é válido mas o motor recusa (por exemplo `STROKE_OUT_OF_RANGE`), a UI diz as duas coisas, mostra o motivo, e o laboratório **não abre**. `valid` não certifica segurança, resistência nem colisões, e o aviso do laboratório di-lo.

### Substituir a montagem

Substituir é desmontar o workspace e construir outro: sessão do motor, registo de componentes, cena, mão, selecção e conversa nascem da montagem nova em vez de arrastarem a antiga. Voltar à revisão (ferramenta «Rever a reconstrução» na barra) desmonta o workspace; as decisões e os campos do servidor mantêm-se e a sessão do servidor é reaberta. «Nova máquina» esquece tudo.

## Alterações a ficheiros do Design e do PR #15 (todas aditivas, excepto as duas indicadas)

- `experience.ts`: opções `handoff` e `lab`; sem elas a página é o protótipo, inalterada. Passo 2 da revisão, `openLab`, montagem/desmontagem do laboratório, texto dos portões exportado (`gateText`).
- `intake.ts`, `flow.ts`: `sessionId` opcional no resultado e no estado.
- **`review.ts` (alteração de comportamento):** uma hipótese ainda por decidir conta como estrutura *possível*. Antes, uma reconstrução só com hipóteses (o caso normal de uma resposta real) dizia «dados insuficientes, importe outra fonte» antes de a pessoa decidir qualquer coisa. Agora diz «hipóteses por decidir», e só passa a «insuficiente» se rejeitar algo que torna a máquina impossível. Teste a vermelho primeiro (`readiness.test.ts`).
- **`tests/living/experience-flow.test.ts`:** a expectativa do cenário «dados insuficientes» deixou de listar «braço» (é uma hipótese pendente, logo possível). A cobertura original mantém-se: rejeitar essa hipótese volta a listar «braço».
- `workspace.ts`, `workspace-state.ts`, `workspace.css`, `page.ts`: opções `initialNotices` (com `detail` recolhível), `brandLabel`, `extraTools`; `mountLivingWorkspace(host, extra)`. Duas regras de CSS para a etiqueta/logótipo não ficarem por baixo dos avisos em ecrãs estreitos.
- `main.ts`: `/living` passa pelo shell.

## O que o servidor não distingue (lacuna do PR #17, não alterada aqui)

Para uma fonte que não mostra uma escavadora, o servidor lança `ASSEMBLY_UNSUPPORTED_MACHINE` ao montar a proposta e responde `502 RECONSTRUCTION_FAILED`, igual a qualquer erro interno. O cliente não consegue distinguir «não é uma escavadora» e mostra «falhou», com o código visível e uma indicação para tentar outra fonte. O estado «não identificada» do Design só é alcançável por uma resposta *com* observação mas sem entidades. Corrigir exige alterar `server/meta-server.ts` (ficheiro do PR #17): devolver a observação com `machineType: unknown`.

## Evidência (esta branch)

Chromium (Google Chrome do sistema) com **SwiftShader**. Não se testou GPU real: nada aqui sustenta afirmações de desempenho em hardware. Não houve chamadas pagas: o fornecedor é um `fetch` simulado que conta chamadas (uma por percurso; a revisão nunca lhe chega).

| Verificação | Resultado |
|---|---|
| `npx vitest run --testTimeout=15000` | 101 ficheiros, 1837 testes (base `9a3b3e0`: 90 e 1698) |
| `npx tsc --noEmit`, `npm run build`, `git diff --check` | limpos |
| `tests/e2e/unified-living.pw.ts` (novo) | 18 verificações: percurso real a 1440/768/390 px (sem scroll horizontal nem sobreposições), motor + Digital Hand + conversa na montagem reconstruída, voltar à revisão e remontar, «Nova máquina», cancelar, 422, sessão expirada, portão 2 bloqueado, WebP→PNG, `/living` de referência, histórico com e sem back-forward cache |
| E2E do Design (`living-experience.pw.mjs`) | 39/39 |
| PR #15: motor 16, histórico 4, Digital Hand 7, revisão 8, regressões do workspace 3 e 4 | passam |
| Foundry: regressões 25/25, principal 52/52 | passam |
| Cinema 189/189, histórico do Cinema | passam |

Correr o novo E2E: `npx tsx tests/e2e/unified-living.pw.ts` (`CHROME_PATH`, `UNFOLD_UNIFIED_OUT`). Capturas em `reports/unified-workspace/captures/`. Os E2E antigos gravam por omissão em pastas de relatórios versionadas; correram com a saída redirecionada para não as alterar.

Defeitos encontrados e corrigidos durante a integração, cada um com teste a falhar primeiro: «dados insuficientes» para uma reconstrução só de hipóteses; sessão presa em `reviewed` depois de o motor recusar (as edições eram ignoradas e o botão não voltava a enviar); `human()` vazio depois de uma revisão aceite.

## O que não está feito / não verificado

- **Geometria premium (Foundry/Cloud):** a malha continua a desenhar a caçamba com meia largura fixa; a largura aprovada está no contrato, e o laboratório di-lo num aviso. É a última dependência e não foi tocada.
- **Modelo real:** o cliente nunca falou com o Muse Spark (sem chamadas pagas). NOT VERIFIED.
- **Correcções e valores introduzidos** pela pessoa na revisão não chegam à geometria: a API não tem campo para eles.
- **Fonte sem escavadora:** ver a lacuna do servidor acima.
- **Revisão independente** deste PR: ainda não pedida.
