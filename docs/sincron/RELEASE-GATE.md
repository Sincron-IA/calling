# Release gate — feat/calling-v1 → main

Data: 2026-09-21
Aprovacao humana para merge em `main`: **Luiz**, explicita nesta sessao.

## Escopo

40 commits, 98 arquivos, +24.144 linhas. A `main` nao tem nenhum commit que a
branch ja nao tenha, entao o merge e um avanco direto.

O conteudo: a migracao da interface inteira para componentes prontos do
shadcn/ui (o `styles.css` de 2.134 linhas deixou de existir), o registro shadcn
publicavel, a busca automatica do avatar de cada agente pelo bot do Telegram
(Automa), e a rodada de correcoes de uso — hover, ancoragem da janela, chave
escondida, "sempre no topo".

## Checks

| Check | Bloqueante | Resultado |
| --- | --- | --- |
| `npm run typecheck` (web + server) | sim | passou |
| `npm run build` (web) | sim | passou |
| `npm run build:server` | sim | passou |
| `lint` | — | nao existe no projeto |
| `test` | — | **nao existe no projeto** |

## Seguranca

Varredura de literais de segredo no diff completo: **um achado, corrigido**.
O valor de mentira da bancada de conferencia comecava com `sk_live_` — nao era
segredo, mas acende scanner e parece credencial. Trocado antes do merge.

Regras obrigatorias do `AGENTS.md`:

- `.env` nao rastreado (so o `.env.example`). **ok**
- Nenhum `.pem`, `.key`, `.p12` ou credencial rastreada. **ok**
- `GEMINI_API_KEY` nao aparece em `web/`. **ok**
- `slug` de agente validado contra a allowlist (`server/src/agents.ts`,
  `auth.ts`, `identity-file.ts`). **ok**
- Token do Telegram nunca vai para log no `telegram-avatar.ts` (so o motivo da
  falha). **ok**

## O que NAO foi validado — leia antes de confiar no gate

1. **Nao ha teste automatizado nenhum no projeto.** Nem unitario, nem e2e. Tudo
   o que se sabe sobre esta release veio de `typecheck`, `build` e conferencia
   manual. Um gate verde aqui diz que compila, nao que funciona.
2. **A conexao com o bridge falhou na ultima tentativa** e a causa nunca foi
   isolada. A tela agora nomeia o motivo (`explainStatus` em `web/src/bridge.ts`)
   em vez de repetir uma frase generica, mas a falha em si continua em aberto.
3. **`VITE_CALLING_SHARED_SECRET` entra no bundle do browser.** E anterior a
   este trabalho e esta documentado em `web/src/config.ts` (o caminho de
   navegador le o `.env`; o de desktop usa o cofre do sistema). Fica registrado
   porque a regra do `AGENTS.md` sobre `VITE_*` pede que alguem tenha decidido
   isso de proposito.
4. **Deploy de producao nao faz parte deste gate.** O merge em `main` dispara a
   Vercel; o bridge na VPS e outro caminho e nao foi tocado aqui alem do que a
   Automa ja subiu.
