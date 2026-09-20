# US-009 — Trocar cor, nome e imagem do agente pelo app, e ver o que ele trocar sozinho

**Status:** pending
**Parent plan:** docs/exec-plans/plans/plan-001-barra-conversa.md
**Created:** 2026-09-20
**Updated:** 2026-09-20

## Persona

Como **o dono do Calling, que quer os agentes com a cara certa sem entrar na VPS**

## Job-to-be-done

Quero **trocar a cor, o nome e a imagem de um agente pelo próprio app, e ver aqui quando ele mudar a si mesmo** para **não abrir SSH para um ajuste visual, e para o que o agente decide sobre si não ficar só lá**

## Dependências

- **Depende de:** US-008
- **Bloqueia:** nenhuma

## Contexto técnico

Duas direções, e elas são simétricas porque US-008 pôs a identidade num arquivo
só, dentro do workspace do agente:

- **daqui para lá:** o app manda a mudança, o bridge escreve no arquivo;
- **de lá para cá:** o agente edita o próprio arquivo — ele já tem permissão, não
  precisa de rota nenhuma — e o app fica sabendo.

O caminho é o mesmo de todo o resto: HTTPS pelo túnel do Cloudflare, cookie do
Access mais a chave do app. Nenhuma porta nova, nenhuma exceção de CORS.

Para a segunda direção o bridge vigia os arquivos de identidade e empurra o
aviso pelo SSE que já existe (`GET /api/incoming/stream`, `server/src/index.ts:267`),
com um tipo de evento novo — em vez de abrir um segundo canal.

Peso de imagem: o `express.json` do bridge está em 128&nbsp;kb
(`server/src/index.ts:111`), e avatar não cabe nisso. O upload tem rota e limite
próprios, e a imagem é re-encodada no servidor em vez de ser gravada como veio —
arquivo que chega de fora e que o app depois serve de volta não pode ser
guardado sem ser olhado.

## Critérios de aceitação

### FUNCIONAL
- [ ] A partir da linha do agente na lista dá para abrir a edição daquele agente
- [ ] Dá para trocar o nome de exibição, escolher a cor e enviar uma imagem
- [ ] A cor pode ser escolhida numa paleta e também digitada em hex
- [ ] Salvar escreve no arquivo de identidade do agente na VPS e a lista mostra a mudança na hora
- [ ] Dá para remover a imagem e voltar à inicial
- [ ] O slug NUNCA muda: trocar o nome de exibição não quebra ligação, toque nem sessão de texto em curso
- [ ] Nome vazio, só espaços ou acima do limite é recusado com mensagem que diz o que fazer
- [ ] Cor fora do formato hex de 6 dígitos é recusada antes de gravar
- [ ] Imagem acima do limite de tamanho, ou de tipo não aceito, é recusada com mensagem clara, sem gravar nada
- [ ] Sem `Authorization` correto, ou sem cookie do Access, a edição responde 401 como o resto
- [ ] O agente editando o próprio arquivo na VPS faz a barra atualizar sozinha, sem reabrir o app
- [ ] Um agente só alcança o próprio arquivo: não há como um slug escrever a identidade de outro

### VISUAL
- [ ] A edição é um painel no mesmo material do painel de conexão, não uma tela cheia
- [ ] A cor escolhida aparece em prévia no disco antes de salvar
- [ ] Erro aparece no painel, ao lado do campo que o causou, e o que foi digitado não se perde
- [ ] A imagem enviada aparece recortada em círculo do mesmo jeito que vai aparecer no disco

### COMPORTAMENTO
- [ ] Salvar duas vezes seguidas não deixa metade da mudança gravada: nome, cor e imagem valem como um conjunto
- [ ] Bridge fora do ar na hora de salvar: nada é perdido no painel e a mensagem diz que não salvou
- [ ] A imagem servida pelo bridge nunca volta com tipo que o navegador possa executar
- [ ] O log NDJSON registra que houve edição e de qual agente, sem o conteúdo da imagem
- [ ] `.env.example` e `docs/AGENT-BRIDGE.md` explicam os limites de tamanho e os tipos aceitos

## Arquivos afetados
*(Construtor preenche após implementação.)*

Previsão: `server/src/index.ts`, `server/src/identity-file.ts`, `server/src/avatar.ts` (novo), `web/src/AgentPanel.tsx` (novo), `web/src/CallingBar.tsx`, `web/src/bridge.ts`, `web/src/incoming.ts`, `web/src/styles.css`, `.env.example`, `docs/AGENT-BRIDGE.md`.

## Histórico de tentativas
*(Avaliador preenche a cada rodada.)*

## Validation Log

| Round | Linters | Reviewers | LLM Judge | Result |
|---|---|---|---|---|
|       |         |           |           |        |

## Review Checklist

- [ ] docs/review-checklists/ (a criar)
- [ ] Upload de arquivo: tipo, tamanho, re-encode, e como ele é servido de volta
- [ ] Escrita em disco por slug: confirmar que não há como escapar do workspace

## Compound Opportunity

Primeira escrita do Calling em disco da VPS e primeiro upload. O par "valida,
re-encoda, serve com tipo seguro" é a receita que qualquer upload futuro deste
projeto vai reusar.

## Lessons Captured

## Compound Decision

- Capture needed: yes
- Destination: security
- Reason: primeira rota de escrita e de upload do projeto; as travas precisam ficar escritas antes de virarem hábito
- Artifact: —
- Tier: 1
