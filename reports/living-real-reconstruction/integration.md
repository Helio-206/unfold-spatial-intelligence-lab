# Reconstrução — interface técnica e evidência

Estado: **NO-GO para reconstrução fiel da fotografia**. Existe um percurso experimental ponta a ponta com uma geometria de referência sintética; não se obteve uma medição real da caçamba nem revisão por uma pessoa durante o ensaio. O contrato válido não certifica segurança mecânica, colisões ou simulação.

## API

`POST /api/living/reconstruction` mantém as mesmas guardas locais de origem/token. A primeira chamada aceita `{ "mode": "live", "sourceKind": "image", "imageDataUrl": "data:image/jpeg;base64,...", "sourceReference": "referencia" }`. `mode` também aceita `offline`, que é uma fixture, não percepção visual. A resposta inclui `sessionId`, `mode`, observação, proposta, limitações e metadados. JPEG/PNG: 10 MB, 10.000 px por lado e 16 milhões de pixels máximos. Os dados devem conter dimensões legíveis no cabeçalho. As sessões guardam apenas a observação na memória do processo por 30 minutos, sem persistência; reiniciar o servidor invalida-as. Capacidade: 100 sessões.

A revisão é outro POST à mesma rota:

```json
{
  "action": "review",
  "sessionId": "id-retornado-na-primeira-chamada",
  "review": {
    "reviewerId": "identificacao-do-revisor",
    "family": "tracked_excavator",
    "bucketConfirmed": true,
    "decisions": { "hypothesis:id": "reject", "entity:id": "confirm", "relation:id": "reject", "request:id": "reject" },
    "bucketWidthM": 1.4,
    "widthBasis": "valor fornecido pelo utilizador e respetiva referência"
  }
}
```

A lista acima é ilustrativa: incluir uma decisão por cada item de `hypotheses`, por cada entidade e relação com `status: hypothesis` e por cada pedido, usando os IDs devolvidos. Pedidos confirmados são bloqueados porque ainda não há adaptador para eles. A interface deve recolher as decisões, a confirmação da família e da caçamba, a largura e a sua origem numa interação humana. A API apenas recebe alegações do cliente: `reviewerId` não autentica identidade nem prova participação humana. Se faltar escala ou a largura não for fornecida, a montagem é bloqueada com 422 e motivos; sessão inexistente ou expirada devolve 404. Rejeitar hipótese não a converte em facto, e dimensões produzidas pelo modelo não são usadas automaticamente pelo adaptador.

A resposta de revisão inclui `originalObservation` com a observação recebida, `review` com as decisões submetidas, `assembly` (`unfold.assembly.v1`), proposta, `geometry` com a largura anterior e posterior, e `validation: contract_valid`. A observação original e as decisões são independentes: rejeitar uma hipótese não muda o seu estado original para `unknown`. A geometria base, pose e peças vêm de fixture sintética, não da fotografia. Apenas a largura da caixa da caçamba é alterada; a sua origem é declarada na resposta como `client_submitted`, com medição não verificada. A proveniência do shape canónico usa `origin: unknown` e `actor: system`, pois a API não tem prova da autoria humana. A revisão não produz movimentos ou cálculos do motor. Famílias de rodas identificadas são bloqueadas, assim como famílias não confirmadas e valores fora de 0,1–10 m. A identificação por texto não cobre todas as máquinas incompatíveis: a confirmação humana é obrigatória.


## Handoff para o Claude Terminal e consumidor 3D

1. O primeiro POST devolve `sessionId`, `mode`, `observation` (inalterada pelo utilizador), `assemblyProposal` e `meta`. Apresentar `entities`, `relations`, `dimensions`, `hypotheses`, `unknowns` e evidências como declarações do modelo, não como factos. As dimensões do modelo não entram automaticamente na montagem. A sessão é local ao processo e expira em 30 minutos.
2. O segundo POST envia `action: review`, `sessionId` e `review` como no exemplo acima. Não apresentar `reviewerId` como autenticação ou prova de revisão humana. Recolher decisões e origem da largura na interface e preservar o registo do fluxo de interação fora desta API, se necessário. A API não autentica a pessoa nem verifica a medição.
3. Exemplo parcial de resposta de sucesso (os campos `originalObservation`, `review`, `proposal` e `assembly` são objetos completos na resposta real):

```json
{
  "contract": "unfold.reconstruction.review.v1",
  "sessionId": "id-retornado",
  "mode": "live",
  "status": "contract_valid",
  "provenance": {
    "observation": { "source": "meta_model", "statuses": "model_reported" },
    "review": { "source": "client_submitted", "reviewerIdentity": "unverified", "humanParticipation": "unverified" },
    "bucketWidth": { "source": "client_submitted", "measurement": "unverified", "basis": "referência declarada" },
    "remainingGeometry": { "source": "synthetic_fixture" }
  },
  "validation": "contract_valid",
  "geometry": { "bucketWidthBeforeM": 1.1, "bucketWidthAfterM": 1.4 }
}
```

   Em `offline`, `observation.source` é `offline_fixture` e `statuses` é `fixture_generated`. `observed`, `hypothesis` e `unknown` dentro da observação são classificações da fonte; não são validação física. O valor submetido é `client_submitted`, não uma medição comprovada. A geometria restante é `synthetic_fixture`. Em caso de falta de largura, família incompatível ou decisão incompleta, a resposta é HTTP 422, por exemplo:

```json
{ "contract": "unfold.reconstruction.review.v1", "sessionId": "id-retornado", "status": "blocked", "reasons": ["largura da caçamba deve estar entre 0,1 e 10 m"] }
```

4. Para desenhar a largura alterada, o consumidor deve localizar em `assembly.parts` a parte com `id: bucket` e, nas suas `shapes`, a caixa `id: bucket-box`. A largura total no eixo local Z é `2 * halfExtentsM[2]`, em metros; `geometry.bucketWidthAfterM` é um resumo, não substitui o shape canónico. Respeitar a pose local do shape e a pose da parte fornecidas pelo contrato, sem aplicar a escala duas vezes. A caixa é uma geometria de referência de engenharia, não uma medição ou forma fotográfica.
5. **Integração visual pendente:** a Foundry atual constrói a malha da caçamba com `halfW = 0.55` fixo em `src/living/visual-foundry/excavator/arm.ts`. Não consome esta largura; mudar o contrato não muda a malha. O proprietário da Foundry deve ligar `halfW` e todos os elementos dependentes à metade da largura aprovada, mantendo a ligação, os pinos, a pose, colisão e sincronização da montagem coerentes. Verificar com duas larguras, escala visível, sem deformar outras partes ou quebrar constraints; os testes desta branch não demonstram isso.
6. Sem largura submetida a API bloqueia; não deduz metros de uma fotografia sem escala. A resposta `contract_valid` verifica estrutura e constraints do adaptador: não é cálculo executado, validação física, autorização de movimento ou garantia visual. Não enviar automaticamente a montagem para movimento.

## Evidência Meta

- [Fotografia 1 — Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Doosan_tracked_excavator.jpg), versão 960 × 638, SHA-256 `0e8bb9e548026b363b00caba1f186a477a469a67b8f44fd5b8b845512fd159f5`. Request `f55481bc-07bb-4404-b362-50228eb5eb6f`, HTTP 200, completed, observação validada. O modelo assinalou rastos, lança e braço; classificou a ferramenta na extremidade como desconhecida e propôs uma hipótese para a ferramenta oculta. Não retornou dimensões.
- [Fotografia 2 — Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Tracked_Takeuchi_excavator.JPG), versão 960 × 729, SHA-256 `2c7e48a47ca03d331ef57a0d21177a3a751a733b750d489639dc1bd66334db6d`. Request `49bb1e98-7e49-4faf-bfce-293ea015e332`, HTTP 200, completed, observação validada. O modelo assinalou caçamba, lança, braço e rastos; a base foi classificada desconhecida. Não retornou dimensões. As observações não são prova de precisão do modelo.
- Ensaio da API com a fotografia 1: request `cd2a54e7-5f86-4cf5-9730-cfead153cb5c`; resposta live 200 e revisão simulada 200. Foi inserida a largura fictícia de 1,40 m para verificar o caminho: a largura no contrato mudou de 1,10 m para 1,40 m. O ensaio simulou confirmação da caçamba apesar de a fotografia não permitir confirmá-la. Não é medição nem revisão humana realizada.
- Ensaio após ajuste de proveniência com a fotografia 2: request `d01a0c66-2238-42de-986c-5f721019c76f`; observação live 200, revisão simulada 200, largura fictícia 1,10 → 1,40 m.
- Não foi provado que imagens diferentes produzam geometrias diferentes com base em evidência visual. Com as mesmas decisões e a mesma largura, ambas podem resultar na mesma fixture. Os valores desconhecidos da fotografia mantêm-se desconhecidos.

## Limitações

Não há reconstrução de proporções a partir de imagem, edição genérica de hipóteses ou medições, validação humana real do ensaio, persistência multi-processo, testes visuais da experiência integrada ou prova de desempenho de GPU. A saída é uma variante explícita de fixture e não uma reconstrução da forma oculta. O modelo pode errar ao descrever evidência e o consumidor deve apresentar a imagem e as incertezas na revisão. A política de origem e o token são adequados apenas ao backend local existente; não são autenticação multiutilizador para um deploy público.
