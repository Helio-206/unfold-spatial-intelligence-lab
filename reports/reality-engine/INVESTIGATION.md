# Reality Engine — investigação de abordagens (medida, não opinada)

Cada linha diz o que foi **medido aqui**, com que entradas, e a decisão. O que não foi medido está marcado como tal.

## 1. Structure-from-Motion (câmaras)
- **O que foi testado:** `pycolmap 4.2.1` (COLMAP, BSD-3) instalado num ambiente isolado, sobre renders texturados do `BoomBox` (volta de mesa, câmara fixa, fundo liso, elevação 20°).
- **Resultado:** 8 vistas a 45°: **nenhum modelo** em 3 objectos (BoomBox, CesiumMilkTruck, AntiqueCamera). 24 vistas a 15°, 1280×960, objecto a 80% da altura: **15 de 24 vistas registadas**, 393 pontos, erro de reprojecção 0.45 px, mas passos angulares irregulares (11°–27° em vez de 15°) e um buraco de 9 vistas (o lado sem textura). O SfM não dá poses fiáveis para um objecto único, pequeno, pouco texturado, com lados escuros.
- **Decisão:** **não integrado** como dependência do produto. Custo: binário nativo (~40 MB), Python no servidor, extracção SIFT por CPU; benefício medido: fraco neste regime. Mantém-se o caminho de poses assumidas + refinamento por consistência (erro médio 6.5° → 4.7° em 14 objectos). **Reabrir** quando houver fotografias reais com fundo estático e textura (SfM é aí o método certo) e um serviço de servidor com contrato `camera-solution`.
- **Não medido:** SfM em fotografias reais de objectos; só foi tentado em renders.

## 2. Reconstrução densa (MVS) e métodos neuronais (NeRF/Gaussian splatting)
- **Não avaliados.** Precisam de câmaras registadas (secção 1 não as dá de forma fiável aqui), de GPU (indisponível) e produzem superfícies/campos sem partes editáveis. Não há decisão baseada em evidência; ficam **em aberto**, não rejeitados.
- Licenças a vigiar: OpenMVS é AGPL (incompatível com uso como biblioteca fechada); COLMAP BSD-3; 3D Gaussian Splatting original sob licença de investigação.

## 3. Segmentação em fotografias reais com fundos complexos
- **Protocolo:** 8 fotografias reais de veículos (`tests/fixtures/photos-real`, polígonos de **um só anotador**; tecto ≈ 0.93–0.96 porque duas passagens do mesmo anotador concordam a esse nível). Parâmetros escolhidos **só nos 4 casos de desenvolvimento** (suavidade 60, 8 componentes, pincel 14 px); holdouts/aceitação lidos uma vez.
- **Resultado (`benchmark/segmentation-real-photos.json`):** classificação por cor de fundo (o que o produto fazia): IoU médio **0.298**, credível em 2/8. Segmentação interactiva (caixa solta): **0.535**. Depois de 3 rondas de correcções (12+12 marcas de pincel por ronda): **0.866** (holdouts 0.884 e 0.876; aceitação 0.826 e 0.844; desenvolvimento 0.93/0.90/0.79/0.87).
- **Limite honesto:** as "correcções" são simuladas com o polígono como oráculo (pontos escolhidos nos piores erros). É o que uma pessoa diligente consegue com ~36 marcas, não prova do esforço real.
- **Decisão:** integrado como «Ajustar contorno» no intake (caixa + pincéis objecto/fundo, calculado no Worker). O contorno confirmado é marcado como confirmado por si.

## 4. Pipeline completo com fundos reais (`benchmark/product-results-realbg/`)
Renders de 14 activos (alfa exacto) compostos sobre 6 fotografias reais como fundo; segmentação automática vs interactiva (oráculo); reconstrução do produto; Chamfer contra o 3D. **Automática credível em 13 de 112 vistas (12%)**; interactiva: IoU de contorno médio 0.86; **14/14 reconstruídos** (o caminho automático recusaria quase todos). Chamfer médio 2.63% (dev, máx. 4.03) e 2.57% (aceitação, máx. 3.12); IoU retido médio 0.78 / 0.81; 3 dos 14 ficaram "não validados" por concordância entre vistas abaixo do limiar (a classificação desce em vez de se esconder).

## 5. Componentes vs a estrutura de partes do ground truth (`benchmark/components.json`)
Referência: nós glTF do activo (estrutura do autor, não semântica perfeita). Partes do watershed por espessura: desenvolvimento 7/9 partes significativas recuperadas, aceitação 7/25. Funciona em poucas peças (Lantern ARI 1.0) e falha em montagens (cadeira 1 de 5 pernas/assento, CarConcept 0 de 11).
**Experiência: separar membros finos por abertura morfológica** (`limbs`): separa assento + 4 pernas num banco sintético e uma haste entre esferas, mas na referência real **não melhorou** (dev 7/9 → 7/9, IoU 0.884 → 0.790; aceitação 7/25 → 8/25) e fragmentou objectos de uma peça (BoomBox 1→4, Shoe 1→3). **Decisão: opção desligada por defeito**, disponível e testada. Honesto: o reconhecimento de peças continua a ser geometria, não compreensão.

## 6. Cor e aparência
- Verificação fotométrica em vistas **novas** (`photometric.ts`): erro médio absoluto de cor ≈ 14–21/255 (camião de leite 37). Mediana robusta das 3 vistas melhor orientadas **reduziu o erro em todos os 5 activos de desenvolvimento** (−0.4 a −1.6) e foi neutra no de aceitação: adoptada por defeito.
- **Não observável e por isso não inventado:** rugosidade, metal, normais finas, relevo. O material PBR usa valores constantes **marcados como assumidos**; só a cor vem das vistas, a azul-acinzentado onde nenhuma vista viu.

## 7. Dependências
`jpeg-js` (BSD-3, **devDependency**, só benchmarks/testes). Nenhuma dependência nova no bundle do produto.
