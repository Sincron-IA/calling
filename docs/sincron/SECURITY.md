# Segurança

## Perfil

- Classificação dos dados: interno
- Dados pessoais: conversa do Luiz e do Matheus com os próprios agentes
- Dados sensíveis: sim por natureza (memória e assuntos de trabalho), mas **nada
  é persistido** por este projeto
- Perfis/RBAC: não há — ferramenta pessoal de duas pessoas
- RLS: não se aplica (sem banco)
- Audit logs: não

## Regras Obrigatórias

- `GEMINI_API_KEY` vive **somente** no bridge. Nunca em `VITE_*`, nunca no
  browser, nunca no repositório.
- O browser recebe um **token efêmero** (`uses: 1`, validade curta,
  `liveConnectConstraints` travando modelo e config).
- Nunca commitar `.env`. Usar `/sincron-env`. `.sinc-env/` está no `.gitignore`.
- O `slug` do agente que chega numa tool call é validado contra a allowlist de
  `agents.json`. Ele **nunca** é usado para montar caminho de arquivo. Testado:
  `"../../etc"` responde 400.
- A mensagem do usuário vai ao `claude` por **stdin**, nunca por `argv` — assim
  texto começando com `-` não vira flag.
- Logs registram só evento e duração. Nunca transcrição, resposta de agente,
  token ou chave.
- CORS explícito por `CALLING_ALLOWED_ORIGINS`.

## O risco que você precisa conhecer

`VITE_CALLING_SHARED_SECRET` é embutido no bundle do app. **Qualquer pessoa que
abra o app consegue lê-lo.** Ele não é uma senha forte de verdade: é um portão
simples, adequado porque o app é pessoal.

Consequência prática: quem tiver o segredo e alcançar o bridge pela rede
consegue mandar mensagens aos agentes — que rodam com `bypassPermissions` na
VPS. Por isso:

- **Não** exponha o bridge aberto na internet. Coloque atrás de proxy reverso
  com HTTPS e, de preferência, restrição por IP, VPN ou Cloudflare Access.
- Se o app for publicado numa URL pública da Vercel, trate o segredo como
  "quase público" e proteja o bridge por rede, não só pelo segredo.
- Trocou de ideia sobre quem pode usar? Gere um segredo novo nos dois lados.

## Áreas Críticas

- login: não há
- permissões: segredo compartilhado, único nível
- dados pessoais: conversa em trânsito; nada gravado em disco por este projeto
- integrações: Google Gemini Live (áudio) — a conversa transita pela Google
- webhooks: não há
- IA/LLM: a Gemini é instruída a nunca responder sozinha; o agente roda com
  `bypassPermissions`, então quem alcança o bridge alcança um shell na VPS pela
  via do agente. É o motivo de o bridge precisar ficar em rede restrita.
