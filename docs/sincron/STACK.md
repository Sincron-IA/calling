# Stack

## Resumo

- Framework: Vite 8 + React 19 (app web); Express 5 (bridge)
- Linguagem: TypeScript 7
- Package manager: npm (workspaces)
- Banco: nenhum — não há persistência
- Auth: segredo compartilhado (Bearer) entre app e bridge
- Hospedagem: Vercel (app web) + VPS da Sincron (bridge)
- Observabilidade: logs de processo (stdout), sem ferramenta externa

## Estrutura

```text
web/src/
  App.tsx      escolha do agente, orb "bars", ligar/desligar
  gemini.ts    adapter da Gemini Live + intercepta a tool ask_agent
  bridge.ts    cliente HTTP do bridge
  styles.css

server/src/
  index.ts     rotas Express
  gemini.ts    token efêmero + system prompt + declaração da tool ask_agent
  claude.ts    invoca o agente real (claude -p) e mantém a sessão da ligação
  identity.ts  monta AGENT.md + regras do canal de voz
  agents.ts    lê agents.json (allowlist)
  auth.ts      segredo compartilhado

electron/main.js   janela fina apontando pro app web
agents.json        registro dos agentes
```

- páginas/rotas: app de tela única (`web/src/App.tsx`)
- componentes: `orb-ui` (externo) + o próprio `App.tsx`
- server actions: não se aplica
- route handlers: `server/src/index.ts`
- libs: `web/src/bridge.ts`, `server/src/*.ts`
- migrations: não se aplica
- testes: ainda não há suíte automatizada (ver `TESTING.md`)

## Padrões

- componentes: função + hooks, sem biblioteca de estado
- server-side: Express 5, ESM, handlers pequenos e diretos
- client-side: `fetch` com Bearer; sem cliente HTTP extra
- validação: checagem de tipo na borda do handler + allowlist de agente
- banco: não há
- logs: só evento e duração. Nunca transcrição, resposta de agente ou chave

## Rotas do bridge

| Rota | Método | O que faz |
| --- | --- | --- |
| `/health` | GET | liveness, sem auth |
| `/api/agents` | GET | lista os agentes disponíveis |
| `/api/gemini-live-token` | POST | emite token efêmero + config da sessão |
| `/api/ask` | POST | implementa `ask_agent`: chama o agente real |
| `/api/end-call` | POST | descarta a sessão da ligação |

Todas, exceto `/health`, exigem `Authorization: Bearer <CALLING_SHARED_SECRET>`.
