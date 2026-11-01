# UNFOLD — Continuação da estabilização

Data: 2026-11-01
Branch: `phase-10-mvp-stabilization`
Base preservada: `62fe7eb118067d35140c02ed7410cf37f7e85c47`
Worktree: `/home/helio/HEr/META/unfold-spatial-intelligence-lab-final-stabilization`

## Resultado

Veredicto global: **CONDITIONAL**. O caminho local de edição e persistência passou no browser headed e as salvaguardas offline foram reforçadas. A reconstrução da planta de aceitação continua dependente de tracing manual e visualmente simples; não é uma reconstrução automática fiel nem uma validação de inteligência do Muse.

## Correcções adicionais

- A aceitação de um vínculo semântico agora compara o documento e a imagem activos e exige que os vértices e IDs de limite da região ainda coincidam com o snapshot da proposta. Uma proposta antiga não pode ser aceite após deslocar a vectorização mantendo o mesmo ID.
- Workspaces sem o novo snapshot geométrico continuam legíveis. Propostas legadas sem snapshot não podem ser aceites até serem refeitas contra a vectorização actual; o schema `semantic_spatial_map.v1` não descarta automaticamente os dados anteriores.
- O ledger de chamadas Meta configurado falha fechado se desaparecer. A ausência já não é interpretada como orçamento novo com `used=0`. Testes criam explicitamente ledgers temporários de fixture; nenhum ledger histórico foi lido, alterado ou reinicializado nesta execução.
- A validação de imagens deixou de aceitar apenas as assinaturas PNG/JPEG. PNG requer sequência de chunks íntegra, CRCs válidos, IHDR/IDAT/IEND e limites de dimensões; JPEG requer segmentos de frame/scan consistentes e EOI. Os testes passaram a usar imagens sintéticas válidas completas, identificadas apenas como fixtures.
- O handoff de imagem/documento captura os objectos e a geração que iniciou a operação. Se a imagem ou análise mudar durante hashing/armazenamento, a abertura do editor é cancelada; a imagem não é associada ao documento anterior.
- A persistência da imagem mantém chaves por SHA-256 e identidade documental; refresh completo restaura a fonte correspondente à cena. O E2E confirmou a associação após reload.
- A cena 3D abre na vista de modelo, não na sobreposição raster. Iluminação e material do pavimento sugerido foram ajustados para uma leitura mais neutra. A telemetria de teste foi removida da composição visual; continua disponível ao script E2E.
- O teste CDP espera por pós-condições persistidas em commit/undo e tolera a invalidação temporária do execution context durante reload. Isso remove flakiness observada, sem relaxar as asserções geométricas.

## Aceitação headed

Evidência: [`final-clean-headed/A/result.json`](evidence/final-clean-headed/A/result.json) e capturas em [`final-clean-headed/A/`](evidence/final-clean-headed/A/).

- Chrome 155 headed, renderer `ANGLE (AMD Radeon Graphics / radeonsi renoir ACO)`, viewport 1440×960; emulação 390×844 sem overflow horizontal. Emulação não substitui dispositivo físico.
- A rota `/demo` preservou a cena através de upload, tracing, build, abertura, resize, comando local, Undo/Redo, refresh, guardar e restaurar. Sem erros JS observados e sem chamadas reais Meta (`metaCalls: 0`). Os dois pedidos de agente foram deliberadamente respondidos por falha 503 interceptada para validar fallback local; não são evidência do Muse Spark.
- A planta A usada é a imagem legada 650×446, SHA-256 `54f4162e73cc1563b403a18a56ece8a99dc8d98e27c6edc48663a645cb8f0fc8`, recuperada read-only da worktree anterior. Detecção: 16 segmentos, 0 regiões e 0 aberturas automáticas. Após tracing manual: 13 paredes e 1 região. Altura, espessura e escala têm proveniência não verificada/hipotética. O resultado não representa a planta nova fornecida pelo utilizador.
- A parede Three.js manteve bounds consistentes com `spatial_scene.v1`; a alteração de +0,50 m, a abertura, commit, Undo/Redo e restauro foram verificados por estado persistido. Porta/janela de teste foram criadas com parâmetros explicitamente hipotéticos, não extraídas da imagem.
- O renderer AMD produziu amostras de chamadas de render espaçadas aproximadamente a 16,7 ms durante movimento de câmara. Isso é cadência observada numa janela curta de animação, não benchmark sustentado. O contador de FPS de diagnóstico era inadequado ao renderer sob pedido e foi ocultado; não se afirma desempenho geral de 60 FPS.

Capturas principais:

- Modelo após construção: [`06-built.png`](evidence/final-clean-headed/A/06-built.png)
- Planta original: [`01-original.png`](evidence/final-clean-headed/A/01-original.png)
- Candidatos automáticos: [`02-candidates.png`](evidence/final-clean-headed/A/02-candidates.png)
- Tracing manual: [`03-manual-tracing.png`](evidence/final-clean-headed/A/03-manual-tracing.png)
- Abertura e preview antes/depois: [`12-before-after.png`](evidence/final-clean-headed/A/12-before-after.png)
- Cena restaurada: [`09-restored.png`](evidence/final-clean-headed/A/09-restored.png)

## Blender e visual

O Blender 4.0.2 está instalado e o pipeline/script existentes estão presentes. A biblioteca `.blend` contém 36 objectos, sete materiais e 1.214 polígonos; o GLB existente tem cerca de 188 kB. A aceitação headed confirmou que os assets de parede/abertura são renderizados no editor. Nenhum asset foi gerado ou sobrescrito nesta continuação. A presença dos sete módulos não prova que todos sejam usados na casa reconstruída.

A captura continua a mostrar uma massa de paredes aberta e simples. Isso decorre dos dados efectivamente disponíveis no cenário E2E: zero regiões e zero aberturas detectadas, seguidas de tracing manual. Não acrescentámos mobiliário, divisões ou cotas para imitar a referência Blender. As duas imagens anexadas pelo utilizador foram tratadas como referência visual e fonte potencial; não se copiou a geometria da renderização, nem se declarou a planta nova reconstruída.

## Verificações

- `npm test`: **PASS — 42 ficheiros, 288 testes**.
- `npm run build`: **PASS**, com aviso existente de chunk `OrbitControls` ~586 kB minificado / ~150 kB gzip.
- `npm audit`: **PASS — 0 vulnerabilidades**.
- `git diff --check`: **PASS**.
- E2E headed CDP: **PASS**, com respostas Meta bloqueadas/interceptadas; zero chamadas externas.
- E2E `phase-10-semantic-restore`: **PASS**; uma proposta de fixture legada foi carregada, mas a aceitação foi recusada porque a região não existia na vectorização actual. O estado continuou `proposed`.
- E2E `phase-10-source-isolation`: **PASS** usando a planta A anterior e a nova imagem A do utilizador (SHA-256 `8b85b3f98620257932a2ef20a48f628a659e27f37ea5c61576c9ff80fcad1488`). Reutilizar o ID determinístico `line-0` não criou associação cruzada; comandos e inspector foram bloqueados antes de qualquer pedido, preview ou escrita. Isto testa isolamento, não reconstrução da nova planta.

## Limitações / decisão

1. A planta A permanece quase totalmente manual. A planta de 1280×720 anexada nesta conversa ainda não passou pelo pipeline de detecção, calibração e correcção.
2. Não há prova independente da exactidão das dimensões, espessuras, cotas nem da geometria interpretada.
3. Não foi realizada nova chamada real ao Muse Spark, nem se alegou que tenha ocorrido.
4. O resultado visual fica abaixo do alvo de apartamento Blender mobiliado. Mobiliário só poderá ser incluído como camada sugestiva explícita, nunca como geometria observada, e a actual implementação não demonstra ainda esse fluxo.
5. A aceitação semântica depende de correspondência exacta dos vértices serializados; alterações de ordenação equivalentes são tratadas como obsoletas e exigem nova proposta, intencionalmente fail-closed.

Conclusão: correções de integridade e teste headed aprovadas; o produto e a reconstrução continuam **CONDITIONAL**, não PASS.
