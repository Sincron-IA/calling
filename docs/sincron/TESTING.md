# Testes

## Comandos

- Build: `npm run build` (app web) e `npm run build:server`
- Typecheck: `npm run typecheck` (web + server)
- Lint: não configurado
- Unitários: não há suíte ainda
- Integração: smoke manual do bridge (abaixo)
- Smoke test: ver abaixo
- Segurança: `/sincron-seguranca`

## Estado atual, sem enfeite

Não existe suíte automatizada. O que foi validado até agora foi **manual, mas de
verdade, nesta VPS** — não é teoria:

- `claude -p` headless dentro do workspace de um agente responde com a
  identidade certa;
- prompt por stdin funciona;
- a identidade de voz suprime a "Regra Zero do Telegram" (resposta sai em texto
  falado, sem markdown, sem tentar chamar a tool de reply);
- `--session-id` + `--resume` mantêm memória entre turnos da mesma ligação;
- `/api/agents` sem segredo responde 401;
- `/api/ask` com slug inválido (`"../../etc"`) responde 400;
- dois turnos seguidos na mesma `callId`: o agente lembrou do número do turno
  anterior;
- latência medida: ~6 s por turno com `sonnet`.

Não foi possível testar de ponta a ponta com áudio real: falta a
`GEMINI_API_KEY`, que é do Luiz. **O caminho de voz (mic → Gemini → tool call →
fala) ainda não rodou nenhuma vez.**

## Smoke test do bridge

Com o bridge no ar (`npm run dev:server`) e `CALLING_SHARED_SECRET` definido:

```bash
SECRET=<seu-segredo>

curl -s localhost:8787/health

curl -s -H "authorization: Bearer $SECRET" localhost:8787/api/agents

curl -s -X POST localhost:8787/api/ask \
  -H "authorization: Bearer $SECRET" -H 'content-type: application/json' \
  -d '{"agent":"automa","message":"teste de voz, responda curtinho","callId":"teste-1"}'
```

Repetir a última chamada com o mesmo `callId` e uma pergunta que dependa do
turno anterior valida a continuidade da sessão.

## Fluxos Críticos

- Login/logout: não se aplica
- Permissões: chamada sem `Authorization` deve dar 401
- Fluxo principal: hover na barrinha → tocar no avatar → falar → ouvir → tocar de novo (desliga)
- Troca de agente: chevron → escolher outro na lista encerra a ligacao atual e abre a nova
- Chamada recebida (ainda sem bridge): em dev, `__calling.ring('ivo', 'motivo')` no console
  deve virar cartao pulsando; `Aprovar`, atender e recusar limpam o cartao (hoje os
  callbacks so logam `console.warn` — veja os TODO de `web/src/incoming.ts`)
- Fluxo administrativo: não se aplica
- Erro esperado: bridge fora do ar → o app mostra o erro e não trava
- Upload/anexos: não se aplica

## Critério Para Preflight

- `npm run build` passa;
- `npm run typecheck` passa;
- smoke test do bridge responde;
- nenhum segredo commitado.

## Próximos passos de teste

1. Ligação real com áudio, assim que houver `GEMINI_API_KEY`.
2. Teste automatizado de `agents.ts` (allowlist) e `auth.ts` (comparação do
   segredo) — são as duas bordas de segurança e são fáceis de cobrir.
