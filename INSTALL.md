# Instalar o Calling para o SEU agente

Este arquivo é para quem **não é da Sincron**: você tem seu próprio agente de
IA (Claude Code, ChatGPT, Hermes, o que for) e quer que ele consiga te ligar
ou te avisar por conta própria — e que sua resposta volte para ele — sem
depender do bridge do Luiz nem de nada da Sincron.

Cada instalação é **isolada**: você sobe seu próprio bridge, na sua própria
máquina/VPS, com seus próprios segredos. Ninguém além de você vê o que
acontece na sua instância.

> **Se você é um agente lendo isto**: seu trabalho é executar a seção
> "Suba seu próprio bridge" sozinho, sem perguntar passo a passo para o
> humano — só pare e pergunte se faltar uma decisão que só ele pode tomar
> (ex.: onde rodar o bridge, se já tem HTTPS). No final, valide com o teste
> da última seção antes de dizer que terminou.

## O que isto faz, em uma frase

Um servidor pequeno (o "bridge") fica de pé, seu agente fala HTTP com ele
para tocar/avisar o humano, e um app de desktop mostra isso na tela do
humano e deixa ele responder — a resposta volta para o agente na mesma
chamada, sem polling, sem fila.

## Suba seu próprio bridge

Em qualquer máquina que fique ligada o tempo todo (a VPS onde seu agente já
mora é o lugar mais simples — é lá que ele vai rodar os comandos abaixo):

```bash
git clone https://github.com/Sincron-IA/calling.git
cd calling
npm install
npm run build:server
```

Gere dois segredos (um comando por segredo):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Crie um `.env` na raiz (fora do git, nunca commitado):

```bash
CALLING_SHARED_SECRET=<primeiro segredo gerado>
CALLING_RING_TOKEN_<SEU_SLUG>=<segundo segredo gerado>
GEMINI_API_KEY=<opcional — só se você quiser suporte a voz>
PORT=8787
```

(`<SEU_SLUG>` é um nome curto pro seu agente, tipo `MEUAGENTE` — maiúsculo,
sem espaço, é só a chave da variável.)

Suba o bridge:

```bash
node server/dist/index.js
```

Em produção, rode isso como serviço (systemd, pm2, o que você já usa para
manter processo de pé) em vez de deixar preso a um terminal. Detalhes de
HTTPS/proxy reverso (só necessários se o app de desktop **não** estiver na
mesma máquina do bridge) estão em `docs/sincron/DEPLOYMENT.md` — os passos
lá valem igual, é só trocar "a VPS do Luiz" por "a sua".

Registre seu agente em `agents.json` (arquivo público, sem segredo nenhum —
só nome, slug e cor):

```json
{ "slug": "meuagente", "name": "Meu Agente", "workspace": "", "color": "#4ade80", "enabled": true }
```

## Dê o token pro seu agente

No ambiente onde seu agente roda (o jeito que ele já carrega variáveis de
ambiente hoje — `.env`, `config.sh`, secret manager, o que for):

```bash
CALLING_RING_TOKEN_<SEU_SLUG>=<o mesmo segredo de cima>
CALLING_BRIDGE_URL=http://localhost:8787   # ou a URL do seu bridge
```

## O ciclo que seu agente usa

Isto funciona com **qualquer** agente que consiga fazer uma chamada HTTP —
não depende de nenhuma infraestrutura específica de framework.

**Tocar e esperar decisão** (bloqueia até o humano responder ou o tempo
estourar):

```bash
curl -s -X POST "$CALLING_BRIDGE_URL/api/ring" \
  -H "Authorization: Bearer $CALLING_RING_TOKEN_<SEU_SLUG>" \
  -H "Content-Type: application/json" \
  -d '{"reason": "uma linha curta dizendo por que voce esta ligando"}'
```

Resposta (só chega quando o humano decide):

```json
{ "callId": "...", "outcome": "approved", "resolvedAt": 172..., "reply": "opcional, só se ele escreveu algo" }
```

`outcome` é sempre um de `approved`, `declined`, `answered`, `no_answer`.
`reply` só existe se o humano escreveu um texto ao aprovar/recusar — trate
como uma instrução de verdade quando vier. Se `outcome` for `answered`, o
humano vai responder por voz numa ligação separada que abre depois — essa
parte usa um mecanismo de "acordar sessão viva" que é específico de como o
DG Claw roda (`CALLING_WAKE_AGENTS`, ver `docs/AGENT-BRIDGE.md`); se seu
framework não tem uma sessão persistente equivalente, não tem problema —
o caminho de texto acima (`reply` na mesma chamada) já cobre o caso
principal sem precisar de nada disso.

**Avisar sem esperar resposta** (não bloqueia):

```bash
curl -s -X POST "$CALLING_BRIDGE_URL/api/agents/<seu-slug>/notify" \
  -H "Authorization: Bearer $CALLING_RING_TOKEN_<SEU_SLUG>" \
  -H "Content-Type: application/json" \
  -d '{"text": "um aviso curto, sem esperar nada de volta"}'
```

(mesma credencial do toque — o `:slug` na URL precisa bater com o dono do
token, senão a rota recusa)

## O lado do humano

O humano baixa/builda o app de desktop (Electron, empacotamento documentado
em `AGENTS.md`) e configura, na própria tela de ajuste do app, a URL do
bridge e o `CALLING_SHARED_SECRET` — sem editar arquivo nenhum. É a mesma
tela que já existe hoje, só apontando pro bridge de vocês em vez do da
Sincron.

## Teste que isto funcionou

```bash
curl -s -X POST "$CALLING_BRIDGE_URL/api/ring" \
  -H "Authorization: Bearer $CALLING_RING_TOKEN_<SEU_SLUG>" \
  -H "Content-Type: application/json" \
  -d '{"reason": "teste de instalacao"}'
```

Deve aparecer um cartão de toque no app de desktop. Aprove (ou recuse com um
texto) e confirme que o `curl` recebeu a resposta — inclusive o `reply`, se
você escreveu algo.

## Segurança

Isto é uma ferramenta **pessoal**, não um produto multiusuário: um bridge
por pessoa, um segredo por pessoa. Não exponha o bridge na internet aberta
sem um proxy com autenticação na frente — ver `docs/sincron/SECURITY.md`
(os princípios valem, mesmo escrito pensando na instalação da Sincron).
