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

## 2026-09-20 - O "código expirado" do Access era do lado do app (três causas)

- Contexto: com o login do Cloudflare Access acontecendo dentro do app, o Luiz
  pedia o código, ia buscar no email, voltava, digitava — e o Access respondia
  que o código tinha expirado. Repetia em loop: pede outro, chega, não vale
  mais.
- Decisão: fechar os três caminhos do lado do app que podiam invalidar a
  tentativa de login em andamento (commit `e68509d`):
  1. `LOGIN_TIMEOUT_MS` de 3 min para 15 min em `electron/login-window.js`. Três
     minutos é tempo de rede, não de gente; quando a janela morria no meio, a
     tentativa seguinte recomeçava o login do zero em `${bridge}/health`, o que
     abre uma NOVA tentativa no Access e mata o código já enviado.
  2. Uma janela de login por vez: o módulo guarda o login em andamento
     (`current = { win, promise }`) e a segunda chamada só traz a janela para
     frente e devolve a mesma promise. Duas janelas dividiam o mesmo pote de
     cookies e a segunda atropelava o estado da primeira.
  3. Silêncio no bridge durante o login: `resetIncomingStream()` passou a rodar
     ANTES de abrir a janela (`web/src/DesktopGate.tsx`); antes rodava só
     depois, no sucesso. Com a sessão vencida, cada tentativa do SSE de chamadas
     recebidas cai no endpoint de login do Cloudflare — no mesmo pote de
     cookies. De quebra, `web/src/incoming.ts` passou a tratar um `EventSource`
     em `CLOSED` como inexistente e a soltar a referência no `onerror`, senão o
     fluxo nunca voltava depois de um novo login.
- Alternativas: dar à janela de login uma sessão própria (`partition:`) para
  isolá-la do resto — rejeitada: a janela usa `session.defaultSession` de
  propósito, porque é justamente esse cookie que o app precisa ter depois para
  falar com o bridge. Isolar resolveria a briga e quebraria o objetivo.
- Impacto — a limitação honesta: o OTP é emitido e validado 100% pelo
  Cloudflare. Do lado do app não dá para observar por que o Access considerou um
  código inválido, então **não existe teste que PROVE a causa raiz**. O que foi
  feito é fechar os três pontos de código identificados como plausíveis; a
  confirmação só vem de um login de verdade.
- Revisar em: no próximo login real do Luiz. Se o "código expirado" voltar, a
  causa está fora destes três pontos (provavelmente na configuração do Access) —
  não repetir o mesmo ajuste.

## 2026-09-20 - Sem menu nativo (menos no macOS), bandeja de verdade e config em painel

- Contexto: o app de desktop mostrava o menu nativo do Electron (File/Edit/View)
  e uma tela de configuração do tamanho da janela inteira. O dono do produto
  reclamou do menu — feio — e pediu um app "minimizado por padrão", que só abre
  a configuração quando precisa. O desenho saiu de um mockup visual (Artifact)
  com três opções; ele aprovou uma fusão de duas delas antes de qualquer código.
- Decisão (commit `2a1a6f9`): `Menu.setApplicationMenu(null)` + `autoHideMenuBar`
  na janela; `Tray` de verdade (mostrar/esconder, "Configuração…", "Sair") com o
  X da janela guardando o app na bandeja; e a engrenagem abrindo um painel sem
  moldura (`frame: false`) que carrega o MESMO app web com `#config` — sem
  segunda tela de HTML para manter.
- Exceção deliberada, o macOS: `Menu.setApplicationMenu(null)` só roda
  `if (process.platform !== 'darwin')`. No macOS esse menu não fica na janela,
  ele É a barra do sistema, e tirá-la levaria junto Cmd+C/Cmd+V — e colar a
  chave no painel de configuração é exatamente o que o usuário faz ali. Lá o
  menu de sempre fica.
- Posicionamento adaptativo (`electron/config-panel.js`, `placePanel`): o painel
  abre para baixo da âncora, e para cima quando não couber. Não é preciosismo —
  no Windows a barra de tarefas fica embaixo por padrão, então o ícone da
  bandeja nasce no canto inferior direito e um painel que sempre descesse
  nasceria fora da tela. Sem âncora conhecida (bandeja sem `bounds` no Linux),
  cai para o canto de baixo à direita.
- Alternativas: (a) manter a tela cheia de configuração — é o que o dono
  rejeitou; (b) escrever um HTML próprio para o painel — rejeitada, duplicaria
  cores, fontes e formulário; (c) esconder o menu em todas as plataformas —
  rejeitada pelo motivo do macOS acima. Sem bandeja no sistema, o app volta a
  encerrar no X como antes.
- Impacto: o ícone da bandeja é provisório (as três barrinhas da própria barra,
  em verde) e vale desenhar um definitivo. Os handlers de IPC não mudaram
  (`get-config`, `save-config`, `clear-config`, `open-login`); salvar pelo painel
  recarrega a janela da barra.
- Revisar em: quando houver um ícone de bandeja definitivo, ou no primeiro teste
  em Windows/macOS de verdade — o posicionamento foi conferido só em Linux.

## 2026-09-20 - A janela principal é do tamanho do conteúdo, sem moldura

- Contexto: o dono abriu o app e mandou o print — barra de título do sistema
  ("Calling" + minimizar/maximizar/fechar) e um retângulo preto de 480x760 atrás
  de um cartão de configuração bem menor. Nada disso era intencional: os 480x760
  eram o tamanho fixo com que a janela nascia desde o scaffold. O Calling é um
  widget de canto, do tamanho do que tem para mostrar.
- Decisão (commit `c4f4714`): a janela principal nasce com `frame: false`, igual
  ao painel da engrenagem que já estava aprovado, e passa a vestir o conteúdo —
  o renderer mede o `#root` com um `ResizeObserver` e manda o tamanho pelo
  `calling:resize-main`; o processo principal redimensiona. O mesmo caminho
  serve a tela de conexão (356x305), a barra conectada (96x58) e o chip no hover
  (134x58), e encolhe de volta. A janela só aparece depois que a página diz o
  tamanho (com 1,5 s de rede de segurança), senão o primeiro quadro seria o
  retângulo preto de novo, só que menor.
- Âncora, não posição: guardamos o ponto inferior direito da janela, não o
  retângulo. Ao mudar de tamanho ela cresce para cima e para a esquerda e
  continua colada no canto, em vez de escorregar para fora da tela. Se o usuário
  arrastar, o evento `move` atualiza a âncora — um retângulo que nós mesmos
  aplicamos não conta como arrasto.
- Alternativas: (a) manter a moldura e só encolher a janela — não resolve o
  fundo sobrando nem combina com o painel sem moldura; (b) desenhar uma barra de
  título própria — rejeitada, é um widget, não um app com janela; o que se perde
  (arrastar) volta como uma faixa de 8px com `-webkit-app-region: drag` em volta
  do conteúdo, mais o cabeçalho do cartão de conexão.
- Impacto: o CSS precisou de uma classe `desktop-main` no `body` só desta
  janela, desligando `min-height: 100vh`, a tela de conexão em `position: fixed;
  inset: 0` e a barra ancorada na viewport — `100vh` é coisa de navegador. Duas
  regras ali existem para evitar laço de realimentação (largura do cartão fixa e
  a lista de chamadas sem `60vh`): se o conteúdo dependesse do tamanho da janela
  e a janela do conteúdo, os dois encolheriam um ao outro. Pelo mesmo motivo o
  `body` ganhou `overflow: hidden`. No navegador comum nada muda.
- Impacto — a limitação honesta: conferido no Xvfb com o app de verdade
  (tamanhos, `bounds` == `contentBounds`, hover, âncora após mover por código),
  mas **arrastar com o mouse e o `-webkit-app-region` em si não deu para
  testar** — esta VPS não tem gerenciador de janelas. O aro claro em volta da
  janela nos screenshots é artefato do Xvfb sem compositor, não borda do app.
- Revisar em: no primeiro uso com mouse de verdade, para confirmar o arrasto.
