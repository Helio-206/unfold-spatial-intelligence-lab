# Workspace design (protótipo isolado)

Espaço de trabalho espacial do UNFOLD: o objecto ocupa o ecrã, a inteligência está na interacção, a interface só aparece
quando é precisa. Isolado de propósito: não toca no editor arquitectónico, no renderer da aplicação nem nos tokens.

```
npm run dev
# http://127.0.0.1:5173/src/living/workspace-design/harness/index.html            (rota real, fixture se indisponível)
# http://127.0.0.1:5173/src/living/workspace-design/harness/index.html?agent=fixture (nunca chama a rede)
# http://127.0.0.1:5173/src/living/visual-foundry/harness/golden.html?profile=export (Golden Frame, sem UI)
```

## Peças

| Ficheiro | Faz |
|---|---|
| `workspace-state.ts` | Redutor puro: modos conversa / assistido / foco, nível das sobreposições, histórico, avisos que nunca se escondem |
| `camera-arbiter.ts` | Quem mexe na câmara. O utilizador ganha sempre; o assistente só depois de 2,5 s sem input e nunca com gestos activos |
| `camera-director.ts` | O único sistema de câmara: OrbitControls + transições com `motion/tokens`, interrompíveis, instantâneas em reduced-motion |
| `framing.ts` | Desloca o centro de projecção para a área útil (sem rail, compositor, painéis) e calcula o enquadramento |
| `digital-hand.ts` | Resolve ids canónicos para âncoras no mundo, projecta, detecta oclusão, fora de vista e ids desconhecidos |
| `agent-client.ts` | `/api/spatial-agent` existente, modo `mechanical`, mesmo parser; fixture rotulado só quando o modelo não está disponível |
| `fixture-agent.ts` | Respostas determinísticas no schema `spatial_agent_result.v1` |
| `grounding.ts` | Resultado do agente → alvo canónico + acto espacial permitido (apontar, seleccionar, inspeccionar, enquadrar) ou bloqueio |
| `experiments.ts` | Experiências suportadas: decide localmente o que pode correr; sem motor, só pré-visualização de fixture |
| `scene-controller.ts` | Destaque, isolamento, vista explodida (só visual) e picking por parte canónica |
| `workspace.ts` / `.css` | A vista. CSS só com tokens |

## Atalhos

`F` foco · `Esc` um passo atrás (sai sempre do foco) · `C` conversa · `H` respostas visíveis/atenuadas/ocultas · `R` repor
câmara · `/` escrever · setas e `+`/`−` com a cena focada · `Enter` na cena selecciona o alvo da mão.

## Integração proposta (para o Claude Cloud)

1. `SpatialWorkspace` recebe a montagem; o runtime cinemático só precisa de chamar `scene.setPoses(framePoses(frame))` com
   quadros `unfold.motion-frame.v1` do motor. O renderer nunca resolve relações de engenharia.
2. Trocar `poses.ts#engineSource` pela fonte real; o rótulo «fixture» desaparece só quando o quadro vem do motor.
3. Extrair o compositor de `src/workspace.ts` para um módulo partilhado e usá-lo aqui (hoje replica-se a estrutura em `uw-`).
4. Acrescentar o harness a `vite.config.ts` como entrada de build se for para publicar (não foi feito: é ficheiro partilhado).
