# D0 — Auditoria do design system (antes de qualquer UI)

Lido, por esta ordem: `design-system/README.md`, `AGENTS.md`, `CLAUDE.md`, `COMPONENTS.md`, `tokens.json`, `tokens.css`,
`fonts.css`, `components.css`, `src/brand.css`, `src/spatial-editor.css`, `src/style.css`, `src/motion/tokens.ts`.
Também: `src/spatial-agent.ts`, `src/spatial-command*.ts`, `src/hand-tracking.ts`, `src/voice-input.ts`, o compositor em
`src/workspace.ts`/`src/style.css` e os contratos `src/living/contracts/*`.

## O que fica igual (e como é consumido)

| Área | Regra existente | Como o protótipo a usa |
|---|---|---|
| Tokens | `tokens.css` é a única fonte; `brand.css` é o único sítio que o importa | O harness importa `src/brand.css`. `workspace.css` só lê `var(--…)`; não redefine nenhuma variável |
| Temas | Paper por omissão, Void com `data-theme="dark"` para viewports 3D | A raiz do workspace é `data-theme="dark"` (é um viewport). Nenhum terceiro tema. O fundo WebGL é o `--surface` do Void (#0B0D10) depois de inverter o tone mapping, para o canvas e o CSS coincidirem |
| Tipografia | Geist para ler, Geist Mono para medir | Texto e respostas em Geist (`--type-small`/`--type-body`); ids, unidades, estados do cursor, medidas e chips em Geist Mono (`--type-label`, `--type-data`, `tabular-nums`) |
| Pesos e escala | `title` 22/28 600, `small` 14/20, `label` 12/16, `data` 13/20 | Só estes tamanhos. Sem títulos display no workspace |
| Cor | `fold` é marca (1 ênfase por ecrã), `fold-ink` para texto/ícone laranja, `laser`/`depth` são cores de dados | `fold` só marca atenção da IA e a selecção na cena; nada decorativo. `laser`/`depth` não são usados (não há dados de eixo no ecrã). Sem gradientes, glows ou sombras |
| Superfícies | `surface-raised` para tiles/painéis, `line` só para hairlines, bordas de controlo em `ink-muted` | Compositor, rail e conversa em `--surface-raised` do Void, hairline `--line`, foco `--focus-ring` |
| Raio e espaço | `radius-sm/md/lg`, `space-1…32` | Botões `radius-sm`, superfícies `radius-lg`, juntas de 8 px (`space-2`) |
| Componentes | `u-btn`, `u-chip`, `u-chip--uncertain`, `u-readout`, `u-label`, `u-data` | Aprovar = `u-btn--primary` (a única acção primária visível), rejeitar = `u-btn--outline`; evidência e estado em `u-chip`; fixture/não verificado em `u-chip--uncertain`; medidas em `u-readout` |
| Ícones | `lucide-static` (`?raw`), já usado em `demo.ts` | Rail e compositor usam os mesmos SVG `lucide-static` |
| Movimento | `DURATION.fast/base/slow`, `EASE.out/inOut`, CSS via `applyMotionTokens()` | Transições de câmara (GSAP) e de modo (CSS `--dur-*`, `--ease-*`) só com estes tokens. Nada em loop. `prefers-reduced-motion` salta para o estado final |
| Logo | Copiar de `design-system/logos/`, nunca redesenhar | O harness usa `unfold-mark-on-dark.svg` (16 px+ de altura, sem efeitos) |
| Alvos e foco | 44 px mínimos, foco 2 px `focus-ring` | Todos os botões do rail e do compositor têm 44 px e `:focus-visible` |
| Voz | Precisa, mostra o trabalho, admite incerteza | Respostas curtas; "desconhecido" em vez de inventar; fixture rotulado sempre |

## O que se reutiliza do produto (e não se duplica)

- `src/spatial-agent.ts`: o pedido `spatial_agent_request.v1` (modo `mechanical`, capacidades `Select`/`Inspect`/`Focus`) e o
  parser `parseSpatialAgentResult` (incl. `authorizeSpatialAgentProposal`). O cliente chama a rota existente `/api/spatial-agent`.
  Não há um segundo serviço de IA; o modo fixture devolve resultados no mesmo schema e passa pelo mesmo parser.
- `src/hand-tracking.ts`: `HandInteractionModel` e `WebcamHandTracker`, sem alterações. A câmara do utilizador só liga com um clique explícito.
- `src/voice-input.ts`: `BrowserVoiceInput` para a entrada de voz (microfone só depois de clique).
- `src/motion/tokens.ts`: `DURATION`, `EASE`, `applyMotionTokens`.
- `src/living/contracts`: `EXCAVATOR_ASSEMBLY_V1`, `validateMotionFrame`; ids canónicos das partes e actuadores.

## O que não se reutiliza directamente, e porquê

- **O compositor de `src/style.css`** (`.spatial-composer`) está escrito como HTML dentro de `workspace.ts` e partilha
  `style.css` com regras globais (`body { overflow: hidden }`, `.stage-shell`, `.scene::after`). Importá-lo num protótipo
  isolado arrastava essas regras. O protótipo replica a **estrutura e o vocabulário** dele (prefixo `/`, ferramentas à direita,
  `data-command-state` IDLE/TYPING/PROCESSING/COMPLETE/ERROR, 64 px de altura, `radius-lg`, `surface-raised`) em classes `uw-`
  próprias em `src/living/workspace-design/workspace.css`. Proposta de integração: extrair o compositor para um módulo partilhado
  no ramo do Claude Cloud, e o protótipo passa a usá-lo; não foi feito aqui porque toca UI partilhada.
- **Painéis Paper sobre Void**: o editor espacial põe painéis Paper sobre o viewport Void. Aqui o objecto é o protagonista e os
  painéis são sobreposições curtas; usar Paper criaria blocos claros a competir com a máquina. Fica o Void `surface-raised`, que
  é o mesmo token e o mesmo tema (não é uma terceira linguagem). Se o produto preferir Paper, basta `data-theme="light"` no
  compositor e na conversa: o CSS só usa tokens, por isso muda sem mais alterações.

## O que fica de fora de propósito

Instrument Serif, Inter, a UI do Airsup, gradientes azul/roxo, hologramas, avatares, bloom decorativo, grão e vinheta fortes,
qualquer cor nova. A página de entrada e o editor arquitectónico não são tocados.
