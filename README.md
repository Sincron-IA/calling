# Calling

Ligacao por voz com os agentes DG Claw da Sincron (Automa, Ivo, Theo, Bravo,
Flow, Vetor). Voce abre o app, **toca no avatar** do agente e conversa falando —
ele responde em voz alta. Os outros cinco ficam numa fila de avatares ao lado;
tocar num deles troca de agente. E uma ligacao por vez.

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
agents.json quais agentes podem receber ligacao
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

## Build

```bash
npm run build       # app web  -> web/dist
npm run build:server
npm run typecheck   # web + server
```

## Desktop (Electron)

Wrapper fino de proposito: e a mesma pagina web dentro de uma janela.

```bash
npm run build       # gera web/dist
npm run electron
```

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

## Seguranca

- `GEMINI_API_KEY` fica **so no servidor**. O browser recebe um token efemero
  (uso unico, validade curta, modelo e config travados).
- O acesso e por um segredo compartilhado — deliberadamente simples, porque isto
  e ferramenta pessoal do Luiz e do Matheus, nao produto multiusuario.
- O segredo do app fica visivel para quem abrir o app. Por isso o bridge deve
  ficar em rede restrita. Ver [`docs/sincron/SECURITY.md`](docs/sincron/SECURITY.md).
- Transcricao e resposta de agente **nao** sao gravadas em lugar nenhum.

## Custo

Cada turno de fala custa a Gemini Live (~US$ 0,02–0,04/min) **mais** uma chamada
ao agente (~US$ 0,07–0,12 com `sonnet`). Ver `docs/AGENT-BRIDGE.md`.

## Licenca

MIT.
