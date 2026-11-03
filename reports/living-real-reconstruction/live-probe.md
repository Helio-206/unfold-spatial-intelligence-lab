# Reconstrução: sondagem inicial da Meta

Base: `main` c1390c75d981cfb9bdb43b8e9466ccfdd317a227. Esta sondagem não constitui demonstração de reconstrução visual.

- Entrada textual A: “Escavadora de rastos com lança longa e balde estreito.” Com 5.000 tokens e esforço médio, resposta incompleta (`max_output_tokens`), request `c32d51dc-f98f-42fa-b71d-8a667feda049`. Nenhuma observação aceite. Após ajustar o pedido textual para 8.000 tokens e esforço baixo, resposta completa e validada, request `2be8385a-6c93-4709-8d1b-c77781c0ef3a`: rastos, lança longa e balde estreito como hipóteses; dimensões e geometria oculta desconhecidas.
- Entrada textual B: “Escavadora compacta de rodas com braço curto e balde largo.” Com configuração inicial, resposta completa e validada, request `7637fa6d-544b-4a76-a96b-98db8dd2139f`: rodas, braço curto e balde largo como hipóteses; dimensões, materiais e configuração de rodas desconhecidos.
- As entradas são texto, não fotografias. As observações diferem semanticamente, mas não foi demonstrada geometria adaptada. A segunda entrada descreve uma máquina de rodas que não deve ser considerada compatível automaticamente com o template de rastos.
- Falta: imagem real, comparação geométrica suportada, revisão e correções humanas, interface de integração para adaptação segura, limites de dimensões da imagem, validação do percurso completo e testes exigidos. Não há GO.
- O endpoint existente bloqueia a passagem automática para engenharia; o adaptador existente exige seed e autorização de revisão, e pode recusar geometrias por constraints incompatíveis.
