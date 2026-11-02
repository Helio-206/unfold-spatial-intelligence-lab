# Perception quality benchmark

## Veredicto

O tier estrutural melhora a precisão dos candidatos de parede no `sample-1`, mas ainda não melhora a reconstrução completa. Ele reduz os falsos positivos de 102 para 5 e sobe a precisão de 32,5% para 84,4%, ao custo de baixar o recall dos candidatos rotulados de 100% para 55,1% e o recall de pontos de divisão de 14,3% para 7,1%.

Por esse motivo, o algoritmo foi implementado como uma seleção conservadora opcional. Os candidatos rejeitados permanecem disponíveis no fallback de revisão. O editor e o Scene Graph não foram alterados e o tier não foi ativado por defeito.

Dados estruturados: [`data/perception-quality.json`](data/perception-quality.json).

## Evidência disponível

| conjunto | estado | licença | uso nesta avaliação |
|---|---|---|---|
| `sample-1` | raster original indisponível; SHA-256, saída bruta, proxy de paredes e anotações permanecem no PR #6 | origem/licença por confirmar | baseline armazenada e avaliação de seleção sobre os mesmos 151 candidatos |
| Amoureaux House | raster 3700×2996 disponível e confirmado por SHA-256 | domínio público nos EUA; fonte Library of Congress/Wikimedia | reexecução real do detector em Chrome e recall parcial contra quatro segmentos de perímetro anteriormente traçados |
| `synthetic-clean` | fixture determinística criada neste benchmark | autoria do projeto | regressão de duas divisões sem ruído |
| `synthetic-noisy` | fixture determinística criada neste benchmark | autoria do projeto | paredes grossas, mobiliário e anotações finas, com verdade de terreno completa |

As quatro linhas da Amoureaux cobrem apenas o perímetro retangular principal. As linhas interiores, porch e aberturas não estão anotados. Por isso, medir precisão nessa planta classificaria evidência desconhecida como falso positivo; essa métrica fica explicitamente `null`.

## Baseline

### sample-1

O benchmark raster original não pôde ser repetido: `.local-fixtures/sample-1.png` não existe nos worktrees, anexos ou temporários pesquisados. A saída armazenada no PR #6 está vinculada ao SHA-256 `b8876fb66b45c26f2ec72fcaf3354a6cec6e4718e1b61b0fa443045f2667f4d0` e foi usada sem alegar nova execução.

- Paredes: 151 candidatos; 49 classificados como parede pelo proxy; 102 falsos. Precisão 32,5%.
- Proxy de recall: 25 de 29 troços encontrados; 86,2%. Cobertura de pixels do proxy: 62,4%.
- Divisões: 2 de 14 pontos dentro de regiões elegíveis; recall 14,3%. Não há polígonos de verdade de terreno, logo IoU não é mensurável.
- Aberturas: 17 candidatos, nenhum a até 30 px das 10 portas e 7 janelas anotadas. Precisão e recall 0%.
- Latência armazenada: descodificação 51,3 ms; paredes 11,1 ms; interseções 1,0 ms; modelo/regiões 67,0 ms; contornos 6,1 ms.

### Amoureaux House

Com o runner corrigido, o detector foi executado cinco vezes em Chrome do sistema, no raster SHA-256 `1d78e739dad568ea49eb193416dc5f91c8b62b904a0170c63af803dd87750026`.

- 162 candidatos, 14 regiões e 6 contornos fechados.
- Latência mediana da execução registrada: descodificação 285,8 ms; paredes 99,2 ms; interseções 4,2 ms; modelo/regiões 42,9 ms; contornos 7,3 ms.
- O baseline cobre pelo menos 60% dos quatro segmentos anotados: recall parcial 4/4. Isso não mede a planta completa.
- Erros de browser: zero.

## Métodos avaliados

### Opção A — espessura fixa de 6 px

Vantagens:

- simples e rápida;
- no `sample-1`, reduz os falsos de 102 para 12 e sobe a precisão para 70%.

Desvantagens:

- depende da resolução e do estilo de desenho;
- na Amoureaux, elimina todos os quatro segmentos anotados: recall parcial 0/4.

Resultado: rejeitada.

### Opção B — tier estrutural adaptativo

Vantagens:

- deriva a banda de espessura dos quartis dos próprios candidatos;
- exige comprimento mínimo proporcional à imagem ou suporte ortogonal nos dois extremos;
- rejeita espessuras anómalas acima de três vezes o percentil 90;
- preserva todos os candidatos recusados para revisão;
- não altera coordenadas, calibração ou proveniência;
- limite explícito de 2000 candidatos evita custo quadrático sem controlo.

Desvantagens:

- continua a perder paredes finas e fragmentadas;
- não recupera portas/janelas;
- diminui o recall de regiões no `sample-1`;
- depende da distribuição de candidatos do próprio desenho.

Resultado: escolhida apenas como tier opcional de alta precisão.

### Morfologia, componentes conectados e OpenCV

Não foram promovidos a implementação. O raster do `sample-1` está indisponível, logo comparar esses métodos nesse caso produziria evidência incompleta. Adicionar OpenCV também introduziria dependência nativa sem uma melhoria multi-planta demonstrada. A Amoureaux confirma que um corte fixo de espessura não generaliza. Um ensaio morfológico futuro precisa de pelo menos dois rasters reais com anotações independentes completas.

## Antes e depois

| conjunto/método | precisão de parede | recall de parede | F1 | recall de divisões | aberturas |
|---|---:|---:|---:|---:|---:|
| sample-1 baseline | 32,5% | 100% dos candidatos rotulados | 49,0% | 2/14, 14,3% | 0/17 |
| sample-1 fixo 6 px | 70,0% | 57,1% | 62,9% | 1/14, 7,1% | 0/17 |
| sample-1 adaptativo | 84,4% | 55,1% | 66,7% | 1/14, 7,1% | 0/17 |
| Amoureaux baseline | não mensurável | 4/4 parcial | não mensurável | sem GT | sem GT |
| Amoureaux fixo 6 px | não mensurável | 0/4 parcial | não mensurável | sem GT | sem GT |
| Amoureaux adaptativo | não mensurável | 3/4 parcial | não mensurável | sem GT | sem GT |
| sintético ruidoso baseline | 38,5% | 100% | — | 2/2; IoU médio 0,987 | sem GT |
| sintético ruidoso adaptativo | 100% | 100% | — | 2/2; IoU médio 0,987 | sem GT |

No `sample-1`, os cinco falsos que permanecem no tier adaptativo são quatro segmentos de mobiliário/fixture colorido e um segmento cinzento de moldura, fixture ou arco. Os 22 falsos negativos são o custo explícito do tier. Na Amoureaux, o segmento inferior fica com cobertura 59,7%, abaixo do limiar documentado de 60%; não foi arredondado para fabricar sucesso.

## Fidelidade e resolução

`decodePlanImage` preserva a resolução original: não há downsampling no pipeline atual. O raster é descodificado integralmente para RGBA e convertido para um `Uint8Array` grayscale na mesma largura e altura.

- `sample-1`: 983×634; grayscale ~0,59 MiB; RGBA ~2,38 MiB.
- Amoureaux: 3700×2996; grayscale ~10,57 MiB; RGBA ~42,29 MiB.
- Limites existentes: dimensão máxima 10.000 px e 16 milhões de pixels.

Como não existe perda silenciosa de coordenadas, não foi introduzido processamento multirresolução. Uma versão futura deve manter transformação explícita entre pirâmides e análise localizada; isso só se justifica quando memória ou latência excederem o orçamento medido.

O seletor adaptativo levou mediana de aproximadamente 3 ms no `sample-1` e 4 ms na Amoureaux em 100 execuções. O aumento observado de heap, registrado no JSON, é uma medida do processo inteiro e não um perfil isolado de alocação.

## Alterações

- `src/plan-perception-quality.ts`: tier estrutural determinístico, evidência por candidato, fallback e limite de recursos.
- `tests/plan-perception-quality.test.ts`: comportamento, junções, fallback e validação.
- `tests/plan-perception-benchmark.test.ts`: gates determinísticos nos dados do `sample-1` e Amoureaux.
- `scripts/benchmark/perception-quality.ts`: métricas de parede, região, abertura, latência e memória.
- `scripts/benchmark/browser.mjs`: Playwright local com Chrome/Chromium do sistema.
- `reports/benchmark/annotations/`: proveniência e limites das anotações.
- `reports/benchmark/data/amoureaux.raw.json`: execução real sem o raster incorporado.

Nenhum ficheiro protegido pelo PR #7 foi alterado. O contrato requerido para integração posterior é: o workflow chama `selectStructuralWallCandidates(rawCandidates, imageSize)`, usa `structural` apenas como conjunto recomendado e mantém `review` visível. A integração no editor foi adiada porque `src/spatial-editor.ts` pertence ao PR #7.

## Limitações

- O raster e a licença do `sample-1` continuam indisponíveis; não houve nova execução nessa imagem.
- A classificação de parede do `sample-1` usa proxy de cor e uma correção manual, não verdade de terreno oficial.
- Amoureaux possui apenas quatro segmentos parciais, originalmente `unreviewed`.
- IoU de divisões só é medido nas fixtures sintéticas.
- Não há benchmark real completo de portas e janelas além do resultado negativo do `sample-1`.
- A melhoria é de triagem de candidatos, não prova de reconstrução arquitetónica superior em dados reais desconhecidos.

## Execução

```bash
npm ci
node scripts/benchmark/run-detect.mjs <amoureaux-house-plan.png> reports/benchmark/data/amoureaux.raw.json 150 5
npm run benchmark:perception
npx vitest run tests/plan-perception-quality.test.ts tests/plan-perception-benchmark.test.ts tests/plan-reconstruction.test.ts
npm test
npm run build
```

Branch: `feat/perception-quality-benchmark`. O SHA final é fornecido no handoff depois do commit; não houve merge automático.
