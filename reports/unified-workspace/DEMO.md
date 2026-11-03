# UNFOLD: demonstração local

Reconstrução espacial assistida por IA sobre uma família mecânica suportada (escavadora de rastos), com revisão humana e geometria paramétrica de referência. **Não** é reconstrução fotogramétrica fiel de uma fotografia: a geometria restante é sintética e está identificada como tal em todo o percurso.

## Requisitos

Node 24, Google Chrome, `npm install` feito. Para o passo da Meta: uma `MODEL_API_KEY` válida (só no backend; nunca no browser, em logs ou em commits).

## Arrancar (dois terminais)

```bash
# 1. backend (a chave só existe neste processo)
MODEL_API_KEY=... npm run server          # escuta em 127.0.0.1:8787

# 2. frontend: tem de ser a porta 5173, a única origem que o guarda do servidor aceita
npx vite --host 127.0.0.1 --port 5173 --strictPort
```

Abrir `http://127.0.0.1:5173/living`.

Sem chave, o percurso abre na mesma e o pedido à Meta responde «A reconstrução não está configurada neste servidor» (estado `unavailable`, sem inventar resultado). O botão **Abrir exemplo** não precisa de servidor.

## Guião (15 passos)

1. Abrir `/living`: o laboratório está **vazio** (sem máquina), com «Comece por uma máquina», formatos (PNG, JPEG, WebP; até 10 MB e 16 megapixéis) e **Abrir exemplo**.
2. Escolher **Fotografia** e um ficheiro. Aparece a pré-visualização; continua sem máquina.
3. **Reconstruir.** O browser envia a imagem; o backend chama a Meta Muse Spark (≈30 s). Um WebP é convertido em PNG antes de sair.
4. Revisão: a fonte, as entidades (observadas / hipótese / desconhecidas), a evidência de cada uma e o que a fonte não diz.
5. Para cada hipótese: **Confirmar**, **Corrigir** (a interpretação original da IA fica visível) ou **Rejeitar**. Nada vem confirmado. Um desconhecido não se pode «confirmar», só corrigir ou rejeitar.
6. O portão 1 diz exatamente o que falta (por exemplo «faltam dados: caçamba»). **Continuar** só abre quando a estrutura está decidida.
7. Passo «o que o servidor pede»: revisor, família (rastos), caçamba, **largura (0,60 a 2,40 m)** e de onde vem, e as relações/afirmações do modelo, tudo em branco. A lista «o que falta» e o resumo «vai ser enviado» são visíveis. Valores fora de 0,60 a 2,40 m são recusados com o motivo, nunca ajustados.
8. **Abrir no laboratório.** O servidor valida o contrato (validação estrutural).
9. O motor tenta resolver a pose de referência (portão 2). Se recusar (por exemplo `STROKE_OUT_OF_RANGE`) o laboratório não abre, o motivo aparece e a revisão continua editável.
10. Transição para o laboratório 3D, o mesmo `SpatialWorkspace` de sempre, com o perfil premium e a largura da caçamba lida do contrato.
11. Clicar numa peça: inspector canónico e Digital Hand.
12. Perguntar ao assistente («o que acontece se este cilindro se estender?»): devolve uma proposta, nunca executa.
13. Num cilindro: curso alvo → **Pré-visualizar** → **Confirmar movimento**. O motor calcula; há pausa, retoma, tempo e reposição.
14. Ferramenta «Rever a reconstrução» (barra lateral): volta à revisão com as decisões intactas; mudar a largura e abrir outra vez constrói um workspace novo.
15. «Nova máquina» ou «Novo projecto» (no exemplo): volta ao laboratório vazio.

## O exemplo

`/living` → **Abrir exemplo** (ou `/living?example=1`) abre a máquina sintética de referência, identificada como «exemplo · montagem sintética», com um aviso de que **não foi reconstruída a partir de nenhuma fotografia**.

## Testes

```bash
npx vitest run --testTimeout=15000 && npx tsc --noEmit && npm run build
CHROME_PATH=/usr/bin/google-chrome npx tsx tests/e2e/unified-living.pw.ts   # percurso completo com backend real e fornecedor simulado
```

Os E2E antigos gravam por omissão em pastas de relatórios versionadas: correr com `UNFOLD_WORKSPACE_ENGINE_OUT`, `UNFOLD_VF_OUT`, `UNFOLD_E2E_OUT`, `UNFOLD_UX_OUT` apontados para uma pasta temporária.

### Prova com a Meta (paga, opcional)

```bash
UNFOLD_LIVE=1 UNFOLD_PHOTO=/caminho/foto.jpg UNFOLD_ENV_FILE=/caminho/.env \
  npx tsx tests/e2e/unified-live-proof.pw.ts
```

Faz no máximo duas chamadas à Meta e escreve em `reports/unified-workspace/live/`. A revisão é feita por um script, não por uma pessoa, e o relatório di-lo. `UNFOLD_LIVE_FAKE=1` ensaia o mesmo script contra um fornecedor simulado, sem custo.
