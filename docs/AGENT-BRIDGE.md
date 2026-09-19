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
