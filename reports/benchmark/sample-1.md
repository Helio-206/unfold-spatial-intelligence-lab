# Benchmark sample-1: pipeline actual numa planta sem cotas

Planta: apartamento de 3 quartos, 983 x 634 px, estilo ConceptDraw, sem nenhuma medida impressa. A imagem fica em
`.local-fixtures/` (fora do git) até se confirmar a origem e a licença; aqui só vão desenhos de contornos e três recortes pequenos.

A contagem manual está em [`sample-1-manual-count.md`](sample-1-manual-count.md) e foi commitada antes de correr o pipeline
(posições das aberturas incluídas, também antes de ver as aberturas detectadas).

## Como foi medido

- Chrome real (Playwright, headless) a correr o código de `src/` sem alterações: `decodePlanImage`, `detectWallCandidates`
  (mesmos parâmetros do botão "Detectar linhas": limiar 150, comprimento mínimo 28 px, tolerância de falha 3 px),
  `detectCandidateIntersections`, `buildPlanVectorModel`, `countClosedCandidateContours`. Depois o editor real (`/spatial-editor`)
  para a calibração e a construção. Tempos: mediana de 5 execuções.
- Nenhuma chamada ao Meta. Nenhum pedido de rede saiu do browser (o único pedido não local foi o `blob:` da própria imagem).
  Os passos que dependem do modelo (nomear divisões, interpretar o documento, agente espacial) **não foram medidos**.
- "Parede real" não tem verdade de terreno oficial. Usei como proxy uma máscara de cor (pixels cinzento-escuro neutros e grossos;
  nesta planta as paredes são carvão, o piso é bege e o mobiliário é castanho ou cinzento claro). É independente do limiar do detector
  mas é uma aproximação: pode falhar paredes desenhadas mais claras e agrupa troços colineares. A moldura cinzenta do balcão foi
  marcada à mão como parede. Os veredictos sobre as divisões foram dados à vista, sobre `overlays/sample-1-regions.png`.
- Scripts: `scripts/benchmark/` (`run-detect.mjs`, `analyze.py`, `regions.py`, `openings.py`, `crops.py`, `run-ui-scale.mjs`).
  Dados em `reports/benchmark/data/`.

## Números

| | contagem manual | pipeline | |
|---|---|---|---|
| troços de parede | 50 (44 a 56) | 151 candidatos: 49 reais, 102 falsos | a unidade não é a mesma: o pipeline parte as paredes em fragmentos |
| troços de parede segundo o proxy de cor | n/a | 29 troços, 25 apanhados, 4 não | cobertura da máscara de parede: 62% |
| falsos (102) | n/a | 65 em mobiliário colorido, 33 cinzento médio (molduras, arcos de porta, equipamento), 4 em linhas claras (piso/azulejo) | |
| espaços fechados | 12 (11 a 13) | 10 regiões, 4 elegíveis, 6 de baixa qualidade excluídas pelo produto | ver abaixo |
| portas | 10 (9 a 11) | 0 | |
| janelas / portas de correr | 7 (6 a 8) | 0 | |
| escala | desconhecida | `null` até alguém a introduzir | ver abaixo |

**Paredes.** As 4 que faltam: a parede direita do quarto master quase inteira (os candidatos caíram na cabeceira da cama, a uns 8 px da
parede), a parede fina à esquerda do master, a parede esquerda do quarto 3 (meio) e o troço inferior do quarto 3 (apanhado em 57%).
As ripas do piso, que eu esperava como risco principal, quase não geraram candidatos (4, todos em linhas claras): o limiar de
cinzento do detector deixa-as de fora. O risco real foi o mobiliário e os símbolos (65 + 33 falsos).

**Divisões** (14 espaços olhados, contando sala e jantar como um só aberto e foyer à parte; ver `overlays/sample-1-regions.png`):

| espaço | resultado |
|---|---|
| Balcony | bem delimitado |
| Bedroom 2 | bem delimitado (inclui o nicho do armário) |
| Bedroom 3 | cortado: a região acaba em y=560, o quarto vai até à parede de baixo (y~630), que o pipeline só apanhou em parte |
| Kitchen | não encontrada; a única região elegível ali perto é a bancada da direita (ver falhanço 2) |
| Master, Dining+Living, Foyer, Maid's Qtr, Walk-in Closet, 2 T&B com texto, 2 wc sem texto | não encontrados |

Nenhuma junta mal (duas divisões fundidas numa) e nenhuma partida mal em duas; os erros são divisões em falta, uma cortada e uma errada.

**Aberturas.** 17 "descontinuidades colineares" de 11 a 23 px, nenhuma a menos de 30 px de uma porta ou janela que contei (os vãos
reais têm uns 40 a 60 px). Quase todas estão entre as cadeiras da mesa de jantar; as duas restantes ficam junto ao quarto master (x 926 e 955). O pipeline não vê arcos de porta
nem janelas.

**Escala.** Ver a secção seguinte.

**Tempos** (mediana de 5 execuções, Chrome headless, CPU): descodificar 51 ms · detectar paredes 11 ms · intersecções 1 ms ·
modelo vectorial e regiões 67 ms · contornos fechados 6 ms. Total local: ~136 ms. Construir a cena no editor: 863 ms (inclui render por software).

## Os três piores falhanços

1. **A parede exterior direita do master não existe para o pipeline.** Os candidatos ficaram na cabeceira da cama e na mesa de
   cabeceira, a poucos pixels da parede. `crops/fail-1-master-right-wall.png` (verde: aceite como parede; laranja: falso).
2. **A "cozinha" é a bancada.** A única região elegível junto à cozinha é a faixa da bancada com o fogão, não a divisão.
   `crops/fail-2-kitchen-region.png` (contorno azul).
3. **Zero aberturas reais, 17 inventadas.** As descontinuidades estão nas cadeiras. `crops/fail-3-openings-on-chairs.png` (magenta).

## O que o produto disse bem

- Sem escala: `scale: null`, "Sem escala validada, áreas apenas em px²", e as áreas nas linhas de divisão em px². Nunca apareceram metros.
- Depois de marcar a largura do Balcony como 6,0 m (470 px, calibração do passo que já existe), a escala fica guardada com
  `source: "user"`, `validation: "unreviewed"`, ator `local-user-input` e a nota que escrevi como evidência: marcada como medida
  introduzida por uma pessoa e não confirmada.
- As linhas são "candidatos geométricos, não paredes confirmadas"; as regiões "não divisões semanticamente confirmadas"; as
  descontinuidades "ambiguidades, não portas ou janelas identificadas". As 6 faces de baixa qualidade são excluídas e contadas.
- A proveniência das divisões construídas: `derived / unreviewed`.

## O que o produto disse mal, ou não disse

- **As áreas não passam a m² depois da calibração.** Com a escala introduzida, as 4 divisões continuam com `areaRasterPx2` e a nota
  "não convertida em área física", e a linha de resumo continua a dizer "Sem escala validada, áreas apenas em px²". Não há nenhum
  sítio onde a escala introduzida se traduza em m². (A geometria 3D da cena já está em metros, a partir dessa escala.)
- O cartão de remoção de parede (o meu, de #5) mostra m² calculados a partir dos polígonos da cena sem dizer que dependem da
  medida de referência introduzida por uma pessoa. Isto contradiz a regra de produto; é um defeito meu a corrigir.
- O texto das linhas de divisão vem partido: "Divisão proposta 51-5-721-956 segmentos de suporte" (o id `room-251-5-721-95` é cortado
  a meio e colado à contagem de segmentos).
- Não diz que não encontrou a maioria das divisões. Mostra "4 divisões propostas" sem dizer que o espaço aberto, a cozinha, os wc e o
  master ficaram de fora; a frase "Isto não exclui divisões abertas ou linhas não detectadas" só aparece quando não há nenhuma.
- A região da bancada aparece como "Divisão proposta" com confiança 0.49, ao lado de um balcão com 0.89, sem distinção visual.

## Medido e opinião

Medido: todos os números acima, os tempos, o que o editor escreveu, a ausência de pedidos de rede.

Opinião (sem sugerir correcções além das óbvias): o detector está calibrado para linhas escuras finas e não distingue carvão
de mobiliário castanho nem de molduras cinzentas; a elegibilidade das regiões não olha para o tamanho (a bancada tem 6 209 px²
contra 38 000 a 46 000 das divisões); e o ponto óbvio e pequeno é converter as áreas para m² quando existe escala introduzida
por uma pessoa, marcando-as como dependentes dela.

## Limites desta medição

Uma só planta. O proxy de cor não é verdade de terreno. A contagem manual é a olho. Só o limiar por defeito do editor (150).
Os passos com modelo não foram medidos.
