# Unified Spatial Workspace — integração da UX com a reconstrução e o workspace

Branch `feat/unified-workspace-integration-prep`. Contém, por ancestralidade, o PR #15 (workspace + motor), o PR #17 (API de reconstrução, `9a3b3e0`), os PRs #16/#18 do Claude Design (`fd31ba1`) e o PR #19 do Claude Cloud (Foundry premium e caçamba parametrizada, `b8d494a4`, integrado por merge sem conflitos). Não altera a Foundry, o Cinema nem o servidor.

## O percurso (`/living`)

`/living` abre **vazio**: um palco limpo, sem máquina, com a ação primária (importar fotografia, desenho técnico ou descrição), os formatos e limites, e um **Abrir exemplo** secundário. O exemplo (`/living?example=1`) é a máquina sintética de referência, identificada como «exemplo · montagem sintética» e com um aviso de que não foi reconstruída a partir de nenhuma fotografia; «Novo projecto» volta ao laboratório vazio. A passagem entre os dois é por navegação real, para o histórico do browser continuar a funcionar. O percurso de reconstrução:

```
fonte ─▶ reconstrução (porta real) ─▶ revisão das entidades ─▶ o que o servidor pede ─▶ transição ─▶ workspace
 vazio     POST /api/living/reconstruction   portão 1 (humano)    POST … action:review     (Design)     montagem aprovada
```

O laboratório é **um só**: o `SpatialWorkspace` de `/living`, construído a partir da montagem aprovada e com o perfil premium da Foundry (#19: `applyPremiumLook` e o ambiente de `PREMIUM_STUDIO`, os mesmos do Cinema, sem iluminação nova). O palco cinemático do Design serve só o estado vazio e a transição; quando o workspace monta, esse palco pára de renderizar e fica escondido.

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

- **Geometria premium (Foundry/Cloud):** integrada pelo #19: a malha lê a largura da caçamba do contrato (verificado: 1,10 m → 1,154 m, 1,40 m → 1,454 m). Esta frase, escrita antes do #19, dizia o contrário e foi corrigida.
- **Modelo real:** o cliente nunca falou com o Muse Spark (sem chamadas pagas). NOT VERIFIED.
- **Correcções e valores introduzidos** pela pessoa na revisão não chegam à geometria: a API não tem campo para eles.
- **Fonte sem escavadora:** ver a lacuna do servidor acima.
- **Revisão independente** deste PR: ainda não pedida.


---

# Integração final (PR #19, demonstração)

## Geometria paramétrica: a largura da caçamba

A Foundry (#19) desenha a caçamba a partir de `assembly.parts[id=bucket].shapes[id=bucket-box].halfExtentsM[2]` e **lança erro** fora de 0,30 a 1,20 m de meia largura (0,60 a 2,40 m no total). A API do #17 aceita 0,10 a 10 m. Sem tratamento, o `SpatialWorkspace` rebentava ao montar uma montagem aceite pela API.

Resolução: um validador partilhado (`unified-workspace/visual-capacity.ts`) derivado do próprio intervalo da Foundry (um número, não dois). Recusa, com o motivo e sem ajustar o valor, em três pontos: no formulário (antes de enviar), em `adoptReviewed` (antes de o motor ser consultado) e no `WorkspaceLabHost` (defesa em profundidade). O servidor não foi alterado: a diferença de limites fica documentada e protegida do lado do cliente.

Medido na malha 3D real do workspace (`bucket-width-measurements.json`):

| Caso | Contrato | Malha (extensão Z do grupo `bucket`) |
|---|---|---|
| A | 1,10 m | 1,154 m |
| B | 1,40 m | 1,454 m (+0,300 m, mais um dente) |

13 peças canónicas, todas as articulações do contrato e *picking* na caçamba preservados nos dois casos. Capturas: `captures/bucket-1.1m-lab.png`, `captures/bucket-1.4m-lab.png`. Larguras recusadas (0,5; 2,5; 3 m): `captures/width-*m-refused.png`.

## Perfil premium no workspace

`SpatialWorkspace` ganhou `look: 'premium'`. Aplica-se antes de construir o `SceneController` (isolar e fantasmar partem dos materiais premium e voltam a eles) e reverte tudo ao desmontar (materiais, ambiente, exposição). O construtor do ambiente vive em `cinema/` e uma regra de arquitetura do Cloud proíbe o workspace de importar o Cinema; por isso é **injetado** (`premiumEnvironment`) por quem integra. O `/living` de referência sem opções mantém o aspeto anterior.

## Prova com a Meta (live)

Os ficheiros brutos (`run.json`, `observation.json`, capturas com a fotografia de terceiros) estão em `reports/unified-workspace/live/` **apenas na máquina que fez a execução**: o `.gitignore` do repositório exclui `reports/**/live/` ("live Meta responses are not published") e essa regra foi respeitada. Aqui fica o resumo verificável. Percurso: ficheiro escolhido na interface → proxy do Vite (porta 5173) → backend → Meta Muse Spark.

- Entrada: *Doosan_tracked_excavator.jpg*, Wikimedia Commons, 960×638, 245 006 bytes, SHA-256 `0e8bb9e5…159f5`, igual ao registado no PR #17.
- **Request `27d2be4e-e6b9-4444-b577-b97828e32c43`**, modelo `muse-spark-1.3`, HTTP 200, `completed`, 27,3 s, 3 897 tokens (~0,014 USD). Uma única chamada paga. Sessão `1973f6c4-…`, `mode: live`.
- Observação validada: `excavator`, 7 entidades (5 observadas: corpo superior, rastos, chassis, lança, braço; 1 hipótese: cilindro; 1 desconhecida: caçamba, escondida nos escombros), 5 relações, 0 dimensões, 8 desconhecidos.
- **A revisão desta prova foi feita por um script, não por uma pessoa.** Política: confirmar as hipóteses, corrigir a entidade desconhecida para o seu tipo, deixar as observadas, rejeitar relações e afirmações, largura 1,40 m declarada fictícia (a fotografia não tem escala). Isto demonstra o canal, não a fidelidade do modelo nem uma decisão humana.
- Resultado: `contract_valid`, largura 1,10 → 1,40 m, portão 2 `solved` (`unfold.engineering.forward-kinematics@0.1.0`, resíduo 1,8e-15 m), lab aberto (13 peças, premium, caçamba de 1,454 m).
- O texto do aviso do laboratório foi encurtado depois desta execução; as capturas da prova mostram o texto anterior. Não se repetiu a chamada paga por isso.
- Resumo da observação recebida (sem o texto bruto):

| id | tipo | estado | confiança |
|---|---|---|---|
| e_house | house | observado | 0,92 |
| e_track | track | observado | 0,90 |
| e_chassis | chassis | observado | 0,85 |
| e_boom | boom | observado | 0,93 |
| e_stick | stick | observado | 0,88 |
| e_cyl | cylinder | hipótese | 0,40 |
| e_bucket | bucket | desconhecido | 0,20 |

  Cada entidade com uma evidência. Mais: 1 afirmação do modelo (a caçamba estaria escondida nos escombros), 5 relações, nenhuma dimensão, nenhum pedido, 8 itens que a fonte não diz (massa, materiais, eixos e cursos, cilindros, caçamba oculta, comprimentos de lança e braço, cabina e contrapeso, trem de rodagem).
- A máquina que se vê no laboratório é a **geometria sintética de referência** com a largura da caçamba indicada; não é uma forma recuperada da fotografia (que mostra uma Doosan laranja a demolir uma casa).

## Testes (SwiftShader, sem GPU real)

Os resultados finais estão na secção seguinte.

## Resultados finais (SHA do commit deste relatório, ver o PR)

Chromium (Google Chrome do sistema) com **SwiftShader**. Não se testou GPU real: nada aqui sustenta afirmações de desempenho em hardware.

| Verificação | Resultado |
|---|---|
| `npx vitest run --testTimeout=15000` | 106 ficheiros, 1885 testes |
| `npx tsc --noEmit`, `npm run build`, `git diff --check` | limpos |
| `tests/e2e/unified-living.pw.ts` | 24 verificações: primeira utilização, percurso real a 1440/768/390 px, erros da Meta, 422, sessão expirada, portão 2 bloqueado, larguras 1,10/1,40 m na malha, larguras recusadas, WebP→PNG, voltar/remontar, histórico com e sem back-forward cache |
| E2E do Design (`living-experience`) | 39/39 |
| PR #15: motor 16, histórico 4, Digital Hand 7, revisão 8, regressões 3 e 4 | passam |
| Foundry: regressões 25/25, principal 52/52 | passam |
| Cinema 203/203, histórico do Cinema | passam |
| Prova com a Meta (`live/`) | executada uma vez; ver acima |

Os E2E do workspace abrem agora `/living?example=1`: o contrato mudou (`/living` abre vazio) e a cobertura é a mesma, no modo exemplo. Os E2E antigos correram com a saída redirecionada para não alterar relatórios versionados.

## Limitações reais que permanecem

- **GPU real:** não testada. Tudo em SwiftShader.
- **Fidelidade:** a máquina do laboratório é geometria sintética de referência com a largura da caçamba indicada. Não é fotogrametria nem forma recuperada da fotografia; o produto di-lo em vários sítios.
- **Largura:** é sempre uma declaração do utilizador (não verificada). Nenhuma dimensão vem da imagem.
- **Correcções e valores introduzidos** na revisão não chegam à geometria (a API do #17 não tem campo para eles); o ecrã mostra o que é enviado e o que fica só local.
- **Revisão da prova live:** feita por um script. Não há, nesta entrega, evidência de uma revisão feita por uma pessoa.
- **Limites desencontrados:** a API aceita 0,10–10 m e a Foundry 0,60–2,40 m. Está protegido no cliente; o ideal é o servidor recusar fora do intervalo desenhável (`reviewReconstruction` em `server/review.ts`, validar `bucketWidthM` contra `BUCKET_HALF_WIDTH_RANGE_M*2` e devolver 422 com o mesmo motivo). Não alterado: é do PR #17.
- **Fonte sem escavadora:** o servidor responde 502 genérico (`ASSEMBLY_UNSUPPORTED_MACHINE` não é distinguido); a interface mostra «falhou», não «não identificada». Correção no `meta-server.ts` do #17.
- **Sessão do servidor** só em memória (30 min); reiniciar o servidor invalida-a (tratado como sessão expirada).
- **Uma única fotografia** foi exercitada com o modelo real. Isto não mede a qualidade do modelo.

## Veredicto para a demonstração: GO, com condições

**GO** para demonstrar o percurso completo e verificável: laboratório vazio → fotografia real → Meta Muse Spark → revisão humana → contrato → motor → geometria paramétrica no workspace real → interação, com regressões verdes. **Condições**: apresentar como *reconstrução espacial assistida por IA sobre uma família mecânica suportada, com revisão humana e geometria paramétrica de referência*; dizer que a revisão da prova foi feita por script; correr com a chave só no backend e o Vite na porta 5173; ter o exemplo como plano B se a rede falhar (a chamada à Meta demora ~30 s). **NO-GO** para qualquer afirmação de fidelidade fotográfica, de desempenho em GPU ou de segurança mecânica.

---

# Unificação visual: um só workspace

`experience/` e `workspace-design/` já não são dois sistemas visuais no `/living`.

- **Um workspace permanente.** `mountLivingShell` cria um único `SpatialWorkspace`, vazio ao início. O palco 3D, a barra lateral, o compositor e a marca nunca são substituídos; mudar de estado nunca troca de canvas (provado no E2E: o mesmo elemento `canvas` do estado vazio ao laboratório e de volta).
- **Painéis contextuais.** A importação e a revisão são painéis hospedados no workspace (`panelHost`), ao lado da mesma barra e acima do mesmo compositor. O compositor é a entrada: o texto descreve a máquina e o clipe anexa a fotografia. Na revisão fica desativado com a razão; no laboratório volta a ser o assistente.
- **A máquina troca no mesmo palco.** Adotar uma montagem, voltar à revisão, «Nova máquina», «Abrir exemplo» e «Novo projecto» chamam `replaceAssembly`/`clearMachine`: o motor, o registo, a cena, a Digital Hand, a seleção e a conversa são reconstruídos, o renderer e o canvas ficam. O exemplo abre na mesma página, sem navegação.
- **Modo embebido** (`experience.ts`, opção `embedded`): sem palco, marca nem laboratório próprios. Sem a opção, o protótipo do Design comporta-se como antes (E2E do Design 39/39).
- **Design system:** Void, Fold e os tokens existentes; botões repostos (o CSS do workspace sobrepunha-se às variantes do design system); os painéis chegam com os tokens de movimento.
- **Domínios:** os textos do shell e do compositor vivem num único mapa (`COMPOSER_COPY`) e as ações extra da barra são dados. O vocabulário de entidades e a estrutura obrigatória da revisão continuam presos à escavadora até ao trabalho de anatomia do Codex; não se implementou anatomia.

## A captura `excavator-fixture-1 · fixture`

Não corresponde ao PR #20. O cabeçalho `· fixture` foi removido do `workspace.ts` no commit `43cfb7f` (PR #15). No código final o exemplo mostra `exemplo · montagem sintética`, com o aviso de que não foi reconstruído de nenhuma fotografia, e o perfil premium (a captura mostra o aspeto antigo, sem premium). Captura atual: `captures/unified-03-example.png`.

## Resultados (SwiftShader, sem GPU real)

106 ficheiros / 1885 testes, `tsc`, build. E2E novo 24 verificações (1440/768/390). Design 39/39; motor 16, histórico 4, Digital Hand 7, revisão 8, regressões 3 e 4; Foundry 25/25 e 52/52; Cinema 203/203 e histórico.

Limitações novas: o texto da marca durante a revisão continua «laboratório vazio» (não acompanha a fase); a transição é a subida da máquina no palco, sem a dobra da folha do protótipo.


---

# Correcções da revisão independente (SHA `0f1d558`)

Três P2 confirmados, corrigidos sem novas funcionalidades.

1. **Sessão expirada.** A revisão mostra agora um aviso com duas ações explícitas, «Importar outra fonte» e «Novo projecto», que recomeçam sem recarregar a página (a sessão do servidor é esquecida e o palco fica vazio). Vale para a sessão perdida no servidor (404) e para a expiração local aos 30 minutos: o `ReviewGateway` expõe `expired()` e `expiresAt()`, e a interface agenda a reação para o momento da expiração, sem esperar por um clique. Testes: `review-fixes.test.ts` (relógio injetado) e, no browser, `unified-living.pw.ts` (404 com as duas ações; expiração local com o relógio do browser avançado 30 min, sem pedido ao servidor).
2. **Webcam e Digital Hand.** `stopHandTracking()` é chamado por todas as saídas de uma máquina (`teardownMachine`: trocar, esvaziar, voltar à revisão, novo projecto) e pelo `dispose`: o tracker é esquecido antes de parar (os *callbacks* tardios deixam de ser o tracker corrente), as *tracks* de vídeo terminam, o `srcObject` é libertado, o modelo de interação é reposto e o cursor da mão é escondido e limpo. A corrida em que a permissão chega depois de sair já era segura no `WebcamHandTracker` (a *stream* é parada ao chegar) e fica agora coberta. Teste: `unified-lifecycle.pw.ts` com webcam simulada do Chrome; falha sem a correção (confirmado) e passa com ela, para `clearMachine`, `replaceAssembly` para vazio, `replaceAssembly` para outra máquina e a permissão concedida depois de sair.
3. **Aviso da largura.** Já não diz que a malha 3D não mostra a largura (a Foundry #19 desenha-a). Diz que a malha segue a largura indicada (1,40 m, antes 1,10 m), que esse valor é do utilizador e não foi medido nem verificado pela Meta nem por outra fonte, e que o resto da geometria é sintético. Teste: `review-fixes.test.ts` e o E2E do laboratório.
