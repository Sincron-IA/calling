# US-006 — O bridge aceita mensagem de texto numa sessão que dura

**Status:** implemented — aguardando smoke no app de desktop com o bridge (ver .sincron-auto/report.md)
**Parent plan:** docs/exec-plans/plans/plan-001-barra-conversa.md
**Created:** 2026-09-20
**Updated:** 2026-09-20

## Persona

Como **o dono do Calling, escrevendo para o mesmo agente ao longo do dia**

## Job-to-be-done

Quero **que o agente lembre do que eu escrevi antes** para **não ter que recontar o contexto a cada mensagem**

## Dependências

- **Depende de:** nenhuma
- **Bloqueia:** US-005, US-007

## Contexto técnico

`server/src/claude.ts` guarda sessões por `callId:slug` (`sessionKey`, linha 28)
e as joga fora no `endCall` (linha 49). Texto não tem chamada: a chave passa a
ser o AGENTE, e a sessão sobrevive entre mensagens.

Voz e texto do mesmo agente compartilham a sessão persistente, então dá para
ligar e continuar o assunto escrito — sem isso seriam duas memórias separadas
do mesmo agente no mesmo dia.

A identidade também muda: `buildVoiceIdentity` (`server/src/identity.ts:53`)
manda falar como quem fala em voz alta. Texto precisa de um bloco próprio:
resposta curta, sem markdown pesado (o balão é pequeno), e o aviso explícito de
que a tool de reply do Telegram não existe nesta sessão — a mesma armadilha que
a regra de voz já resolve.

## Critérios de aceitação

### FUNCIONAL
- [ ] `POST /api/message` aceita `{ agent, text }` e devolve `{ reply }`
- [ ] Sem `Authorization` correto responde 401, como as outras rotas protegidas
- [ ] `agent` fora da allowlist responde 400 (mesma trava de `/api/ask` com `"../../etc"`)
- [ ] `text` vazio, só espaços ou acima do limite definido responde 400
- [ ] Duas mensagens seguidas para o mesmo agente: a segunda lembra da primeira
- [ ] A sessão de texto NÃO é destruída por `POST /api/end-call`
- [ ] Uma ligação de voz aberta depois enxerga o que foi escrito antes, e vice-versa
- [ ] Duas mensagens disparadas ao mesmo tempo para o mesmo agente são enfileiradas, nunca dois `--resume` simultâneos (a fila de `claude.ts` já existe)
- [ ] Sessão parada por mais de 24h é recolhida; a mensagem seguinte abre uma nova sem erro
- [ ] Timeout respeita `CALLING_AGENT_TIMEOUT_MS` e devolve erro legível, não pendura a requisição

### VISUAL
- [ ] Não se aplica (rota de servidor)

### COMPORTAMENTO
- [ ] Cada mensagem deixa uma linha no log NDJSON com agente e resultado — e **nunca** com o texto do pedido
- [ ] O smoke test de `docs/sincron/TESTING.md` ganha o comando equivalente para `/api/message`

## Arquivos afetados
*(Construtor preenche após implementação.)*

Previsão: `server/src/index.ts`, `server/src/claude.ts`, `server/src/identity.ts`, `web/src/bridge.ts`, `docs/sincron/TESTING.md`, `docs/AGENT-BRIDGE.md`.

## Histórico de tentativas

## Validation Log

| Round | Linters | Reviewers | LLM Judge | Result |
|---|---|---|---|---|
|       |         |           |           |        |

## Review Checklist

- [ ] docs/review-checklists/ (a criar)
- [ ] Bordas de segurança: allowlist de agente e comparação do segredo

## Compound Opportunity

`agents.ts` (allowlist) e `auth.ts` (segredo) são as duas bordas de segurança e
`TESTING.md` já as aponta como fáceis de cobrir. Esta story é a hora de nascer a
primeira suíte automatizada do projeto.

## Lessons Captured

## Compound Decision

- Capture needed: yes
- Destination: tests
- Reason: primeira suíte automatizada cobrindo as duas bordas de segurança
- Artifact: —
- Tier: 1
