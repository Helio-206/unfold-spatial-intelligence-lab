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

A lista acima é ilustrativa: incluir uma decisão por cada item de `hypotheses`, por cada entidade e relação com `status: hypothesis` e por cada pedido, usando os IDs devolvidos. Pedidos confirmados são bloqueados porque ainda não há adaptador para eles. A decisão, a confirmação da família e da caçamba, a largura e a sua origem devem resultar de interação humana real. Se faltar escala ou a largura não for fornecida, a montagem é bloqueada com 422 e motivos; sessão inexistente ou expirada devolve 404. Rejeitar hipótese não a converte em facto, e dimensões produzidas pelo modelo não são usadas automaticamente pelo adaptador.

A resposta de revisão inclui `assembly` (`unfold.assembly.v1`), proposta revista, decisões, `geometry` com a largura anterior e posterior, e `validation: contract_valid`. A geometria base, pose e peças vêm de fixture sintética, não da fotografia. Apenas a largura da caixa da caçamba é alterada; o valor é `human_entered`, não medição certificada. A revisão não produz movimentos ou cálculos do motor. Famílias de rodas identificadas são bloqueadas, assim como famílias não confirmadas e valores fora de 0,1–10 m. A identificação por texto não cobre todas as máquinas incompatíveis: a confirmação humana é obrigatória.

## Evidência Meta

- [Fotografia 1 — Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Doosan_tracked_excavator.jpg), versão 960 × 638, SHA-256 `0e8bb9e548026b363b00caba1f186a477a469a67b8f44fd5b8b845512fd159f5`. Request `f55481bc-07bb-4404-b362-50228eb5eb6f`, HTTP 200, completed, observação validada. O modelo assinalou rastos, lança e braço; classificou a ferramenta na extremidade como desconhecida e propôs uma hipótese para a ferramenta oculta. Não retornou dimensões.
- [Fotografia 2 — Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Tracked_Takeuchi_excavator.JPG), versão 960 × 729, SHA-256 `2c7e48a47ca03d331ef57a0d21177a3a751a733b750d489639dc1bd66334db6d`. Request `49bb1e98-7e49-4faf-bfce-293ea015e332`, HTTP 200, completed, observação validada. O modelo assinalou caçamba, lança, braço e rastos; a base foi classificada desconhecida. Não retornou dimensões. As observações não são prova de precisão do modelo.
- Ensaio da API com a fotografia 1: request `cd2a54e7-5f86-4cf5-9730-cfead153cb5c`; resposta live 200 e revisão simulada 200. Foi inserida a largura fictícia de 1,40 m para verificar o caminho: a largura no contrato mudou de 1,10 m para 1,40 m. O ensaio simulou confirmação da caçamba apesar de a fotografia não permitir confirmá-la. Não é medição nem revisão humana realizada.
- Ensaio após ajuste de proveniência com a fotografia 2: request `d01a0c66-2238-42de-986c-5f721019c76f`; observação live 200, revisão simulada 200, largura fictícia 1,10 → 1,40 m.
- Não foi provado que imagens diferentes produzam geometrias diferentes com base em evidência visual. Com as mesmas decisões e a mesma largura, ambas podem resultar na mesma fixture. Os valores desconhecidos da fotografia mantêm-se desconhecidos.

## Limitações

Não há reconstrução de proporções a partir de imagem, edição genérica de hipóteses ou medições, validação humana real do ensaio, persistência multi-processo, testes visuais da experiência integrada ou prova de desempenho de GPU. A saída é uma variante explícita de fixture e não uma reconstrução da forma oculta. O modelo pode errar ao descrever evidência e o consumidor deve apresentar a imagem e as incertezas na revisão. A política de origem e o token são adequados apenas ao backend local existente; não são autenticação multiutilizador para um deploy público.
