# Projeto Sincron — Calling

Este arquivo deve ser mantido igual ao arquivo equivalente (`AGENTS.md` ou `CLAUDE.md`).

## O Que E Este Projeto

**Calling** e um app de voz que liga o Luiz (e o Matheus) aos agentes DG Claw
(Automa, Ivo, Theo, Bravo, Flow, Vetor) que rodam na VPS da Sincron.

A ideia central, e a parte que mais importa entender antes de mexer no codigo:

> A **Gemini Live API nao e o cerebro**. Ela e so ouvido e boca.
> Quem pensa e responde e o agente DG Claw de verdade, com a identidade e a
> memoria dele.

A Gemini Live faz captura de microfone, transcricao, deteccao de turno e fala.
Toda pergunta e obrigatoriamente repassada para a tool `ask_agent`, que o bridge
implementa chamando o agente real via Claude Code headless.

Leia `docs/AGENT-BRIDGE.md` antes de alterar qualquer coisa no `server/`.

## Leitura Inicial

Leia nesta ordem, so o necessario para a tarefa:

1. `.sincron/project.json`
2. `docs/sincron/STACK.md`
3. `docs/AGENT-BRIDGE.md` (o coracao do projeto)
4. `docs/sincron/SECURITY.md`
5. `docs/sincron/TESTING.md`
6. `docs/sincron/DEPLOYMENT.md`
7. `docs/sincron/DATA-MAP.md`
8. `docs/sincron/DECISIONS.md`

## Estrutura

```text
web/       app Vite + React + TypeScript + shadcn/ui — vai pra Vercel
server/    bridge Node/Express — roda NA VPS, onde os agentes moram
electron/  wrapper fino: so abre uma BrowserWindow apontando pro app
agents.json  registro dos agentes que podem receber ligacao
```

## Interface

Tudo o que se ve e componente pronto do shadcn/ui. Antes de escrever markup
novo, procure o que ja existe (`npx shadcn@latest search`) — o `styles.css` de
2.134 linhas morreu justamente por ter sido escrito no lugar disso.

Tres regras que custaram caro para descobrir, todas em `docs/SHADCN.md`:

- **Nada de `Popover`, `DropdownMenu`, `Sheet` ou `sonner` na janela da barra.**
  Eles renderizam em portal no `body` E se posicionam com `position: absolute`.
  A janela do Electron veste o tamanho do conteudo (o `DesktopGate` mede o
  `#root`), e filho posicionado fora da caixa nao entra na medida do pai — a
  janela nao cresce e o menu nasce cortado. Passar `container` no Portal nao
  resolve. O que abre na barra fica EM FLUXO, na coluna.
- **Utilidade escrita a mao nao pode ter par base/modificador em duas classes.**
  O Tailwind v4 reordena as utilidades por conta propria. Use
  `&[data-estado='true']` dentro da propria `@utility`.
- **Nada abre no hover.** A janela mudando de tamanho debaixo do cursor devolve
  `pointerenter`/`pointerleave` sinteticos. Clique abre, clique/Esc/clicar fora
  fecha.

Para conferir o desenho sem subir o Electron: `npm run dev --workspace=web` e
`http://localhost:5173/?preview=panels` (`web/src/Preview.tsx`, so em DEV).

## Comandos

```bash
npm install          # instala os tres workspaces
npm run dev          # app web (porta 5173)
npm run dev:server   # bridge (porta 8787)
npm run build        # build do app web
npm run typecheck    # checa tipos de web + server
npm run electron       # app de desktop em dev (usa o build de web/dist)
npm run electron:build # empacota um executavel portatil pro SO onde rodar
                        # (electron/dist/) — ver README.md "Empacotar"
npm run registry --workspace=web   # gera o registro shadcn em web/public/r
```

## Comandos Sincron

- `/sincron-status`: entender o estado atual do projeto.
- `/sincron-tarefas`: buscar/criar/atualizar tarefas do kanban.
- `/sincron-deploy preflight`: validar alteracoes antes de PR/main/producao.
- `/sincron-env`: sincronizar `.env` criptografado.
- `/sincron-seguranca`: revisar seguranca.

## Regras Obrigatorias

- Nunca commitar `.env`. Usar `/sincron-env`.
- `GEMINI_API_KEY` vive **somente no servidor**. O browser recebe token efemero.
- Nada de segredo em variavel `VITE_*` que nao seja aceitavel publicamente.
- Nunca logar transcricao, resposta de agente ou chave de API.
- O `slug` do agente vindo de uma tool call sempre e validado contra a allowlist
  de `agents.json` — nunca vira caminho de arquivo direto.
- Nao conectar nos sockets de sessao viva em `/tmp/cc-socks/` (ver DECISIONS).
- Merge em `main` e deploy de producao exigem aprovacao humana (Luiz).

## Sincronizacao Deste Arquivo

Sempre que atualizar `AGENTS.md`, aplicar a mesma alteracao em `CLAUDE.md`, e vice-versa.
