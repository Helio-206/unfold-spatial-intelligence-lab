# Novo espaço no workspace `/living` (integração dos PRs #22, #23 e #24)

Branch `feat/spatial-v2-workspace-integration`, empilhada sobre o #24 (`3ac2abf5`) com `main` (#20, `e197d07`) fundido por cima, sem conflitos. Nada foi fundido em `main`.

## O que foi ligado

Um só workspace. `SpatialWorkspace` continua a ser dono do renderer Foundry, da câmara, do rail, do compositor, do inspector, dos avisos e da selecção. Não há segunda aplicação, nem segundo renderer, nem o harness `/universal-spatial-v2` montado.

| Peça | Onde | O que faz |
|---|---|---|
| Porta | `src/living/workspace-design/space-port.ts` | O que o workspace precisa de uma cena que não é a escavadora: objectos, picking, caixas, isolar, realçar, conteúdo do inspector. |
| Ganchos | `workspace.ts` (`showSpace`, `spaceChanged`, `redraw`) | Selecção, enquadramento, isolar, evidência, inspector e rail passam a servir a cena. Com a escavadora o caminho é o mesmo de antes. |
| Camada | `src/living/spatial-space/layer.ts` | Compila o plano V2 (#23), normaliza só a apresentação, escolhe por `spatialEntityId`, inspector com proveniência por propriedade, edição em pré-visualização → aplicar (autorização quando toca valor observado ou confirmado), desfazer, solver de folgas (#24), vista inicial pelo `heroAzimuth` do #24. |
| Revisão | `src/living/spatial-space/review.ts` | Manter/rejeitar por componente, o que depende de um rejeitado sai com ele, relações e restrições que o nomeiam saem, plano revalidado. Manter não promove proveniência. |
| Fluxo | `src/living/spatial-space/flow.ts` | Novo espaço → texto ou imagem → Meta → revisão → construção → exploração e edição, nos painéis do próprio workspace. |
| Entrada | `experience.ts` + `shell.ts` | Botão «Novo espaço» no intake do `/living`, ao lado de «Abrir exemplo». Sair devolve ao laboratório. |
| Evidência | `server/meta-server.ts` | Resposta bruta da Meta, plano normalizado e id do pedido guardados no servidor (ver abaixo). |

A cena fica `unitless` quando não há unidades; a escala física é dita desconhecida no aviso e no inspector. O aviso do espaço diz «concepção da IA · não é uma medição · revisão humana não verificada».

## Teste real com a Meta (muse-spark-1.3)

Pedido de texto para um objecto sem geometria preparada, «A grandfather pendulum clock: tall wooden case, round dial with hands, brass pendulum disc, and feet.» Credenciais existiam no `.env` de outro worktree; foram carregadas só no processo do backend (nunca impressas, nunca no frontend, nunca em ficheiros commitados). Orçamento do backend limitado a 8 chamadas; foram feitas 7 (≈ US$ 0,18).

| # | Resultado | Causa e o que mudou |
|---|---|---|
| 1, 2 | `SPATIAL_V2_META_INCOMPLETE` | 3 652 dos 6 000 tokens de saída foram gastos em raciocínio e o plano ficou cortado a meio. Tecto passou a 12 000. Teste novo. |
| 3 | 8 componentes; relógio só reconhecível de lado | Mostrador e pêndulo eram discos horizontais enterrados numa caixa sólida (eixo Y por omissão, sem rotação). Guia do prompt, sem nomes de objectos: eixos de cilindros/toros e peças dentro de sólidos opacos. |
| 4 | Relógio reconhecível (mostrador, ponteiros, pêndulo, pés) | Vista inicial mostrava a traseira. |
| 5 | Um cubo castanho com manchas douradas | A Meta usou chaves abreviadas (`t/r/s`, `w/h/d/r`); o servidor ignorou-as e empilhou tudo na origem com tamanhos por omissão. Prompt passou a listar as chaves exactas por operador; o normalizador lê `t/r/s`, `translation`; o reparo lê `w/h/d/r`. Testes novos. |
| 6 | Proporções certas, mostrador de lado | Material devolvido como nome solto em vez de objecto; vista inicial escolheu o lado de trás. Prompt: material é objecto; vista inicial escolhida entre as duas diagonais do lado +Z (o prompt diz que a frente é +Z). |
| 7 | **Relógio reconhecível na vista inicial** | Corrida final, abaixo. |

Corrida final (`runs/real-meta/`): pedido `8bca424f-8f96-4e5c-b50d-1b3d48835a48`, 32 131 ms, US$ 0,0225, 8 componentes. Reconhecível: caixa, capelo, plinto, mostrador com ponteiros, haste e disco do pêndulo. Não reconhecível como correcto: os dois pés estão deslocados do plinto e flutuam; o verificador de montagem assinalou 2 avisos. É o que a Meta propôs, não foi corrigido à mão.

Variabilidade: das cinco corridas bem-sucedidas, só duas (4 e 7) foram reconhecíveis sem nada a explicar. Depois das correcções fiz uma corrida por configuração, o que não é prova estatística de fiabilidade.

### Evidência guardada, sem segredos

- No servidor, com `UNFOLD_UPSTREAM_EVIDENCE=1` e `UNFOLD_UPSTREAM_EVIDENCE_DIR`: `spatial-run-<uuid>.json`, modo 0600, limitado a 512 kB e 100 ficheiros. Contém o texto bruto da Meta, o plano normalizado, as notas de normalização, o hash da fonte, modelo, id do pedido, latência e utilização. Não contém chave, cabeçalhos, instrução nem bytes de imagem. Falhas upstream também ficam registadas (código, motivo, excerto).
- O cliente recebe `meta.rawResponseSha256` e `meta.rawResponseStored`. O E2E confirma que o hash do ficheiro guardado é o recebido pelo browser.
- Os ficheiros brutos ficam em `reports/space-integration/raw/`, no `.gitignore` do projecto (regra pré-existente: respostas vivas da Meta não se publicam). Estão só nesta máquina.
- Commitado: capturas, `e2e-result.json` (ids, hashes, métricas, tentativas) e `attempts/` com as tentativas falhadas.

## Verificação visual e de comportamento

`tests/e2e/space-workspace.pw.mjs` (Chromium + SwiftShader, 1440×900). Modo `mock` (fixture rotulada, sem Meta) e modo `live`. Passos verificados nos dois: entrada, pedido, espera, revisão bloqueada até haver decisões e confirmação, construção, objecto visível (com/sem objecto na mesma frame: 14,8 % da imagem difere, luma máx. 246), órbita com o rato, tecla R, selecção por clique em pelo menos duas peças distintas, pré-visualização, aplicar, origem passa a `user_provided`, desfazer repõe a posição, cor, isolar, enquadrar, evidência, sair liberta a cena (geometrias e texturas voltam ao valor inicial) e consola sem erros. Só o modo mock rejeita um componente antes de construir; no real foram mantidos todos.

Capturas em `runs/real-meta/` (01 a 15) e `runs/mock-fixture/`.

## Testes

- `npm test`: 120 ficheiros, 2 153 testes passam (+ testes novos: evidência, orçamento de tokens, revisão, camada, apelidos de chaves, guia, vista inicial). Dois testes antigos (`rendering-lifecycle`, `bucket-width`) excedem os 5 s por omissão quando a máquina está carregada e passam isolados; a execução completa foi feita com `--testTimeout=60000`.
- `npm run build` e `tsc --noEmit` passam.
- Regressões existentes executadas sem alterações: `unified-living.pw.ts` (25 verificações: fluxo da escavadora, exemplo, novo projecto, WebP, erros), `unified-lifecycle.pw.ts`.
- Nenhum teste automático chama a Meta; só o modo `live` do E2E, por escolha.

## Bloqueios e limites efectivos

1. Fiabilidade do modelo: a qualidade do objecto depende da resposta; houve corridas não reconhecíveis. Dois defeitos eram nossos (chaves, tokens) e foram corrigidos; a dispersão restante é da Meta.
2. Imagem: o caminho está ligado e verificado com servidor simulado (o pedido sai com `sourceKind: image`, PNG; WebP é convertido). Não fiz chamada real com imagem: as únicas fotografias na máquina são fixtures privadas do projecto e não as enviei.
3. Edições são locais. A sessão do servidor não é actualizada, por isso «Avaliar vista» e «Refinar» (#24, pagos) não estão ligados ao workspace. A edição por texto da Meta (`/v2/edit`) também não: o servidor aplica-a logo, o que contraria preview → autorização. Precisa de um modo «propor» no servidor.
4. A identidade do revisor é afirmada pelo cliente e não verificada; o aviso diz-o.
5. O Cinema (`CinemaRuntime`) não consome planos espaciais (limite já documentado no #22). A cena usa o palco do próprio workspace, o mesmo da escavadora. Explodir, Simular e gestos ficam indisponíveis no espaço.
6. A revisão não passa pelo servidor (não há operação de remover componente), por isso a sessão do servidor mantém o plano original.
7. Anatomia (#21): entra a seguir implementando `SpaceLayer` para o seu fornecedor e um botão de entrada análogo. A porta já não conhece planos.

## Como repetir

```
# backend (credenciais só no ambiente do processo) e vite
UNFOLD_LOCAL_ORIGINS=http://127.0.0.1:5191 UNFOLD_UPSTREAM_EVIDENCE=1 UNFOLD_UPSTREAM_EVIDENCE_DIR=$PWD/reports/space-integration/raw npx tsx server/index.ts
npx vite --port 5191
UNFOLD_SPACE_MODE=mock node tests/e2e/space-workspace.pw.mjs   # sem Meta
UNFOLD_SPACE_MODE=live node tests/e2e/space-workspace.pw.mjs   # uma chamada paga
```

`UNFOLD_SPACE_REPLAY=<ficheiro bruto guardado>` repete localmente o plano normalizado de uma corrida real, sem Meta, para iterar na apresentação.
