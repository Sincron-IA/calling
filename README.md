# Calling

Ligacao por voz com os agentes DG Claw da Sincron (Automa, Ivo, Theo, Bravo,
Flow, Vetor). O app fica quieto: so uma **barrinha no canto**. Passando o mouse
nela aparece o avatar do ultimo agente chamado — um toque liga de novo, e o
chevron abre a lista dos outros cinco. E uma ligacao por vez.

Quando um agente e que precisa do Luiz, a barrinha vira um cartao de **chamada
recebida**, com o motivo em uma linha e tres saidas: `Aprovar` (resolve na hora,
sem voz), atender por voz, ou recusar — e a recusa (no dedo ou por tempo) cai
para o Telegram, que continua sendo o canal padrao.

A parte que importa: **quem responde e o agente de verdade**, com a identidade e
a memoria dele. A Gemini Live API entra so como ouvido e boca. Leia
[`docs/AGENT-BRIDGE.md`](docs/AGENT-BRIDGE.md) para entender o desenho — e os
limites honestos dele.

## Como funciona

```text
voz  ->  Gemini Live (escuta, transcreve, detecta turno)
     ->  tool ask_agent
     ->  bridge na VPS  ->  claude -p no workspace do agente
     ->  resposta em texto
     ->  Gemini Live fala
```

## Estrutura

```text
web/        app Vite + React + TypeScript (orb-ui, tema "bars") — vai pra Vercel
server/     bridge Node + Express — roda NA VPS, junto dos agentes
electron/   wrapper fino de desktop: so abre uma janela com o app web
agents.json quais agentes o Calling conhece (nome, workspace, cor) — sem segredo
docs/       AGENT-BRIDGE.md + padrao Sincron em docs/sincron/
```

## Rodando local

Precisa de Node 20+.

```bash
npm install
```

### 1. Variaveis de ambiente

Copie o modelo e preencha. **Nunca commite o `.env`** — use `/sincron-env` para
sincronizar o arquivo criptografado.

```bash
cp .env.example .env
```

O minimo para rodar:

| Variavel | Onde | O que e |
| --- | --- | --- |
| `GEMINI_API_KEY` | servidor | chave do [Google AI Studio](https://aistudio.google.com/apikey) |
| `CALLING_SHARED_SECRET` | servidor | segredo compartilhado (gere um aleatorio) |
| `VITE_BRIDGE_URL` | app | URL do bridge (`http://localhost:8787` em dev) |
| `VITE_CALLING_SHARED_SECRET` | app | o mesmo valor do `CALLING_SHARED_SECRET` |

Gerando o segredo:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Suba o bridge (na VPS, onde os agentes moram)

```bash
npm run dev:server     # http://localhost:8787
```

Confira: `curl http://localhost:8787/health`

### 3. Suba o app

```bash
npm run dev            # http://localhost:5173
```

Abra no navegador, escolha o agente e ligue. O navegador vai pedir permissao do
microfone — e preciso aceitar.

> O bridge so funciona **na VPS**, porque ele executa o binario do Claude Code
> dentro do workspace de cada agente. Rodando na sua maquina, o app sobe mas as
> ligacoes falham.

## Quando um agente liga (chamada recebida)

O agente toca o Calling com um POST e **fica na linha**: a resposta HTTP so sai
quando o Luiz decide (ou quando o tempo acaba). Nao ha polling nem webhook de
volta — do lado do agente e um `await` e pronto.

```bash
curl -X POST https://<bridge>/api/ring \
  -H "authorization: Bearer $CALLING_RING_TOKEN_IVO" \
  -H "content-type: application/json" \
  -d '{"reason":"Backup da madrugada falhou, posso rodar de novo agora?"}'
# ... fica pendurado ate o Luiz responder ...
{"callId":"...","outcome":"approved","resolvedAt":1789866633232}
```

Desfechos possiveis: `approved` (resolveu no dedo, sem voz), `answered` (ele vai
falar com voce por voz), `declined` (recusou) e `no_answer` (nao respondeu a
tempo). O que fazer com cada um e **decisao do agente que ligou** — inclusive
avisar no Telegram, que e trabalho dele, nao do Calling.

A identidade vem da **credencial**, nao de um nome declarado: cada agente tem o
seu `CALLING_RING_TOKEN_<SLUG>` no `.env` privado da VPS, e o bridge descobre
quem esta ligando pelo segredo apresentado. Nao da para um agente se passar por
outro. O `CALLING_SHARED_SECRET` continua sendo outra coisa: e o do app no
browser.

## Quando o agente so quer FALAR (recado empurrado)

Nem tudo merece um toque. Quando o agente so tem algo a dizer — e nao uma
decisao a pedir — ele empurra um recado que aparece no app e sai sozinho, sem
botao e sem ninguem ficar pendurado:

```bash
curl -X POST http://127.0.0.1:8787/api/agents/automa/notify \
  -H "authorization: Bearer $CALLING_SHARED_SECRET" \
  -H "content-type: application/json" \
  -d '{"text":"Deploy terminou: verde. Nao precisa fazer nada."}'
{"ok":true,"listeners":1}
```

`listeners` e quantas telas estavam abertas para ouvir. **Zero nao e erro** — e o
app fechado; o recado simplesmente nao alcancou ninguem, e quem chamou precisa
saber disso pela resposta, nao pelo log. Teto de 2000 caracteres.

Repare no segredo: aqui e o `CALLING_SHARED_SECRET` (o do app), e nao o
`CALLING_RING_TOKEN_<SLUG>` do toque — quem usa esta rota ja esta dentro da VPS,
com o `.env` na mao.

## Quando o dono fala pelo Calling, a sessao VIVA fica sabendo

Para os agentes listados em `CALLING_WAKE_AGENTS` (hoje so `automa`), um recado
ou uma ligacao pelo Calling **acorda a sessao viva** do agente — a mesma que
atende o Telegram — com o mesmo mecanismo dos agendamentos do DG Claw
(`inject_session`). Recado escrito acorda na hora; ligacao de voz acorda uma vez
so, no fim, com os turnos em ordem. Sessao ocupada adia e tentamos de novo (3 ×
30 s).

Junto disso, e so para esses agentes, cada troca vira uma linha NDJSON em
`<workspace>/calling-log/<AAAA-MM-DD>.ndjson` (0700/0600). Esse e o log de
**conteudo**, autorizado pelo dono, e e separado do log de **operacao** em
`/var/log/calling-bridge/`, que nunca viu — e nao vai ver — conversa.

Agente fora da lista: nada disso roda, e o comportamento e exatamente o de
antes.

### Colocar um agente novo no Calling

Sem tocar em codigo — sao dois passos:

1. Uma entrada no `agents.json` (publico, **sem segredo**):

   ```json
   { "slug": "nina", "name": "Nina", "workspace": "/home/dgclaw-nina", "color": "#f97316", "enabled": true }
   ```

2. Uma linha no `.env` privado da VPS, com o slug em maiusculas:

   ```bash
   echo "CALLING_RING_TOKEN_NINA=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" >> .env
   ```

Depois `systemctl restart calling-bridge.service`. Tirar um agente e o inverso:
`"enabled": false` (ou apagar a entrada) e apagar a linha do `.env`. Agente sem
credencial simplesmente nao consegue tocar.

## Build

```bash
npm run build       # app web  -> web/dist
npm run build:server
npm run typecheck   # web + server
```

## Desktop (Electron)

A mesma pagina web dentro de uma janela — com tres coisas que o navegador nao
consegue dar.

```bash
npm run build       # gera web/dist
npm run electron
```

**1. Tela de conexao, sem editar `.env`.** Na primeira vez o app pede duas
coisas: o *endereco do bridge* e a *chave do app* (o `CALLING_SHARED_SECRET`).
Depois disso ele nao pergunta mais. A engrenagem no canto reabre essa tela.

**2. O login do Cloudflare acontece dentro do app.** O botao "Conectar ao
Cloudflare" abre a mesma tela de login por email de sempre, numa janela do
proprio app, usando a **sessao padrao** do Electron. Como o cookie
`CF_Authorization` nasce na mesma sessao que os `fetch` da barra usam — e essa
sessao e persistente —, nao e preciso logar toda vez: so quando o proprio
Access expirar. Se o cookie ainda valer, a janela de login nem chega a
aparecer.

**3. A chave fica cifrada.** O `electron/config-store.js` guarda
`calling-config.json` no `userData` com o endereco em texto e a chave cifrada
pelo `safeStorage` (Keychain / DPAPI / libsecret). Se a maquina nao tiver cofre,
a chave **nao e gravada** — fica so na memoria da execucao e o app avisa na
tela que vai pedir de novo. Nunca ha segredo em texto puro no disco.

Detalhe de rede: sem `CALLING_APP_URL`, o app serve o `web/dist` em
`http://localhost:5173` (so no loopback) em vez de abrir `file://`. E de
proposito — uma pagina `file://` manda `Origin: null`, que o bridge recusa. Com
a porta de sempre, o app de desktop tem a mesma origem que o `npm run dev`, e
`CALLING_ALLOWED_ORIGINS` nao precisa de nenhuma linha nova. Se a porta estiver
ocupada, o app sobe em outra e avisa no console qual origem liberar
(`CALLING_APP_PORT` fixa outra porta).

Para apontar para outro lugar (dev server ou a URL da Vercel):

```bash
CALLING_APP_URL=http://localhost:5173 npm run electron
```

Empacotar como `.exe`/`.dmg`/`.AppImage` ainda **nao** esta feito. Quando for
preciso, o caminho e adicionar `electron-builder` ao workspace `electron/`.

## Deploy

- **App web (Vercel):** o `vercel.json` ja esta pronto (build na raiz, saida em
  `web/dist`, rewrite de SPA). Basta importar o repo e definir `VITE_BRIDGE_URL`
  e `VITE_CALLING_SHARED_SECRET` nas variaveis do projeto.
- **Bridge (VPS):** precisa ficar atras de **HTTPS** — a Vercel serve o app em
  https e o navegador bloqueia chamada para http (mixed content). Use um proxy
  reverso (Caddy ou nginx) com dominio e certificado, e coloque a URL da Vercel
  em `CALLING_ALLOWED_ORIGINS`.

Detalhes em [`docs/sincron/DEPLOYMENT.md`](docs/sincron/DEPLOYMENT.md).

## Log do bridge

O `journalctl` continua servindo para olhar ao vivo, mas ele mistura ruido do
systemd com a saida do app e nao da para filtrar. Entao o bridge tambem escreve
um log proprio, **um JSON por linha** (NDJSON), feito para ser procurado depois
com ferramenta comum:

```
/var/log/calling-bridge/current.log   -> link para o arquivo ativo
/var/log/calling-bridge/bridge.N.log  -> os rodados
```

```bash
# por que uma origem foi recusada (com o valor exato da origem)
grep '"event":"cors_rejected"' /var/log/calling-bridge/current.log | jq .

# o que aconteceu com os toques
jq -c 'select(.event=="ring_resolved")' /var/log/calling-bridge/*.log

# tudo que deu errado hoje
grep '"level":"error"' /var/log/calling-bridge/*.log
```

Eventos: `bridge_started`, `http_request`, `cors_rejected`, `live_token_issued`,
`live_token_failed`, `live_token_unknown_agent`, `ring_created`,
`ring_resolved`, `incoming_action`, `incoming_action_stale`, `sse_attached`,
`sse_unauthorized`, `ask_answered`, `ask_failed`, `unhandled_error`.

**Tamanho e limitado:** rodizio por tamanho (`pino` + `pino-roll`), 5 MB por
arquivo e 5 arquivos no total — teto de ~25 MB, nunca cresce para sempre. Os
caminhos e limites mudam pelo `.env` (`CALLING_LOG_DIR`, `CALLING_LOG_MAX_SIZE`,
`CALLING_LOG_MAX_FILES`, `CALLING_LOG_LEVEL`).

O diretorio fica **fora do repositorio** de proposito: o worktree em
`.claude/worktrees/` e descartavel, e o log precisa sobreviver a restart e a
rebuild.

**Segredo nao entra no log.** Vai metadado: origem, caminho, metodo, status,
duracao, slug do agente, desfecho, mensagem de erro. Nunca a chave da Gemini, o
segredo do app, o token efemero, o motivo do toque, a pergunta ou a resposta.

## Seguranca

- **Origens permitidas** (`CALLING_ALLOWED_ORIGINS`): lista explicita, separada
  por virgula. Sem curinga — com `credentials: true` o proprio Fetch recusa `*`,
  e abrir para qualquer origem tiraria a ultima barreira depois do Access.
  Detalhe que ja custou uma ligacao: para o navegador `http://localhost:5173` e
  `http://127.0.0.1:5173` sao origens **diferentes**, mesmo caindo na mesma
  maquina. O bridge resolve isso sozinho — endereco de loopback na lista libera
  as tres grafias (`localhost`, `127.0.0.1`, `[::1]`) naquela mesma porta. A
  **porta**, porem, e literal: se o Vite subir no 5174 por o 5173 estar ocupado,
  acrescente a porta no `.env`. Quando alguma coisa e recusada, o log diz qual
  origem era (`cors_rejected`) e o cliente recebe 403 com texto, nao 500 mudo.
- `GEMINI_API_KEY` fica **so no servidor**. O browser recebe um token efemero
  (uso unico, validade curta, modelo e config travados).
  Nao passe `lockAdditionalFields` ao criar esse token: no `@google/genai`
  2.23.0 ele faz o SDK derivar um `field_mask` invalido quando a config tem
  `tools` (400 `field_mask is invalid for BidiGenerateContentSetup`). Sem o
  campo, a API ja trava tudo que foi enviado no setup. Ver `server/src/gemini.ts`.
- O acesso do app e por um segredo compartilhado — deliberadamente simples,
  porque isto e ferramenta pessoal do Luiz e do Matheus, nao produto multiusuario.
- Chamada recebida e diferente: cada agente tem **credencial propria**
  (`CALLING_RING_TOKEN_<SLUG>`), para o bridge poder afirmar quem esta ligando.
  Esses segredos moram so no `.env` (0600, carregado pelo `EnvironmentFile` do
  systemd), nunca no `agents.json` nem no `ExecStart`.
- O segredo do app fica visivel para quem abrir o app. Por isso o bridge deve
  ficar em rede restrita. Ver [`docs/sincron/SECURITY.md`](docs/sincron/SECURITY.md).
- Transcricao e resposta de agente **nao** sao gravadas em lugar nenhum.

## Custo

Cada turno de fala custa a Gemini Live (~US$ 0,02–0,04/min) **mais** uma chamada
ao agente (~US$ 0,07–0,12 com `sonnet`). Ver `docs/AGENT-BRIDGE.md`.

## Licenca

MIT.
