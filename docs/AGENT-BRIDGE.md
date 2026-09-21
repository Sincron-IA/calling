# O bridge de agentes

Este e o documento mais importante do projeto. Ele explica a unica parte que
nao veio pronta de lugar nenhum — e, principalmente, **o que ela e e o que ela
nao e**.

## O problema

O Luiz queria: "sempre que eu precisar falar com voce, esse app abre e
conversamos com o MESMO contexto e capacidades de sempre".

Ou seja: quando ele liga para a Automa, quem responde tem que ser a **Automa de
verdade** — com a personalidade dela, a memoria dela e as ferramentas dela.
Nao pode ser a Gemini imitando a Automa a partir de um prompt generico.

## A arquitetura

```text
  Luiz fala
      |
      v
+---------------------------+
|  Browser (web/)           |
|  orb-ui + Gemini Live     |   <- microfone, transcricao, turnos, fala
+---------------------------+
      |  tool call: ask_agent(agent, message)
      v
+---------------------------+
|  Bridge (server/)         |   <- roda NA VPS
+---------------------------+
      |  claude -p (headless), cwd = /home/dgclaw-<agente>
      v
+---------------------------+
|  Agente DG Claw real      |   <- AGENT.md, CLAUDE.md, MEMORY.md,
|  (Automa, Ivo, Theo...)   |      working-memory.md, Bash, ferramentas
+---------------------------+
      |  texto da resposta
      v
   Gemini fala em voz alta
```

**A Gemini Live nao e o cerebro.** Ela e ouvido e boca. O system prompt da
sessao (em `server/src/gemini.ts`) diz isso com todas as letras: ela e a camada
de voz, nao sabe nada sobre o dono, e para QUALQUER coisa que ele disser ela tem
que chamar `ask_agent` e depois falar o que voltou, praticamente palavra por
palavra.

O cerebro e o agente DG Claw, invocado pelo bridge.

## Como o bridge chama o agente de verdade

`server/src/claude.ts` executa o proprio Claude Code em modo nao-interativo:

```bash
claude -p \
  --output-format json \
  --model sonnet \
  --permission-mode bypassPermissions \
  --append-system-prompt-file <identidade-de-voz-do-agente> \
  --session-id <uuid>        # nos turnos seguintes: --resume <uuid>
# a pergunta vai por stdin, com cwd = /home/dgclaw-<agente>
```

Tres detalhes fazem isso funcionar:

1. **`cwd` = o workspace do agente.** O Claude Code descobre o `CLAUDE.md`
   daquele diretorio sozinho. E assim que o agente reencontra as regras de
   memoria dele e o caminho dos arquivos (`MEMORY.md`, `working-memory.md`).

2. **`--append-system-prompt-file` com a identidade.** O launcher do DG Claw
   (`bootstrap-identity.sh`) monta a identidade como `AGENT.md` + a "Regra Zero
   do Telegram". O bridge monta `AGENT.md` + uma **Regra Zero do canal de voz**
   (`server/src/identity.ts`). Essa troca e obrigatoria: numa chamada headless
   nao existe a tool de reply do Telegram, e sem o override o agente tenta
   chama-la e a resposta sai errada. A regra de voz tambem pede resposta curta,
   falada, sem markdown.

3. **`--session-id` / `--resume`.** O primeiro turno da ligacao cria a sessao;
   os seguintes continuam nela. Entao, **dentro de uma mesma ligacao**, o agente
   lembra do que foi dito antes. Ao desligar, a sessao e descartada.

A mensagem do usuario vai por **stdin**, nunca por `argv` — assim uma frase que
comece com `-` nunca vira uma flag.

## O que isto E e o que NAO E (leia antes de prometer qualquer coisa)

### E

- O agente **de verdade**: mesma identidade (`AGENT.md`, com as leis e a
  personalidade), mesmo `CLAUDE.md`, mesmo diretorio de trabalho.
- **Mesma memoria em arquivo.** Ele le e escreve `working-memory.md` e
  `MEMORY.md` — os mesmos arquivos que a sessao do Telegram usa. Essa e a
  camada que de fato liga os dois mundos.
- **Mesmas capacidades.** Bash, leitura e escrita de arquivo, e o que mais
  estiver no workspace dele.
- **Memoria dentro da ligacao**, via `--resume`.

### NAO E

- **Nao e a mesma sessao viva que atende o Telegram.** Aquela e um processo
  `claude` interativo de longa duracao. Esta e uma sessao headless separada,
  criada para a ligacao.
- Portanto, **o que foi dito no Telegram hoje de manha nao esta no "contexto de
  conversa" da ligacao** — a nao ser que o agente tenha registrado nos arquivos
  de memoria. Na pratica isso funciona bem, porque a disciplina de memoria do
  DG Claw ja manda registrar; mas e importante nao vender como se fosse a mesma
  conversa continuando.
- **A ligacao tambem nao aparece no Telegram.** Sao dois canais; o que
  atravessa e o que o agente escreve na memoria.

### Por que nao ligamos na sessao viva

Existe um mecanismo de mensagem entre sessoes vivas do Claude Code (sockets em
`/tmp/cc-socks/*.sock`, usado pelas tools `SendMessage`/`ListAgents`). **Nao
usamos de proposito.** O protocolo e interno e nao documentado, e e feito para
sessao-viva-falando-com-sessao-viva, nao para um programa externo. Tentar falar
esse protocolo seria fragil e poderia corromper a sessao de um agente que esta
no ar atendendo o dono. Ver `docs/sincron/DECISIONS.md`.

## O método de trabalho numa ligação: "verificar" não é instantâneo

Isto é uma limitação real do Calling, não um detalhe de implementação — leia
antes de prometer ao seu usuário que o agente pode "checar" qualquer coisa
enquanto está ao telefone.

Uma ligação de voz roda numa sessão headless com pressão por resposta curta e
imediata (ver Regra Zero do canal de voz, `identity.ts`). Isso funciona bem
para perguntas que o agente já sabe responder. Não funciona para um pedido de
**verificação/investigação de verdade** — ler log, checar código, testar um
serviço, comparar coisas em arquivos diferentes — porque isso leva vários
passos e não cabe no ritmo de uma conversa falada.

Sem uma regra explícita para esse segundo caso, o caminho de menor resistência
de um LLM sob pressão de responder rápido é **inventar uma resposta plausível**
em vez de admitir que precisa de tempo. Foi exatamente o que aconteceu em
21/09/2026 (ver `docs/sincron/DECISIONS.md`, mesma data): perguntado por que
não conseguia mandar Telegram durante a ligação, o agente inventou uma história
de "o plugin caiu" em vez de dizer a verdade simples (a ligação nunca tem essa
ferramenta, por desenho).

**A regra que corrige isso** (já embutida na Regra Zero do canal de voz, vale
para os 6 agentes porque o texto é compartilhado): quando o pedido exigir
investigação de múltiplos passos, o agente encerra a resposta falada com algo
como *"vou finalizar a ligação pra verificar direito e te ligo de novo"* — e
só depois disso investiga, com todo o tempo e ferramentas que precisar,
voltando com o resultado real por `/api/ring` ou pelo canal próprio do agente
(Telegram, no caso do DG Claw). Uma frase honesta reconhecendo que precisa de
tempo é sempre melhor que uma resposta curta e errada.

Se você está integrando outro agente com o Calling: implemente o equivalente
dessa regra no system prompt de canal de voz dele. Não existe forma de o
bridge impor isso de fora — é o texto do prompt que decide, não o transporte.

## Custo e latencia (medidos nesta VPS)

- **Latencia:** ~6 s entre a pergunta e o inicio da fala da resposta, em turnos
  simples com `--model sonnet`. Turnos em que o agente le varios arquivos ou
  roda comandos demoram mais.
- **Custo por turno:** cada turno e uma chamada com o workspace inteiro em
  contexto, na casa de **US$ 0,07 a 0,12** com `sonnet` (medido em testes
  reais). Isso e **por turno de fala**, e soma alem do custo da Gemini Live
  (~US$ 0,02–0,04/min). Uma ligacao de dez turnos custa cerca de um dolar.
  Vale saber antes de deixar o app aberto conversando a toa.

Os dois numeros pioram com `--model opus` e melhoram com `haiku`
(`CALLING_AGENT_MODEL`).

## Ideias para depois

- Encurtar o silencio de ~6 s: deixar a Gemini dizer algo curto ("só um
  segundo") enquanto o `ask_agent` roda.
- Fazer o agente resumir a ligacao no `working-memory.md` ao desligar, para a
  conversa falada alimentar a memoria de verdade.
- Streaming: hoje a resposta so e falada quando o agente termina de escrever.


## O recado escrito (`/api/message`)

Além da ligação, o Calling manda **recado escrito**. Não é `/api/ask`: aquela
rota é a tool do caminho de voz e amarra a sessão ao `callId` da ligação.

A diferença que importa é o **tempo de vida da sessão**:

| Canal | Escopo da sessão | Morre quando |
|---|---|---|
| Voz | o `callId` da ligação | `POST /api/end-call` |
| Texto | o **agente** | 24 h parado |

Texto não tem "chamada". Se a sessão morresse a cada mensagem, cada frase
começaria do zero e o dono teria que recontar o contexto toda vez. E voz e
texto do mesmo agente **compartilham** a sessão de texto — dá para ligar
continuando um assunto escrito dez minutos antes.

A identidade também muda: `buildTextIdentity` troca a Regra Zero do canal de
voz por uma do canal de texto (resposta curta, sem markdown pesado — o balão na
tela é pequeno e não rola). A trava contra a tool de reply do Telegram continua
nas duas.

## A cara do agente mora com o agente

Nome de exibição, cor e imagem de cada agente ficam em
`<workspace>/calling-identity.json`, **não** no `agents.json`:

```json
{ "name": "Ivo", "color": "#60a5fa", "avatar": "calling-avatar.png" }
```

É essa escolha que faz as duas direções funcionarem com uma peça só:

- **o agente muda a si mesmo** escrevendo nesse arquivo — ele já tem permissão
  ali, então não precisa de rota, de token nem de API;
- **o app muda** por `PUT /api/agents/:slug/identity`, que escreve no MESMO
  arquivo.

O `agents.json` continua sendo o **registro** (slug, workspace, enabled) e o
`slug` continua sendo a chave estável: trocar o nome de exibição não quebra
ligação, toque nem sessão de texto em curso.

Quando o arquivo muda na VPS, o bridge percebe (uma leitura a cada 3 s, só
enquanto houver alguém olhando) e empurra um evento `agents` pelo mesmo fluxo
SSE das chamadas recebidas. A barra se atualiza sozinha.

A imagem é servida por `GET /api/agents/:slug/avatar`, com `content-type` de
uma lista fechada e `nosniff`. O que sobe pelo app é conferido pelos **bytes**
(assinatura do arquivo, nunca a extensão nem o `content-type` declarado), tem
teto de 512 kB, e — no caso de PNG — é reescrito só com os pedaços essenciais,
descartando todo metadado. SVG não entra: é documento que executa, não figura.

## O eco na thread do Telegram

O recado escrito também aparece na thread do agente, citado em blockquote:

```
📞 Pedido pelo Calling
<blockquote>dá uma olhada no deploy de ontem</blockquote>
Tô cuidando disso.
```

**Quem manda é o bridge, não o agente.** Dentro da sessão headless a tool de
reply do Telegram não existe — as Regras Zero de canal em `identity.ts` dizem
isso com todas as letras, e elas nasceram justamente porque o agente tentava
chamá-la e a resposta saía errada. Então o eco sai de `server/src/telegram.ts`,
direto na Bot API, **antes** de o agente terminar de pensar.

Só recado de texto ecoa. Turno de voz não: encheria a thread.

Credenciais no `.env` privado da VPS (`CALLING_TELEGRAM_TOKEN_<SLUG>` ou
`CALLING_TELEGRAM_BOT_TOKEN`, mais `CALLING_TELEGRAM_CHAT_<SLUG>`). Agente sem
credencial não ecoa e o recado dele segue normalmente — dá para ligar um agente
de cada vez. Telegram lento ou fora do ar nunca atrasa a resposta ao dono.

> **Pendência:** de qual bot e de qual chat cada agente fala ainda não foi
> levantado na VPS. Enquanto as variáveis não existirem, o eco fica desligado
> em silêncio (com uma linha `telegram_skipped` no log).

## Checklist de onboarding de um agente novo no Calling

Ligar um agente novo (ou conferir se um já ligado está completo) mexe em
**dois lugares diferentes** — o `.env` do bridge (na VPS, um arquivo só,
compartilhado) e o ambiente do próprio agente (`<workspace>/.dgclaw/config.sh`
ou equivalente, um por agente). Confundir os dois foi a causa de um furo real
em 21/09/2026: o Flow (e os outros 4) apareciam prontos porque tudo que o
**bridge** precisa já existia, mas nenhum agente tinha o próprio token para
**ligar por iniciativa própria** — só dava para ser chamado, não para chamar.

| # | O quê | Onde mora | Direção que habilita |
|---|---|---|---|
| 1 | `agents.json`: entrada com `slug`, `name`, `workspace`, `color`, `enabled: true` | Repo (público) | app mostra o agente na lista |
| 2 | `CALLING_RING_TOKEN_<SLUG>` | `.env` do bridge | dono → identifica quem liga (validação) |
| 2b | **o mesmo valor**, copiado | ambiente do PRÓPRIO agente (ex. `config.sh`) | agente → liga pro dono (`POST /api/ring`) |
| 2c | `CALLING_BRIDGE_URL` (`http://127.0.0.1:8787`, o bridge só escuta local) | ambiente do PRÓPRIO agente | agente → sabe pra onde mandar o `POST /api/ring` |
| 3 | `CALLING_TELEGRAM_TOKEN_<SLUG>` + `CALLING_TELEGRAM_CHAT_<SLUG>` | `.env` do bridge | eco do recado escrito na thread do Telegram |
| 4 | `<workspace>/calling-identity.json` | workspace do agente | nome/cor/avatar na UI (o próprio agente escreve) |
| 5 | slug na lista `CALLING_WAKE_AGENTS` | `.env` do bridge | dono liga/manda recado → a sessão viva do agente acorda (Fase 1, `wake.ts`) |

Os itens 1, 2, 3 e 5 são **só o bridge** — um humano ou agente com acesso ao
`.env` da VPS resolve todos de uma vez, e dá pra conferir no log de boot:

```
[calling] agentes: automa, ivo, ...
[calling] podem tocar (credencial propria): automa, ivo, ...
[calling] acordam a sessao viva (+ log de conteudo): automa, ivo, ...
```

O item 2b é o único que **não** dá pra resolver de um lugar só: o valor sai do
`.env` do bridge, mas o destino é o ambiente de cada agente — alguém com
acesso aos dois lados precisa copiar. Sem o 2b, tudo que envolve "o dono fala
com o agente" funciona (voz, texto, eco, wake); só "o agente liga pro dono"
fica quebrado, e do jeito mais confuso possível: sem erro nenhum até o agente
de fato tentar.

**Teste rápido pra saber se falta o 2b:** de dentro da sessão do agente,
`echo $CALLING_RING_TOKEN_<SLUG>` (maiúsculo) tem que devolver o mesmo valor
que está no `.env` do bridge para aquele slug. Vazio = falta distribuir.
