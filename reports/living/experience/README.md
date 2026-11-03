# Experiência unificada — conclusão de UX e prontidão para integração

Especificações: [`STATES.md`](../../../src/living/experience/STATES.md) (estados, transições, categorias, encaixe no laboratório),
[`ACCEPTANCE.md`](../../../src/living/experience/ACCEPTANCE.md) (critérios para o Claude Terminal),
[`SPEC.md`](../../../src/living/experience/SPEC.md) (direcção visual, PR #16).
Protótipo: `npm run dev` → `/src/living/experience/harness/index.html`.

## O que uma pessoa sem conhecimento técnico encontra

1. **Laboratório vazio.** «Comece por uma máquina.» Fotografia, desenho técnico ou texto, com os formatos e o limite à vista.
2. **Pré-visualização** do que escolheu, depois **Reconstruir**.
3. **Espera** com o tempo decorrido e um botão para cancelar.
4. **Resultado**, que pode ser:
   - **revisão**: o que foi observado, o que é hipótese, o que é desconhecido;
   - **máquina não identificada**: dicas para tentar outra fonte;
   - **erro**: mensagem simples e o código;
   - **serviço indisponível**.
5. **Revisão.** A pessoa confirma, corrige ou rejeita cada interpretação.
   - Um desconhecido não pode ser confirmado. Pode receber um valor da pessoa, rotulado «introduzido por si · não verificado».
   - Com dados insuficientes, aparece o que falta e o laboratório fica bloqueado.
6. **Dois portões, sempre visíveis:** a revisão humana e a validação de engenharia (só o motor). «Confirmar não é validar.»
7. **Laboratório.** «O que pode fazer», com o motivo para cada operação que ainda não está disponível. Marcas só sobre o que é incerto. A miniatura do desenho volta à revisão.

## Capturas (Chromium + SwiftShader, tier `light`)

| | 1440 | 768 | 390 |
|---|---|---|---|
| Laboratório vazio | `1440-01-empty` | `768-01-empty` | `390-01-empty` |
| Fonte escolhida / à espera | `1440-02-selected`, `1440-03-waiting` | | |
| Revisão | `1440-04-review`, `1440-05-correcting`, `1440-06-unknown-property` | `768-02-review` | `390-02-review` |
| Não identificada / erro / indisponível / insuficiente | `1440-08-not-identified`, `-failed`, `-unavailable`, `-insufficient` | | |
| Estados longos | `1440-09-long-text`, `1440-10-long-label` | | |
| Laboratório | `1440-07-lab` | `768-03-lab` | `390-03-lab` |

Mapa de zonas do laboratório unificado: `?start=lab&zones=1`.

## Testes

- `tests/living/experience.test.ts` e `tests/living/experience-flow.test.ts`. Cobrem validação de entrada, classificação
  «não identificada», códigos de erro, porta de demonstração rotulada e cancelável, todas as transições do fluxo (incluindo a
  resposta tardia ignorada), correcção que preserva a interpretação da IA, valor introduzido sem confirmação, dados insuficientes,
  e que a revisão nunca toca a validação de engenharia.
- `tests/e2e/living-experience.pw.mjs`: 39/39. Todos os estados pela interface real, mais upload real com ficheiro inválido, cancelamento,
  teclado, movimento reduzido, textos longos, 390/768/1440 sem scroll horizontal nem sobreposições, etiquetas fora da coluna
  lateral, enquadramento em retrato, e nenhuma chamada fora de localhost, a `/api` ou à Meta.

## Limitações

- **Sem Meta.** A única fonte de reconstrução é a porta de demonstração, rotulada em todos os ecrãs. O resultado não depende do
  ficheiro escolhido, e a interface diz isso.
- **Regiões só no desenho de demonstração.** Para uma fonte da pessoa, a revisão mostra a imagem sem regiões: o contrato de
  observação não traz coordenadas.
- **Portão 2 sempre «por executar».** O motor não está ligado a esta página; a integração é o laboratório de `/living`.
- **Geometria do laboratório.** É o fixture canónico («forma de demonstração»), não uma montagem construída da revisão.
- **Revisão local.** Não é gravada nem autorizada (não há `reviewerId` nem `authorizationId`).
- **Mapa de zonas.** Documenta o encaixe das funcionalidades existentes; não as liga. Não há uma segunda interface de conversa nem de motor.
- **Renderização.** Capturas com SwiftShader, tier `light`, sem AO nem bloom. Em GPU real, o tier `studio` é mais rico.
