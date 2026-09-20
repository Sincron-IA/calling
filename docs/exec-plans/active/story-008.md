# US-008 — A identidade do agente é dele, e o Calling só mostra

**Status:** pending
**Parent plan:** docs/exec-plans/plans/plan-001-barra-conversa.md
**Created:** 2026-09-20
**Updated:** 2026-09-20

## Persona

Como **o dono do Calling, olhando seis avatares no canto da tela**

## Job-to-be-done

Quero **que cada agente apareça com a cor, o nome e a imagem que ele mesmo tem na VPS** para **reconhecer quem é quem sem ler, e para o que o agente muda sobre si aparecer aqui**

## Dependências

- **Depende de:** nenhuma
- **Bloqueia:** US-009

## Contexto técnico

Hoje a identidade visual está partida em três pedaços que não conversam:

- `agents.json` já traz `color` por agente e `publicAgentList()` já o devolve
  (`server/src/agents.ts:76`); `AgentSummary` já tem o campo (`web/src/bridge.ts:14`);
- e mesmo assim a UI ignora tudo isso e pinta por POSIÇÃO na lista
  (`agentColor(index)`, `web/src/agents.ts:16`);
- imagem não existe: o avatar é a inicial do nome (`initialOf`, `web/src/agents.ts:21`).

Esta story escolhe a fonte da verdade e a puxa para um lugar só.

**A identidade mora no workspace do agente**, num arquivo próprio (previsto:
`<workspace>/calling-identity.json`, com `name`, `color` e `avatar`). É isso que
torna possível o agente mudar a si mesmo: ele já tem permissão de escrita no
próprio workspace e não precisa de rota nenhuma para isso.

`agents.json` continua sendo o REGISTRO — slug, workspace, enabled — e o `slug`
segue sendo a chave estável, mesmo que o agente troque o nome de exibição. O
`color` do `agents.json` vira só o valor de partida de quem ainda não tem
arquivo próprio.

A imagem é servida pelo bridge em rota própria, para o binário não viajar dentro
do JSON da lista e para o navegador poder cachear.

## Critérios de aceitação

### FUNCIONAL
- [ ] O bridge lê a identidade de cada agente do workspace dele e devolve `name`, `color` e se há avatar em `GET /api/agents`
- [ ] Agente sem arquivo de identidade cai no `agents.json` e, na falta de `color` lá, na paleta padrão — sem erro e sem quebrar a lista
- [ ] `GET /api/agents/:slug/avatar` devolve a imagem do agente, e 404 quando não há
- [ ] Slug fora da allowlist responde 400 na rota do avatar, como nas outras
- [ ] Arquivo de identidade corrompido ou com campo de tipo errado é ignorado com log, e o agente aparece com o valor de partida
- [ ] Cor inválida (não é hex de 6 dígitos) é recusada e o agente cai no valor de partida
- [ ] A UI passa a usar a cor que veio do bridge em todos os lugares: chip, lista, cartão de chamada, balão de resposta
- [ ] `agentColor(index)` deixa de ser a fonte da cor e sobra só como paleta de partida

### VISUAL
- [ ] O disco do agente mostra a imagem quando ela existe, recortada em círculo, com a borda na cor dele
- [ ] Sem imagem, continua a inicial de hoje — o mesmo desenho, sem buraco
- [ ] Imagem que não carrega cai na inicial, não num ícone quebrado
- [ ] Nome longo não empurra o layout da lista: corta com reticências

### COMPORTAMENTO
- [ ] Trocar o arquivo de identidade na VPS e reabrir o app mostra a mudança
- [ ] O caminho do workspace continua fora da resposta pública (`publicAgentList` não expõe caminho de servidor)
- [ ] O bridge nunca lê nem serve arquivo de fora do workspace daquele agente

## Arquivos afetados
*(Construtor preenche após implementação.)*

Previsão: `server/src/agents.ts`, `server/src/identity-file.ts` (novo), `server/src/index.ts`, `web/src/agents.ts`, `web/src/bridge.ts`, `web/src/CallingBar.tsx`, `web/src/App.tsx`, `docs/AGENT-BRIDGE.md`.

## Histórico de tentativas
*(Avaliador preenche a cada rodada.)*

## Validation Log

| Round | Linters | Reviewers | LLM Judge | Result |
|---|---|---|---|---|
|       |         |           |           |        |

## Review Checklist

- [ ] docs/review-checklists/ (a criar)
- [ ] Leitura de arquivo por slug: confirmar que não há como escapar do workspace

## Compound Opportunity

"Identidade mora com o agente, registro mora no repo" é a decisão que faz o
agente poder se reconfigurar sem API nenhuma. Vale em `DECISIONS.md`.

## Lessons Captured

## Compound Decision

- Capture needed: yes
- Destination: architecture
- Reason: escolha da fonte da verdade da identidade; tudo em US-009 depende dela
- Artifact: —
- Tier: 1
