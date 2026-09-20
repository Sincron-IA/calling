# US-007 — A thread do agente fica sabendo do pedido feito pelo Calling

**Status:** implemented — aguardando smoke no app de desktop com o bridge (ver .sincron-auto/report.md)
**Parent plan:** docs/exec-plans/plans/plan-001-barra-conversa.md
**Created:** 2026-09-20
**Updated:** 2026-09-20

## Persona

Como **o dono do Calling, que segue a conversa dos agentes pelo Telegram**

## Job-to-be-done

Quero **que o pedido que fiz pelo Calling apareça na thread do agente, citado em blockquote, com o aviso de que ele está cuidando disso** para **não ter dois canais contando histórias diferentes sobre o mesmo assunto**

## Dependências

- **Depende de:** US-006
- **Bloqueia:** nenhuma

## Contexto técnico — dá para colocar no Telegram, mas não pelo caminho óbvio

Dentro da sessão headless a tool de reply do Telegram **não existe**. A regra de
identidade de voz diz isso com todas as letras (`server/src/identity.ts:22`) e
existe exatamente porque o agente tentava chamá-la e a resposta saía errada.

Então quem manda o recado é o **bridge**, falando direto com a Bot API do
Telegram, assim que a mensagem chega — antes de o agente terminar de pensar.
Blockquote é nativo (`parse_mode: HTML`, tag `<blockquote>`).

Formato proposto:

```
📞 Pedido pelo Calling
<blockquote>{o que o dono escreveu}</blockquote>
Tô cuidando disso.
```

Credenciais por agente, no `.env` privado da VPS, no mesmo estilo que
`CALLING_RING_TOKEN_<SLUG>` já usa — nada disso entra no `agents.json`, que é
público. Primeiro passo da story é **descobrir na VPS** de qual bot e de qual
chat cada agente fala; isso não é verificável deste repositório.

Escopo: mensagem de TEXTO. Turno de voz não ecoa — encheria a thread.

## Critérios de aceitação

### FUNCIONAL
- [ ] Documentado em `docs/AGENT-BRIDGE.md` qual bot/chat cada agente usa, descoberto na VPS
- [ ] `.env.example` ganha as variáveis novas, com o mesmo cuidado de explicação das que já existem
- [ ] Toda mensagem aceita por `POST /api/message` dispara o eco na thread do agente correspondente
- [ ] O eco traz o pedido do dono em blockquote e a frase de que o agente está cuidando disso
- [ ] Funciona para os seis agentes de `agents.json`
- [ ] Agente sem credencial configurada: o eco é pulado, a linha vai para o log e **a mensagem segue normalmente**
- [ ] Telegram fora do ar, lento ou devolvendo erro não derruba nem atrasa a resposta ao dono
- [ ] Caracteres `<`, `>` e `&` no texto do dono são escapados — não podem virar tag no Telegram
- [ ] Texto longo é cortado antes do limite de 4096 caracteres da Bot API, com marca de corte

### VISUAL
- [ ] Na thread, o blockquote aparece como citação de verdade (conferido com olho humano no Telegram)

### COMPORTAMENTO
- [ ] Uma mensagem, um eco: reenvio ou retry não duplica o recado
- [ ] Token do bot nunca aparece no log NDJSON, nem em erro
- [ ] O texto do pedido pode aparecer no Telegram (é o objetivo) mas **não** no log do bridge

## Arquivos afetados
*(Construtor preenche após implementação.)*

Previsão: `server/src/index.ts`, `server/src/telegram.ts` (novo), `.env.example`, `docs/AGENT-BRIDGE.md`, `docs/sincron/DECISIONS.md`.

## Histórico de tentativas

## Validation Log

| Round | Linters | Reviewers | LLM Judge | Result |
|---|---|---|---|---|
|       |         |           |           |        |

## Review Checklist

- [ ] docs/review-checklists/ (a criar)
- [ ] Segredo novo no ambiente: conferir que não vaza em log nem em resposta de erro

## Compound Opportunity

Fica registrado o caminho honesto para "o agente avisa no Telegram" sem tocar
nos sockets de sessão viva — e por que o bridge é quem fala, não o agente.

## Compound Decision

- Capture needed: yes
- Destination: architecture
- Reason: terceiro canal do sistema; a escolha de quem fala com o Telegram precisa ficar escrita
- Artifact: —
- Tier: 1
