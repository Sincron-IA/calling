# Decisões

Registre decisões técnicas, exceções e motivos.

## Template

```md
## YYYY-MM-DD - Título

- Contexto:
- Decisão:
- Alternativas:
- Impacto:
- Revisar em:
```

## Decisões

## 2026-09-19 - Gemini Live é só a camada de áudio, não o cérebro

- Contexto: o Luiz pediu falar por voz com os agentes DG Claw "com o MESMO
  contexto e capacidades de sempre". Se a Gemini respondesse sozinha, seria um
  modelo genérico imitando a Automa a partir de um prompt — exatamente o que ele
  não quer.
- Decisão: a sessão Gemini Live cuida só de microfone, transcrição, detecção de
  turno e fala. O system prompt dela declara que ela é uma camada de voz, que
  não sabe nada sobre o dono, e que para QUALQUER fala do usuário precisa chamar
  a tool `ask_agent` e depois ler a resposta praticamente palavra por palavra.
- Alternativas: (a) dar a persona à Gemini via prompt — rejeitada, não é o
  agente real e não tem a memória; (b) LiveKit ou Pipecat como orquestrador —
  fora de escopo no v1, são caminhos de upgrade mais pesados.
- Impacto: a resposta demora mais (~6 s), porque há um turno de LLM extra. Em
  compensação, quem fala é o agente de verdade.
- Revisar em: quando a latência incomodar mais que a fidelidade.

## 2026-09-19 - O bridge chama o agente por `claude -p` headless, não pela sessão viva

- Contexto: cada agente DG Claw roda como uma sessão `claude` interativa e
  longeva, atendendo o Telegram. O ideal teórico seria a ligação cair *naquela*
  sessão.
- Decisão: o bridge cria uma sessão headless própria (`claude -p`), com
  `cwd` no workspace do agente, `--append-system-prompt-file` com a identidade
  dele e `--session-id`/`--resume` para manter memória dentro da ligação.
- Alternativas: falar o protocolo dos sockets de sessão viva em
  `/tmp/cc-socks/*.sock` (usado pelas tools `SendMessage`/`ListAgents`).
  **Rejeitada de propósito**: protocolo interno, não documentado, feito para
  sessão-viva-com-sessão-viva. Um programa externo falando ali é frágil e pode
  corromper a sessão de um agente que está no ar atendendo o dono.
- Impacto — a limitação honesta: a ligação **não** é a continuação da conversa
  do Telegram. É o mesmo agente (mesma identidade, mesmo `CLAUDE.md`, mesmos
  arquivos de memória, mesmas ferramentas), mas em outra sessão. O que atravessa
  entre os dois canais é o que o agente registra em `working-memory.md` e
  `MEMORY.md`. Documentado em `docs/AGENT-BRIDGE.md`; não prometer "é
  literalmente o mesmo processo".
- Revisar em: se o Claude Code passar a expor um jeito suportado de entregar uma
  mensagem a uma sessão interativa existente.

## 2026-09-19 - Identidade de voz substitui a "Regra Zero do Telegram"

- Contexto: o launcher do DG Claw monta a identidade como `AGENT.md` + regras do
  canal Telegram, que mandam o agente responder chamando a tool de reply. Numa
  chamada headless essa tool não existe.
- Decisão: o bridge monta `AGENT.md` + uma "Regra Zero do canal de voz"
  (`server/src/identity.ts`): não existe reply do Telegram, a resposta final é o
  que será falado, texto corrido em pt-BR, sem markdown, curto.
- Alternativas: reaproveitar o `/tmp/dgclaw-identity-*.txt` da sessão viva —
  rejeitada: o caminho é aleatório por processo, o arquivo some quando a sessão
  cai, e o conteúdo traz justamente as regras erradas para voz.
- Impacto: respostas saem no formato certo para locução. Testado: o agente
  respondeu "Setenta e sete anotado" em vez de markdown.
- Revisar em: se o `bootstrap-identity.sh` do DG Claw mudar de formato.

## 2026-09-19 - Token efêmero da Gemini, emitido pelo bridge

- Contexto: a `GEMINI_API_KEY` é uma credencial de gasto ilimitado. Num app de
  browser ela ficaria legível para qualquer um.
- Decisão: a chave fica só no servidor. O bridge emite um token efêmero
  (`ai.authTokens.create`) com `uses: 1`, validade curta e
  `liveConnectConstraints` travando modelo e config.
- Alternativas: chave direto no `VITE_*` — rejeitada, vira código público.
- Impacto: o `VITE_CALLING_SHARED_SECRET` ainda fica visível no app; é o que
  protege o bridge. Por isso o bridge é de uso pessoal e deve ficar em rede
  restrita.
- Revisar em: se o app deixar de ser só do Luiz e do Matheus.

## 2026-09-19 - orb-ui com tema "bars"

- Contexto: escolha explícita do Luiz.
- Decisão: `orb-ui@0.8.1`, componente `<Orb theme="bars">` com o adapter
  `createGeminiLiveAdapter`. O orb-ui cuida de microfone, playback PCM e
  detecção de turno no cliente; por isso o bridge desliga a detecção automática
  do lado do servidor (`realtimeInputConfig.automaticActivityDetection.disabled`).
- Alternativas: outro tema — não, foi pedido específico.
- Impacto: o pacote é publicado como `orb-ui` no npm (não `@exprmntl/orb-ui`).
- Revisar em: nunca, sem o Luiz pedir.

## 2026-09-19 - Monorepo com npm workspaces

- Contexto: três artefatos com ciclos de vida diferentes — app na Vercel, bridge
  na VPS, wrapper de desktop.
- Decisão: um repo com `web/`, `server/` e `electron/` em workspaces npm.
- Alternativas: repos separados — complicaria demais para um projeto pequeno.
- Impacto: o `vercel.json` instala só o workspace `web` para não baixar o
  Electron no build.
- Revisar em: se o bridge crescer a ponto de merecer repo próprio.

## 2026-09-19 - Kanban Sincron (pendência)

- Contexto: o padrão Sincron pede um card no kanban para o projeto.
- Decisão: **não** criado por este trabalho — a Automa tem o acesso à API e vai
  criar. `.sincron/project.json` está com `project_id` e `active_card_id` vazios.
- Impacto: preencher os dois campos quando o card existir.
