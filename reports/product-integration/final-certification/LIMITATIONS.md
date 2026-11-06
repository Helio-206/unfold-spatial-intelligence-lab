# Limitações e âmbito certificado

## Demonstrado (PASS)
- Reconstrução geométrica **assistida** de veículos em vista lateral/três-quartos, com máscara confirmada pelo utilizador ou aprovada pelo gate de fiabilidade, fitting por câmara estimada com incerteza, e proporções tipadas com revisão/commit/undo.
- Selecção, explicação, isolamento e foco de componentes reais do Space activo; movimento transitório inferido declarado; cinemática **verificada** apenas na montagem sintética da escavadora (solver existente).
- Exploração de objectos não-automóveis nas capacidades existentes (porta: visualização conceptual + interacção inferida, rotulada).
- Persistência: guardar/reabrir Spaces, cenário vivo da escavadora, undo byte-exacto.

## Não suportado (OUT OF SCOPE)
- Reconstrução fotográfica universal ou automática sem assistência.
- Segmentação automática fiável em fundos complexos (medida: IoU 0.20–0.27 clássico; modelo local 0.54–0.77 e mesmo assim sujeito a recusa).
- Vistas frontais/traseiras (recusadas pelo gate de câmara).
- Física real validada: forças, capacidades de elevação, segurança estrutural. Força hidráulica só com pressão/diâmetro declarados; caso contrário, conceptual normalizado.
- Activação por omissão de qualquer flag experimental.

## Não verificado (UNVERIFIED)
- Interpretação Muse Spark ao vivo: sem execuções pagas nesta certificação (contador de chamadas do duplo = 0). Os planos das demonstrações são fixtures rotulados casados por sha256 — nunca apresentados como saída real do modelo.
- Desempenho em GPU real (toda a evidência de browser é SwiftShader/software).
- Anotações de referência: um só anotador (o implementador), sem revisão independente.
- Azimute fino a partir de máscaras de modelo a 160 px (grosseiro; o fluxo com máscara confirmada + píxeis é o caminho medido: 18–22° nos casos reais).

## Limites quantitativos actuais
- IoU de silhueta ajustada: 0.69–0.81 conforme caso/etapa (metas 0.82/0.88 não atingidas na maioria).
- Segmentação automática recusada quando a máscara não é credível — comportamento intencional, não um bug.
- Fitting completo: ~15–20 s no Worker para 73 avaliações (progresso e cancelamento; nunca bloqueia a thread principal).
