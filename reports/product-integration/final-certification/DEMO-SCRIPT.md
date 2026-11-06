# Roteiro de demonstração (uma só experiência: o laboratório espacial)

Pré-requisitos: backend local (`npx tsx server/index.ts`, chave Meta opcional — sem ela, usar `&example=1` e o fluxo `?demo`) e Vite (`npx vite`). Abrir:

`/living?debug-living=1&experimental-foundry=1&experimental-photoreal=1&experimental-living-intelligence=1&experimental-mediapipe=1`

1. **O objecto chega.** Novo espaço → anexar a fotografia do Skoda (`tests/fixtures/photos-real/skoda-kodiaq.jpg`) → «Pedir à Meta» (na demo certificada, o plano é um fixture rotulado casado por hash — dizê-lo em voz alta). Rever componentes: manter todos, reconhecer, **Construir em 3D**. O carro aparece no palco único, com photoreal.
2. **A evidência é honesta.** Na revisão, mostrar «Corrigir contorno»: a máscara automática falhou; arrastar os pontos até coincidir com o SUV, pré-visualizar a máscara verde, **Confirmar contorno**. Explicar a etiqueta: *corrigido por si, não verificado*.
3. **Compreender.** Clicar numa roda no painel Living Intelligence → «Explicar componente»: a resposta refere `wheel-0`, relações e desconhecidos do plano real. Mostrar o estado do fitting (câmara estimada dos píxeis, IoU antes/depois).
4. **Experimentar com revisão.** Painel Foundry → «Propor proporções derivadas da evidência» → ler o estado (distância entre eixos estimada). Mostrar que **nada mudou** no plano. Seleccionar a roda → autorizar → **Aplicar**: a geometria regenera a partir do plano commitado. **Desfazer**: volta exactamente ao original.
5. **Trazer à vida.** Mudar para a escavadora de exemplo (mesma sessão, mesmo palco): seleccionar a lança → «O que faz a lança?» → «Estende o cilindro da lança» → ver o conjunto ligado a mover → Pausa → «Explicação passo a passo» → Experiência do cilindro com antes/depois → Repor. Declarar: máquina sintética com cinemática verificada, não é a fotografia reconstruída.
6. **Persistir.** Guardar o Space do veículo e reabri-lo da biblioteca: mesma fonte, mesmos componentes.
7. **Fechar com limites.** Mostrar `LIMITATIONS.md` durante 10 segundos: frontal recusado, automático nem sempre fiável, física não validada. A honestidade faz parte da demonstração.

Duração alvo: 4–6 minutos. Nunca apresentar os fixtures como interpretação Muse Spark ao vivo.
