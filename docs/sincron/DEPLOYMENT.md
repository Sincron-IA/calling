# Deploy

São duas peças com destinos diferentes. O app web vai para a Vercel; o bridge
**tem** que rodar na VPS, porque ele executa o Claude Code dentro do workspace
de cada agente.

## App web (Vercel)

O `vercel.json` na raiz já está pronto:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "web/dist",
  "installCommand": "npm install --include-workspace-root --workspace=web",
  "framework": "vite",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

O `installCommand` instala só o workspace `web` de propósito, para o build da
Vercel não baixar o Electron.

Passos:

1. Importar `Sincron-IA/calling` na Vercel (root do projeto = raiz do repo).
2. Definir as variáveis de ambiente do projeto:
   - `VITE_BRIDGE_URL` — a URL **https** pública do bridge;
   - `VITE_CALLING_SHARED_SECRET` — o mesmo segredo do bridge.
3. Deploy.

> Variável `VITE_*` é embutida no bundle **no momento do build**. Trocou o
> valor? Precisa rebuildar.

## Bridge (VPS)

```bash
npm install
npm run build:server
CALLING_SHARED_SECRET=... GEMINI_API_KEY=... node server/dist/index.js
```

Em produção, rodar como serviço do systemd (mesmo padrão dos outros serviços da
casa), com as variáveis vindas de um `EnvironmentFile` fora do git.

### HTTPS é obrigatório se o app estiver na Vercel

A Vercel serve o app em `https`. O navegador **bloqueia** chamada de página
https para endpoint http (mixed content). Então o bridge precisa de um proxy
reverso com TLS:

- um subdomínio (ex.: `calling-bridge.<dominio>`);
- Caddy ou nginx com certificado (Let's Encrypt);
- `proxy_pass` para `localhost:8787`;
- `CALLING_ALLOWED_ORIGINS` com a URL da Vercel.

**Não deixe o bridge aberto na internet só com o segredo compartilhado.** Ver
`SECURITY.md`: quem alcança o bridge alcança os agentes, que rodam com
`bypassPermissions`. Restrinja por IP, VPN ou Cloudflare Access.

### Cloudflare Access precisa liberar o `content-type` no CORS

Se o bridge estiver atrás do Cloudflare Access (é o caso de
`calling-bridge.sincronia.digital`), **quem responde o preflight é o Access, não
o nosso `cors()`**. E o preflight do navegador nunca leva cookie: o
`CF_Authorization` não ajuda nessa hora.

Então, nas *CORS settings* da aplicação no Zero Trust, a lista de
**Access-Control-Allow-Headers** tem que incluir `content-type` além de
`authorization`. Sem isso, toda chamada com corpo JSON (`POST /api/message`,
`POST /api/ask`, `POST /api/gemini-live-token`, `PUT .../identity`) morre no
preflight, o app mostra o `TypeError: Failed to fetch` seco e **a requisição nem
aparece no log do bridge** — o que faz parecer bug de servidor quando não é.

Conferir sem depender de login nenhum (preflight não é autenticado):

```bash
# tem que voltar com access-control-allow-origin/headers
curl -si -X OPTIONS https://calling-bridge.sincronia.digital/api/message \
  -H 'Origin: http://localhost:5173' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization,content-type' \
  | grep -i '^access-control'
```

Resposta vazia = o Access está barrando; ajuste a lista de headers lá.

### Alternativa sem expor nada

Se a ideia for usar só do computador do Luiz: rodar o app local
(`npm run dev`) ou pelo Electron, com o bridge acessível por túnel SSH:

```bash
ssh -L 8787:localhost:8787 <vps>
```

Aí `VITE_BRIDGE_URL=http://localhost:8787` e nada precisa ficar público. É o
caminho mais seguro e o recomendado para começar.

## Electron

O wrapper roda local, apontando para o build (`web/dist`) ou para
`CALLING_APP_URL`.

### Empacotamento (executável portátil)

Feito, via `electron-builder` — configuração em `electron/electron-builder.yml`.
Um comando só, na raiz do monorepo:

```bash
npm run electron:build
```

Ele roda o `npm run build` do `web` e empacota o wrapper **com o `web/dist`
junto**, em `resources/web/dist` (fora do `asar`), que é exatamente onde o
`electron/main.js` já procura — `path.join(__dirname, '..', 'web', 'dist')`
resolve para lá dentro do pacote, sem precisar mudar o código.

Saída em `electron/dist/` (ignorado pelo git). Alvos configurados, todos
**portáteis**, sem instalador:

| SO | Alvo | Artefato |
| --- | --- | --- |
| Windows | `portable` | `Calling-<versão>-portable.exe` |
| macOS | `zip` (arm64 + x64) | `Calling-<versão>-<arch>-mac.zip` |
| Linux | `AppImage` | `Calling-<versão>-x86_64.AppImage` |

**Cada SO empacota o seu.** O electron-builder escolhe o alvo pela máquina onde
roda; `.exe` no Linux exigiria wine e o `.app` de macOS só sai num Mac. Para o
`.exe` e o `.zip`, rodar o mesmo comando na máquina Windows / no Mac (Node 20+,
`npm install` antes). Dentro de `electron/` há `build:win`, `build:mac` e
`build:linux` para forçar um alvo.

Validado nesta VPS Linux: `Calling-0.1.0-x86_64.AppImage` (~126 MB) gerado com
sucesso e o app empacotado sobe servindo o `web/dist` embutido no loopback.

Pendências conhecidas (nenhuma bloqueia o build):

- **Ícone do app**: sem `icon:` no `electron-builder.yml`. O único ícone do repo
  é o da bandeja (`electron/assets/tray-icon.png`, 32x32) e o electron-builder
  exige 256x256+; até existir um `assets/icon.png` grande, sai o ícone padrão do
  Electron.
- **Assinatura**: sem certificado Windows nem Apple. SmartScreen e Gatekeeper
  vão avisar na primeira abertura.
- A versão do Electron em `electron/package.json` ficou **fixa** (`44.4.3`, sem
  `^`): o electron-builder recusa um intervalo porque precisa baixar o binário
  de uma release exata.

## Regras

- Merge em `main` e deploy de produção exigem aprovação do Luiz.
- Antes de PR/main: `/sincron-deploy preflight`.
- Nenhum segredo no repositório; `.env` só via `/sincron-env`.
