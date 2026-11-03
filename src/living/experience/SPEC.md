# UNFOLD — direcção visual da experiência espacial premium

Protótipo executável: `/src/living/experience/harness/index.html` (Vite dev). Parâmetros: `?phase=lab` (directo ao laboratório com a
revisão de demonstração), `?demo=reviewed`, `?tier=studio|balanced|light`, `?rm=1`, `?livery=paper`.
Capturas reais: `reports/living/experience/captures/`. Verificação: `node tests/e2e/living-experience.pw.mjs` e `tests/living/experience.test.ts`.

A referência (uma escavadora grafite fotografada em estúdio) serve de **barra de qualidade**, não de modelo: não se reproduz marca, modelo nem pintura.

## 1. Princípio

**Primeiro o objecto, depois a dúvida, por fim a interface.**

1. A máquina ocupa o ecrã. A interface encosta-se às margens e só fala quando tem algo a dizer.
2. A incerteza vê-se **em cima da peça** e não num painel. O que está confirmado fica em silêncio; o que é desconhecido ou foi rejeitado tem marca.
3. Há uma só cor de atenção: `fold`. Nunca se usa na pintura da máquina, só para atenção, para a acção primária e para hipóteses.

## 2. As três experiências

### 2.1 Reconstrução: um desenho em papel sobre uma mesa escura

| Elemento | Especificação |
|---|---|
| Folha | A única superfície Paper do ecrã (`data-theme="light"` no `<figure>`), `radius-md`, proporção 2:1, centrada e sem moldura nem sombra |
| Desenho | Traço a tinta (`ink`), linhas ocultas removidas. No protótipo é gerado a partir do modelo canónico e **di-lo** por baixo da folha |
| Regiões | Envolvente convexa de cada entidade, alargada 14 px. O **estado lê-se pela forma**: contínuo = observado, tracejado 14/9 em `fold-ink` = hipótese, pontilhado = desconhecido. Confirmado passa a contínuo `ink`; rejeitado passa a pontilhado esbatido. Uma etiqueta mono só aparece na região em foco e ao passar o rato |
| Revisão | Uma entidade de cada vez, num cartão por baixo da folha (`surface-raised`, `radius-lg`): posição `7 / 10`, estado, confiança, título 22/28, uma linha de evidência. Acções: **Confirmar** (`u-btn--ink`), **Rejeitar** (`u-btn--outline`), «próxima hipótese →». Um desconhecido **não tem Confirmar**: só Rejeitar, ou fica desconhecido |
| Contagens | Coluna mono à esquerda: confirmados · observados · hipóteses por rever · desconhecidos · rejeitados |
| Acção primária | «Abrir no laboratório» (`u-btn--primary`, a única primária do ecrã), desactivada com motivo («Decida 3 hipóteses antes de continuar») enquanto houver hipóteses por decidir |
| Teclado | ←/→ muda de entidade, C confirma, X rejeita; clicar numa região dá-lhe foco |

Regras de dados (`review.ts`): o estado devolvido pela reconstrução nunca muda. A decisão humana fica ao lado, nunca no lugar dele.
Nada é promovido por confiança, por omissão ou por se entrar no laboratório. O laboratório só abre sem hipóteses pendentes; os
desconhecidos entram como desconhecidos.

### 2.2 Transição: o desenho desdobra-se em espaço

A metáfora da marca, literal: a folha **dobra 0 → 90°** sobre a aresta de baixo (a linha do chão), deita-se no chão, e a máquina
cresce a partir dela enquanto a câmara viaja do alçado para o plano herói.

| t (s) | O que acontece | Token |
|---|---|---|
| 0 → 0,42 | A folha revista aparece no palco **registada** com a câmara de alçado, por isso o ecrã 2D passa ao 3D sem salto | `base` |
| 0,42 → 2,22 | A folha roda sobre a aresta do chão (`power2.inOut`) | `slow × 2` |
| 1,32 → 3,12 | A máquina sobe do chão (plano de corte a subir, `power3.out`) | `slow × 2` |
| 0,42 → 3,12 | A câmara vai do alçado (fov estreito, 60 m) ao herói, num arco largo que nunca atravessa a máquina | `slow × 3` |
| 3,12 → 3,54 | As marcas de incerteza aparecem; a folha fica como traço no chão (opacidade 3,5 %) | `base` |

Com `prefers-reduced-motion`, a transição salta para o estado final. É só apresentação: plano de corte e materiais fantasma. As poses
das partes não mudam, e o renderer não resolve nada.

### 2.3 Living Workspace: a máquina no palco

| Camada | Especificação |
|---|---|
| Composição | Herói a três quartos, frente-esquerda, câmara baixa (elevação ≈ 7°), fov 30°, braço à esquerda do quadro. Em retrato, a distância cresce até caber a largura da máquina |
| Livery «graphite» | Corpo `#3A3B3E` com clear coat 1.0 / 0.08; estrutura escura `#17191C`; fundidos `#3E4045`; hastes cromadas e vidro com reflexos ×1,6. Nenhuma cor de marca na pintura |
| Luz | Uma piscina de luz dura por cima (spot 0,3 rad, ≈ 4 m no chão, com sombra); o key do palco a 35 %, o fill a 40 %, o rim a 110 % para recortar a silhueta |
| Chão | Betão mate opaco `#121315`, rugosidade 0,88, sem espelho. A folha fica como traço |
| Fundo | Colunas escuras ao longe, no eixo da câmara, para dar escala sem distrair |
| Interface | Logótipo e contexto em cima à esquerda. Resumo da revisão em mono em cima à direita. Duas acções secundárias em baixo à esquerda. Legenda contextual em baixo ao centro (clique numa peça). Marcas só nas peças desconhecidas ou rejeitadas, com borda pontilhada ou tracejada; o rejeitado aparece em fantasma (opacidade 10 %) |

## 3. Componentes para o Claude Cloud

| Componente | Onde está | Contrato |
|---|---|---|
| `applyDirection(runtime, livery)` | `stage-direction.ts` | Aplica livery, luz, chão e colunas a um `CinemaRuntime` existente; `dispose()` repõe tudo. `setMachineGhost(partIds)`, `setReveal(f \| null)` |
| `renderDrawing(assembly)` / `toSheet()` | `drawing.ts` | Folha de traço e regiões por id canónico na mesma projecção que a câmara de alçado usa |
| `reconstructionFixture()` + `ENTITY_PARTS` | `reconstruction-fixture.ts` | `unfold.excavator_observation.v1` válido (passa `validateExcavatorObservation`); mapeia entidades para ids canónicos |
| `initialReview` / `reduceReview` / `summarize` / `partCategories` | `review.ts` | Revisão pura; cinco categorias (`confirmed`, `observed`, `hypothesis`, `rejected`, `unknown`) |
| `transitionAt(t, reducedMotion)` | `transition.ts` | Linha temporal pura, só com tokens de movimento, monotónica |
| `mountExperience(app)` | `experience.ts` | Página completa (referência de integração) |

Integração sugerida: a rota `/experience` em `src/main.ts` (não tocado aqui, porque o PR #15 mexe nesse ficheiro). O palco é o
`CinemaRuntime` do cinema, sem alterações. A Visual Foundry é usada tal como está.

## 4. Responsivo

- ≥ 760 px: a folha ocupa até `(100dvh − 300px) × 2` de largura; o dock tem três colunas (contagens · cartão · acção primária).
- < 760 px: folha a toda a largura no topo; contagens numa linha com scroll horizontal; cartão; primária a toda a largura em baixo.
  No laboratório, as marcas encostam à margem esquerda e quebram linha, e as acções ficam em duas colunas iguais no fundo.
- Todos os alvos têm 44 px e foco visível de 2 px.

## 5. Notas para o dono do palco (não alteradas aqui)

1. O grade do pós-processamento levanta o preto puro para cerca de 31–41/255 (medido). Na direcção «graphite» isto esbate a queda da
   piscina de luz. Recomendo um *lift* ≤ 8/255 nesta direcção.
2. O chão do palco é semi-transparente e brilhante, pensado para o espelho. A direcção esconde-o e põe um betão opaco por cima;
   ficaria melhor como variante oficial do palco.
3. Para acabamentos em Paper sobre o grafite (corrimãos, pilares da cabina), a Foundry precisaria de uma chave de material `accent`.
   Não foi criada: muda a atribuição de materiais da geometria.

## 6. Limites honestos

- O desenho e a reconstrução são **fixtures**: o desenho é gerado a partir do modelo canónico, por isso as regiões coincidem por construção.
  Não houve leitura de um desenho real nem chamada ao modelo, e a interface diz isto.
- A revisão é local e não é gravada.
- A geometria 3D vem sempre do fixture canónico: a revisão decide o estatuto do que se mostra, não a forma.
- Capturas com SwiftShader (WebGL por software), tier `balanced`, sem AO. Numa GPU real o tier `studio` acrescenta GTAO e sombras maiores.
