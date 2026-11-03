# Estados e transições da experiência unificada

Fonte executável: `flow.ts` (fluxo), `review.ts` (revisão, prontidão, portões), `intake.ts` (entrada e porta de reconstrução).
Protótipo: `/src/living/experience/harness/index.html`. Atalhos de demonstração: `?scenario=…`, `?start=review|lab`, `?rm=1`, `?zones=1`.

## 1. Fluxo

```
empty ──select──▶ selected ──submit──▶ waiting ──outcome──▶ review ──open_lab──▶ transition ──▶ lab
  ▲  ◀──clear──────┘   ▲                 │cancel                │                               │
  │                    └─────────────────┘                      │◀──────── back_to_review ──────┘
  │                                       ├──▶ not_identified ──retry──▶ waiting
  │                                       ├──▶ failed ─────────retry (se recuperável)──▶ waiting
  │                                       └──▶ unavailable
  └──────────────────────── restart (de qualquer estado) ─────────────────────────────────────────
```

| Estado | O que a pessoa vê | Acções | Leitura obrigatória |
|---|---|---|---|
| `empty` | Palco vazio (luz e chão, sem máquina) e um cartão central: «Comece por uma máquina.» | Fotografia / Desenho técnico / Texto; arrastar ou escolher ficheiro; escrever texto | Formatos aceites e o limite de 10 MB, à vista antes de errar |
| `empty` + problema | O mesmo cartão com o motivo (`role="alert"`) | Escolher outro ficheiro | O motivo diz o que fazer: «Exporte… em PNG, JPEG ou WebP» |
| `selected` | Pré-visualização (imagem, ou citação do texto) com nome, tipo e tamanho | **Reconstruir** (primária), Remover | — |
| `waiting` | Pré-visualização e «a aguardar o modelo · N s» (contador por segundo, sem animação em loop) | Cancelar | «nada fica guardado até rever» |
| `not_identified` | «Não foi possível identificar a máquina.» + motivo do modelo + três dicas | Tentar de novo, Escolher outra fonte | Não é um erro técnico: é a fonte |
| `failed` | «A reconstrução falhou.» + mensagem simples + código mono | Tentar de novo (só se recuperável), Escolher outra fonte | O código fica visível para suporte |
| `unavailable` | «A reconstrução não está disponível aqui.» | Escolher outra fonte | Não culpa a pessoa nem o ficheiro |
| `review` | Fonte (desenho com regiões, ou a imagem/texto da pessoa) + cartão de uma entidade + portões + contagens | Confirmar / Corrigir / Rejeitar; ←/→, C, X | Ver §2 |
| `transition` | A folha dobra para o chão; a máquina cresce; câmara até ao herói (3,5 s; instantâneo com movimento reduzido) | — (a interface volta no fim) | — |
| `lab` | Máquina, portões, «o que pode fazer», miniatura do desenho, marcas só no que é incerto | Inspeccionar (clique), Plano herói, Nova máquina, miniatura → revisão | Ver §3 |

Uma resposta que chega depois de *cancelar* ou de *recomeçar* é ignorada: o redutor só aceita `outcome` em `waiting`.

## 2. Revisão: as categorias que nunca se misturam

| O que a reconstrução devolveu | Acção da pessoa | Como aparece | Entra no laboratório? |
|---|---|---|---|
| observado | — | «observado · por confirmar» (linha contínua cinzenta) | sim, como observado |
| observado | Confirmar | «confirmado por si» (contínua `ink`) | sim |
| hipótese | — | «hipótese · por rever» (tracejado laranja) | **bloqueia** o laboratório |
| hipótese | Confirmar / Corrigir / Rejeitar | confirmado / corrigido por si / rejeitado | sim / sim / em fantasma |
| desconhecido | — | «desconhecido» (pontilhado) | sim, marcado na peça |
| desconhecido | Confirmar | **não existe**: não há nada para confirmar | — |
| desconhecido | Corrigir | «corrigido por si» (a pessoa diz o que é) | sim |
| propriedade desconhecida (ex.: massa) | Introduzir valor | «introduzido por si · não verificado»; o original fica `unknown` | não muda a geometria |
| valor observado (ex.: cota 5 400 mm) | — | não editável aqui; corrigir é uma proposta de modificação (PR de integração) | — |

Na correcção, a interpretação da IA fica visível («a IA interpretou como …»). O estado devolvido nunca é reescrito.

### Prontidão (portão 1) e validação (portão 2)

- **Portão 1, revisão humana:** `insufficient` (falta estrutura: material circulante, corpo superior, lança, braço ou caçamba
  utilizáveis) → `review_pending` (hipóteses por decidir) → `ready_for_engine`. A pessoa vê a lista do que falta e pode
  «Importar outra fonte». Mesmo com dados insuficientes, continua a poder ler e rever o que foi observado.
- **Portão 2, validação de engenharia:** `not_run` → `running` → `valid` | `blocked(reasons)`. **Só o motor** o altera. A revisão humana
  nunca o muda, e a interface diz-o: «confirmar não é validar».
- O protótipo mostra o portão 2 sempre em `not_run`, porque o motor não está ligado a esta página.

## 3. Laboratório unificado: onde cada peça existente encaixa (`?zones=1`)

| Funcionalidade (já existe) | Zona | Quando aparece | Notas |
|---|---|---|---|
| Ferramentas do workspace (rail) | margem esquerda | sempre, fora do modo foco | Simular desactivado até ao portão 2 = `valid` |
| Digital Hand | sobre a máquina | quando a IA aponta | só ids canónicos; marcas de incerteza não competem com a mão (a mão tem prioridade, as marcas descem a 40 %) |
| Inspector | canto superior direito, por baixo dos portões | ao seleccionar uma peça | mostra a categoria da revisão e a evidência da reconstrução, além do registo canónico |
| Experiências do motor (barra temporal) | por cima do compositor | só com portão 2 = `valid` | antes disso, a acção explica porquê |
| Conversa | painel à direita / folha no telemóvel | a pedido | a mesma do workspace (`/api/spatial-agent`) |
| Compositor | centro, em baixo | sempre | — |
| Perfil premium (Claude Cloud) | palco | sempre | `applyDirection(runtime, 'graphite')` sobre o `CinemaRuntime` |
| Revisão e desenho original | miniatura no canto inferior direito | sempre no laboratório | volta à revisão com as decisões intactas |

Hierarquia: máquina → marcas de incerteza → Digital Hand → portões → operações → resto. Só há uma acção primária visível de cada vez.

## 4. Responsivo e acessibilidade

- **1440 px:** revisão em três colunas (estado · cartão · primária); laboratório com coluna à direita (portões e operações).
- **768 px:** revisão numa coluna com scroll (fonte → cartão + estado → primária); banner de demonstração por baixo do logótipo.
- **390 px:** cartão de entrada ancorado em baixo; revisão numa coluna; no laboratório, portões em cima, as operações escondem-se
  (continuam no inspector) e as marcas alinham à margem e quebram linha. Câmara em retrato ajustada à largura da máquina.
- **Acessibilidade:** alvos de 44 px nas acções primárias, foco visível de 2 px `focus-ring`, `role="alert"` nos problemas,
  `aria-live` no estado de espera e na nota da primária, rádio para o tipo de fonte, teclado na revisão (←/→, C, X), `prefers-reduced-motion`
  (e `?rm=1`) sem transição.
- **Etiquetas sobre a máquina:** superfície opaca `surface-raised`, borda de 1 px, mono 12/16, empilhadas sem sobreposição e fora da coluna lateral.
