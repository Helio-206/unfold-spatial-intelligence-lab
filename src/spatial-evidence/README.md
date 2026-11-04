# Spatial Evidence v1

Núcleo TypeScript independente, sem renderer, backend, UI ou dependências externas. O snapshot é um valor serializável; todas as funções de escrita validam, devolvem uma cópia e exigem o ID da revisão esperada e um novo ID. IDs antigos são mantidos na cadeia para rejeitar reutilização e evitar que um pedido obsoleto volte a ser aceite. Limite: 10 000 revisões por snapshot; persistência, concorrência transaccional e controlo de acesso pertencem ao consumidor. A validação não autentica nem protege um JSON contra adulteração.

## Contrato

- Uma fonte tem ID, SHA-256 hexadecimal minúsculo do conteúdo exacto, tipo e dimensões de cada página disponibilizada. Uma imagem usa a página 1; um documento pode declarar páginas com dimensões distintas, numeradas a partir de 1. A API não calcula o hash nem confirma que o conteúdo corresponde ao hash: o integrador deve fazê-lo.
- Uma região rectangular tem ID, fonte e página existentes e `x`, `y`, `width`, `height` finitos no intervalo normalizado [0,1], com origem no canto superior esquerdo. A largura e a altura são positivas; o rectângulo inteiro deve caber na página. Os números são relativos às dimensões dessa página, não são pixéis. Não se criam coordenadas por defeito.
- O componente tem `id`, um token de `identity` e um `correspondenceVersion`, ambos atribuídos pelo integrador. Uma associação liga um componente a uma região, preserva os tokens desse momento, natureza (`observed`, `inferred`, `approximate`, `unknown`), origem (`ai`, `person`, `import`) e texto de proveniência. A criação só permite `hypothesis`.
- `verifyAssociation` é uma decisão explícita, com actor e revisão declarados pelo cliente. Não prova identidade humana nem transforma uma origem IA ou natureza inferida em observada. `unknown` não pode ser verificada. `verified` significa somente que essa decisão foi registada; uma camada autenticada deve verificar actor e autoridade.
- O mesmo componente não pode ter duas associações activas ao mesmo rectângulo exacto na mesma página/fonte, mesmo com IDs de região diferentes. Sobreposições parciais e regiões partilhadas por componentes diferentes são permitidas: o núcleo não tem informação para as declarar contraditórias.

## Revisões e ciclo de vida

`reconcileComponents` recebe o inventário **completo e autoritativo** após cada edição. Com identidade e versão de correspondência inalteradas, conserva o estado; uma versão alterada marca `needs_review`; remoção ou alteração de identidade marca `invalidated`. Associações invalidadas permanecem para auditoria, mas não aparecem nas consultas activas e nunca são restauradas automaticamente se o ID for reutilizado. Uma revisão explícita pode validar uma correspondência `needs_review` para a versão corrente, preservando a natureza. O consumidor é responsável por alterar o token sempre que uma edição possa afectar a correspondência; o núcleo não consegue detectar essa semântica sozinho.

`addSource`, `addRegion`, `addAssociation`, `verifyAssociation` e `reconcileComponents` exigem revisão esperada e próxima revisão. `associationsForComponent` e `associationsForRegion` retornam hipóteses, verificadas e pendentes de revisão; o consumidor deve inspeccionar `status`. Sem evidência retornam lista vazia. `serializeEvidence` e `deserializeEvidence` validam o mesmo contrato; não escrevem ficheiros ou base de dados. A importação de um snapshot previamente validado não prova autenticidade nem validação humana real.

## Compatibilidade V2/V3

`SpatialPlanV2.components[].id` pode mapear para `component.id`; o plano V2 não contém identidade de encarnação nem contador de correspondência, por isso um adaptador externo deve atribuí-los e geri-los com a revisão do plano. `source.sha256` só é reutilizável quando corresponde aos bytes exactos da imagem ou documento original. O plano V2 não fornece caixas de imagem por componente: não inferir regiões a partir da geometria 3D.

O router V3 do PR #28 preserva IDs e plano quando substitui geometria visual; esse facto é uma compatibilidade de contrato inspeccionada no snapshot `fb1f892`, não prova de integração. Uma mudança apenas visual pode conservar o token se o integrador confirmar que não altera a correspondência. Modificações semânticas, remapeamentos, substituição de fonte ou incerteza sobre o impacto exigem nova revisão/invalidação. Este módulo não altera nem importa V2/V3, e não transforma regiões em dados canónicos do plano.

Outros contratos de grounding podem usar outra escala (por exemplo, 0–1000): converter explicitamente para [0,1], preservando a orientação, o hash dos bytes submetidos e a página. Não existe adaptador nem conversão automática nesta fase.
