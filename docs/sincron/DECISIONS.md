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

## 2026-09-20 - `frame: false` não deixa a janela transparente — e um teste com fundo preto escondeu isso

- Contexto: depois de tirar a moldura e vestir a janela no conteúdo (commit
  `c4f4714`), o dono abriu de novo e viu o que a correção deveria ter resolvido:
  um retângulo preto sólido em volta da barra flutuante e do cartão de
  configuração, com uma espécie de borda/glow claro por fora. "Fundo horroroso",
  nas palavras dele.
- Causa: `frame: false` tira só a moldura do sistema operacional; a janela
  continua um retângulo OPACO, preenchido com o `backgroundColor` configurado
  (`#0b0d10` no `main.js`, `#14181d` no `config-panel.js`). Como o cartão e a
  barra têm canto arredondado, sobrava fundo escuro nos cantos e nas bordas. O
  "glow" claro não era borda do app: é a sombra que o próprio SO desenha em
  volta de janela sem moldura.
- Decisão (commit `47f4e3a`): as duas janelas sem moldura nascem
  `transparent: true`, com `backgroundColor: '#00000000'` e `hasShadow: false`.
  Do lado da página, `main.tsx` marca `<html>`/`<body>` com `desktop-window` e
  `desktop-panel`, e o `styles.css` zera o fundo de `html`, `body` e `#root` só
  nessas janelas — os três precisam estar lá, porque basta UM deles pintar para
  o retângulo voltar inteiro. Nenhuma cor de cartão, barra ou painel foi tocada.
- A lição de verdade, sobre o teste que escondeu o bug: o `c4f4714` tinha sido
  "validado" em Xvfb com fundo de tela PRETO. Um retângulo opaco escuro é
  invisível contra fundo preto — o teste passou justamente porque não podia
  falhar. Desta vez o harness sobe o `electron/main.js` de verdade (não
  mockado), num Xvfb com compositor (`xcompmgr`), sobre um papel de parede
  XADREZ magenta/ciano, de propósito. Rodou antes/depois (revertendo os quatro
  arquivos para o HEAD anterior para gerar o "antes") em três estados: tela de
  conexão, barra conectada (repouso e hover) e painel da engrenagem aberto. No
  "antes" o retângulo preto aparece nítido nos três; no "depois" some.
  `npm run typecheck`, `npm run build` e `npm run build:server` passam. Regra
  que fica: teste de aparência com fundo escuro não prova nada sobre fundo.
- Alternativas: (a) arredondar/recortar a janela pelo SO — não existe API
  portátil no Electron para isso; (b) manter `hasShadow: true` para preservar a
  profundidade — rejeitada, a sombra do SO é desenhada no RETÂNGULO da janela e
  era exatamente a borda clara reclamada; (c) pintar um fundo escuro na página
  com cantos arredondados — mesmo problema, o retângulo continua onde o
  arredondamento não cobre.
- Impacto — as limitações honestas: (1) só foi validado em Linux/X11
  (Xvfb + `xcompmgr`); **não foi testado em Windows nem macOS**, que é onde o
  dono usa de verdade. Lá o compositor é sempre ativo, então a expectativa é que
  funcione, mas não há prova. (2) Efeito colateral aceito de propósito: o chip
  da barra usa `--surface-soft`/`--surface-hover`, que são `rgba(...)`
  semi-transparentes — agora eles compõem com o papel de parede real em vez do
  fundo opaco da janela, então em tela de fundo claro o chip fica cinza-médio em
  vez de quase preto. Continua legível, e é o efeito "vidro" que o CSS já
  sugeria com `backdrop-filter`. (3) O painel da engrenagem perdeu toda a sombra
  própria: a do SO some junto com `hasShadow: false` e não dá para compensar no
  CSS, porque a janela do painel tem exatamente o tamanho do cartão — a sombra
  seria cortada.
- Revisar em: no primeiro teste em Windows ou macOS de verdade. Se o retângulo
  ou a sombra voltarem lá, o problema é de plataforma, não deste commit.

## 2026-09-20 - O botão do Cloudflare responde ao clique e a engrenagem só aparece no hover

- Contexto: duas queixas de uso do mesmo pedido do dono. (1) O botão "Conectar
  ao Cloudflare" não dava sinal nenhum de ter ouvido o clique: o estado ocupado
  existia, mas dependia inteiro do pai — só acendia quando o `phase` virava
  `login` e usava a opacidade de campo desligado (45%), o que de longe parece
  botão morto. Dava para clicar duas vezes e abrir dois logins. (2) A engrenagem
  de configuração ficava sempre visível ao lado da barra flutuante, poluindo um
  widget que deveria ser quieto em repouso.
- Decisão (commit `ab2e61b`), em três partes:
  1. Estado ocupado próprio do botão (`web/src/ConnectScreen.tsx` +
     `web/src/styles.css`): um `submitting` LOCAL acende já no `submit`
     ("Abrindo…"), o pai completa com "Esperando o login…", e o ocupado ganha
     estilo dele (`aria-busy`, 78% de opacidade, cursor de espera) para o
     spinner aparecer de verdade. Enquanto isso o botão fica desabilitado —
     fim do duplo clique. Cancelar, dar erro ou nem abrir devolve o botão ao
     normal sozinho. O estado local existe justamente para que ele nunca apareça
     ocioso no intervalo entre o clique e o pai reagir.
  2. Engrenagem some no repouso (`web/src/DesktopGate.tsx` + `styles.css`):
     barra e engrenagem passam a morar no mesmo bloco (`.shell`), e é nele que o
     `:hover` mora; em repouso a engrenagem fica invisível e chega com um fade
     curto. O teclado continua alcançando, por `:focus-within` e pelo
     `:focus-visible` dela. O LUGAR dela fica reservado de propósito: a janela
     tem o tamanho do conteúdo, e uma engrenagem entrando e saindo do layout
     faria a janela inteira pular a cada passada do mouse.
  3. Colada na borda direita, ela desce (`electron/main.js`, `preload.js`,
     `web/src/desktop.ts`): quem sabe onde a janela está é o processo principal,
     então é ele que mede a distância até a borda direita da área útil e manda
     `calling:main-edge`; abaixo de `MAIN_EDGE_MARGIN` (16px) a página troca para
     o desenho empilhado, com a engrenagem EMBAIXO da barra.
- Medir a âncora, não o retângulo: a conta usa a âncora da barra (o canto onde
  ela é fixada), não o `bounds` atual. Assim ela não depende do tamanho do
  conteúdo, que muda o tempo todo — senão mudar o desenho mudaria a largura, que
  mudaria a conta, e a engrenagem ficaria piscando de um lado para o outro.
- Alternativas: (a) deixar o botão ocupado só sob controle do pai — é o
  comportamento que o dono reclamou, existe uma janela de tempo em que ele
  parece ocioso logo após o clique; (b) tirar a engrenagem do layout quando
  escondida — rejeitada, faria a janela pular a cada hover; (c) medir o
  retângulo atual da janela em vez da âncora — rejeitada pelo laço de
  realimentação acima.
- Impacto — as limitações honestas: (1) o login do Cloudflare em si **não foi
  testado ponta a ponta** — isso pede rede real e um humano digitando o código;
  só o handler do processo principal foi trocado por um dublê de teste, o
  caminho do renderer é o de verdade. (2) O cenário de borda direita foi
  reproduzido movendo a janela POR CÓDIGO, não com um humano arrastando o mouse,
  e num único display Xvfb 1280x800 — **múltiplos monitores não foi testado**.
  (3) O limiar de 16px é escolha arbitrária: como a janela tem o tamanho do
  conteúdo e fica sempre dentro da área útil, a engrenagem nunca é de fato
  cortada; "colada na borda" aqui significa só que a âncora está a menos de 16px
  da borda. Quem quiser esse comportamento já na posição de repouso mexe na
  constante `MAIN_EDGE_MARGIN` em `electron/main.js` (o repouso deixa 24px de
  folga, de propósito maior que o limiar). (4) Efeito colateral aceito: no modo
  empilhado o rótulo `.chip__label` (o nome de quem ligou) fica escondido, para
  não ficar por baixo da engrenagem que acabou de se mudar para aquele lugar —
  só nesse modo; no desenho normal continua igual.
- Revisar em: no primeiro login real do Luiz (para o botão ocupado) e no
  primeiro uso com mouse de verdade, de preferência com mais de um monitor
  (para o caso da borda).


## 2026-09-20 - Nesta janela, o que cresce tem que estar no fluxo

- Contexto: clicar no chevron não abria a lista de agentes — aparecia uma faixa
  cinza cortada no canto. `.menu` era `position: absolute`, e quem mede a
  janela é o `getBoundingClientRect()` do `#root` (`DesktopGate.tsx`), que
  **ignora filho posicionado fora da caixa de borda**. A janela não crescia, o
  menu era pintado fora dela e o `overflow: hidden` cortava; o cinza era o
  `box-shadow` vazando nos 8 px de padding.
- Decisão: menu, recado, balão, campo de escrever e painel de aparência são
  **filhos em fluxo** de `.bar`, que já é uma coluna alinhada à direita. A
  janela cresce sozinha e a âncora de canto faz ela subir.
- Alternativas: reportar a união dos retângulos (`#root` + overlays abertos).
  Funciona, mas é uma conta nova a cada overlay novo, e `no-drag` e `:hover`
  teriam de ser mantidos à mão em cada um.
- Impacto: vale para TODO overlay futuro do Calling. Um `position: absolute`
  acima do chip volta a ser o mesmo bug.
- Revisar em: se a janela um dia deixar de ter o tamanho do conteúdo.

## 2026-09-20 - O fundo do chip arrasta a janela

- Contexto: a janela não se deixava arrastar. A única superfície com
  `-webkit-app-region: drag` era o anel de 8 px de padding do `#root`, e todo
  filho direto era `no-drag`. Oito pixels em volta de um chip de 42 px é um
  alvo que o mouse não acerta.
- Decisão: o fundo do chip e as três barrinhas da onda arrastam (elas não fazem
  nada quando clicadas, então são a alça natural). Tudo o que responde a
  clique volta a `no-drag`, um por um.
- Impacto: no Windows, `drag` no pai engole o clique do filho se ninguém o
  devolver — a lista de `no-drag` tem que crescer junto com a UI.
- Revisar em: quando entrar um controle novo dentro do chip.

## 2026-09-20 - A conversa escrita não aparece na tela, e isso é escolha

- Contexto: o Calling ganhou recado escrito. A pergunta era quanto da conversa
  mostrar acima da barra.
- Decisão: **um balão só**, com a última resposta, que some em 15 s (e cujo
  relógio para com o mouse em cima). Sem histórico, sem rolagem. Erro fica até
  alguém fechar, porque erro pede decisão.
- Alternativas: mini-thread rolável com as últimas trocas — rejeitada pelo
  dono: a janela ficaria grande e a barra deixaria de ser quieta.
- Impacto: a conversa completa vive na sessão do agente, não aqui. Nada do que
  foi escrito ou respondido sobrevive ao fechamento do app.
- Revisar em: se o dono pedir para ver o histórico. **Não "consertar" isso por
  conta própria achando que faltou histórico.**

## 2026-09-20 - A sessão de texto é do agente; a de voz, da ligação

- Contexto: `claude.ts` guardava sessões por `callId:slug` e as jogava fora no
  `end-call`. Recado escrito não tem "chamada".
- Decisão: o escopo da sessão passa a ser explícito. Voz usa o `callId` e morre
  no `end-call`; texto usa o **agente** e dura 24 h parado. Voz e texto do mesmo
  agente compartilham a sessão de texto.
- Impacto: dá para ligar continuando um assunto escrito antes. Desligar o
  telefone não apaga a conversa escrita — há guarda explícita em `endCall`.
- Revisar em: se 24 h se mostrar curto ou longo demais no uso real.

## 2026-09-20 - A identidade do agente mora no workspace dele

- Contexto: o dono quis trocar cor, nome e imagem dos agentes pelo app, **e**
  que o agente pudesse mudar a si mesmo, com as duas coisas refletindo nos dois
  lados. A identidade visual estava partida em três pedaços que não
  conversavam: `agents.json` tinha `color`, o bridge o devolvia, `AgentSummary`
  o declarava — e a UI pintava por POSIÇÃO na lista.
- Decisão: nome, cor e imagem passam a morar em
  `<workspace>/calling-identity.json`. O agente já tem permissão de escrita ali,
  então "o agente se reconfigura" não precisa de rota nenhuma — ele edita o
  próprio arquivo. O app edita o MESMO arquivo pelo bridge. `agents.json` fica
  sendo o registro, e o `slug` a chave estável.
- Alternativas: (a) guardar a identidade no `agents.json` — rejeitada, é
  público no GitHub e o agente não o edita; (b) um banco no bridge — rejeitada,
  o agente perderia a capacidade de se mudar sozinho.
- Impacto: a volta (VPS → app) é uma leitura a cada 3 s, só enquanto houver
  alguém olhando, empurrada pelo SSE que já existe. Primeira escrita em disco e
  primeiro upload do projeto: a imagem é conferida pelos bytes, limitada a
  512 kB, e o PNG é reescrito sem metadado.
- Limitação honesta: não há recodificação de pixel (exigiria um codec no
  servidor). O que há é assinatura conferida, PNG reescrito só com os pedaços
  essenciais, teto de tamanho e `content-type` fixo + `nosniff` na volta.
- Revisar em: se um formato além de PNG precisar da mesma limpeza de metadado —
  aí entra um codec (`sharp`) e a decisão muda.

## 2026-09-20 - Quem avisa o Telegram é o bridge, não o agente

- Contexto: o dono perguntou se o pedido feito pelo Calling podia aparecer na
  thread do agente. O caminho óbvio seria o agente avisar.
- Decisão: **o bridge** manda, direto na Bot API, assim que o recado chega —
  antes de o agente terminar de pensar. Dentro da sessão headless a tool de
  reply do Telegram não existe (é o que as Regras Zero de canal em
  `identity.ts` já dizem, e elas nasceram porque o agente tentava chamá-la e
  errava a resposta).
- Alternativas: (a) devolver a tool do Telegram à sessão headless — reabriria
  exatamente o bug que a Regra Zero resolve; (b) entregar na sessão viva pelos
  sockets `/tmp/cc-socks/*.sock` — rejeitada em 2026-09-19 e **não reaberta**
  aqui.
- Impacto: só recado de texto ecoa; turno de voz não, encheria a thread. Agente
  sem credencial não ecoa e a mensagem dele segue normalmente. Telegram fora do
  ar nunca atrasa a resposta ao dono.
- Pendência: de qual bot e de qual chat cada agente fala ainda não foi
  levantado na VPS. Sem isso o eco fica desligado em silêncio.
- Revisar em: quando as credenciais existirem e o eco rodar de verdade.

## 2026-09-20 - "Failed to fetch" vira erro nomeado; o preflight é do Cloudflare

- Contexto: o recado escrito do app de desktop morria com "NÃO CONSEGUI MANDAR /
  Failed to fetch", enquanto a MESMA rota (`POST /api/message`) respondia certo
  por `curl` na VPS. O log do bridge explicou: **nenhum** `POST /api/message` com
  `origin: http://localhost:5173` chegou ao Node — só os `GET /api/agents`. A
  chamada morria antes, no preflight, que o Cloudflare Access responde ele mesmo
  e sem liberar o cabeçalho `content-type` (preflight não leva cookie, então
  sessão do Access não é o que decide isso). Ver `DEPLOYMENT.md`.
- Decisão: (a) o conserto de verdade é a lista de headers do Access, e está
  escrito no `DEPLOYMENT.md` com o `curl` que confere; (b) no app, toda falha de
  rede do `fetch` passa a virar `BridgeUnreachableError`, com texto que diz o que
  fazer ("pode ser a sessão do Cloudflare: abra a engrenagem e conecte de novo")
  em vez do `TypeError` cru.
- Alternativas: mandar o corpo como `text/plain` (cabeçalho *safelisted*, não
  entra no preflight) e afrouxar o parser do bridge — **rejeitada**: mente sobre
  o que o corpo é, para contornar uma configuração que se ajusta num campo.
- Impacto: enquanto o Access não liberar `content-type`, voz e recado escrito
  continuam parados pelo app — mas agora a tela diz isso, o rascunho não se
  perde, e a engrenagem (que é o caminho de reconexão que já existia) está ali.
- Revisar em: quando o Access estiver ajustado — e aí conferir que o log do
  bridge passa a mostrar os `POST` vindos do app.

## 2026-09-20 - O painel da engrenagem não pede conexão de quem já está conectado

- Contexto: o painel reaproveita a `ConnectScreen` da primeira vez. Ela nunca
  olhou o `statusLabel`, então mostrava "CONECTADO" no cabeçalho e, logo abaixo,
  endereço, chave e o botão "Conectar ao Cloudflare" cheio — como se faltasse
  fazer alguma coisa.
- Decisão: prop nova `connected`. Com ela, a tela mostra só a linha "Conectado ao
  Cloudflare…" e um `Conectar de novo` discreto; o formulário volta inteiro em
  `sem chave` (primeira vez) e `reconectar` (sessão vencida ou chave errada). O
  painel só espera pela conferência com o bridge antes de abrir, para não piscar
  o formulário na cara de quem está com tudo funcionando.
- Alternativas: comparar `statusLabel === 'conectado'` dentro do componente —
  rejeitada, amarra o desenho ao texto do selo.
- Impacto: `DesktopGate` (primeira conexão) não passa a prop e não muda em nada.
  O `Conectar de novo` existe de propósito: sem ele, quem chegasse pela mensagem
  de erro do recado encontraria um painel sem saída.
- Revisar em: se o painel ganhar mais estados que "conectado / não conectado".

## 2026-09-20 - A barra veste o visual aprovado no canvas

- Contexto: o comportamento do plan-001 já estava no ar (`be32aca`), mas com o
  visual provisório. O dono aprovou um canvas de design
  (https://claude.ai/artifact/9VB6QEft8qQktnoRYXaGAD) como referência.
- Decisão: Geist + Geist Mono empacotadas via `@fontsource` (a janela do
  desktop não pode depender de rede para desenhar a letra); coluna de 272 px;
  a cor do AGENTE é a única cor forte (enviar, pensando, balão, filete); tudo o
  que some sozinho mostra um filete de tempo, que é animação CSS pausada junto
  com o relógio do JS no hover; o disco na lista vira o botão de aparência, com
  o lápis só no hover — a linha fica com duas ações, escrever e ligar.
- Eco visível: `/api/message` passa a responder `echoed`, e o balão diz
  "na thread" quando o recado chegou no Telegram. O eco continua correndo em
  paralelo com o agente; esperamos por ele só no fim, e ele tem teto próprio.
- Agente que muda a si mesmo vira recado "antes → depois". Gravação feita pelo
  próprio painel não vira recado: o início do salvar é marcado e o SSE dos 4 s
  seguintes é tratado como eco nosso.
- Alternativas: carregar Geist do Google Fonts — rejeitada, o app abre sem rede
  e piscaria a letra; manter o lápis como terceiro botão na linha — rejeitada,
  três ícones iguais por linha competem com as duas ações principais.
- Revisar em: após o smoke do plan-001 no Electron.

## 2026-09-20 - O Calling vira segunda janela: ele ACORDA a sessão viva

- Contexto: um recado pelo Calling morria dentro da chamada de API. Quem
  respondia era uma sessão **headless** (`claude -p`, `server/src/claude.ts`),
  criada só para aquele pedido; a sessão **viva** do agente — a mesma que atende
  o Telegram, com a memória do dia na cabeça e capaz de começar trabalho — nunca
  ficava sabendo. O dono falava com a Automa e a Automa, do outro lado, não
  lembrava de nada. E o caminho de volta não existia: o app só sabia responder,
  o agente não tinha como empurrar nada para dentro dele.
- Decisão: duas direções, pelos mecanismos que **já existem**.
  (a) **Acordar**: depois de responder ao app, o bridge chama `inject_session`
  (de `<workspace>/.dgclaw/plugin/scripts/_lib/inject.sh`, sempre pelo symlink
  `.dgclaw/plugin`) com o prompt por **stdin** — o mesmo mecanismo dos
  agendamentos do DG Claw, que outros scripts internos já reconhecem como "não é
  o dono falando direto". Recado escrito acorda na hora; **voz não acorda por
  turno** (seria barulho no meio da conversa): os turnos se acumulam na sessão
  e viram UM recado no `/api/end-call`.
  (b) **Empurrar**: `POST /api/agents/:slug/notify` (mesmo `requireSecret` do
  `/api/message`) faz `broadcast('agent_message', …)` pelo **mesmo** SSE do
  toque e da identidade. Essa rota nunca acorda ninguém — acordaria quem a
  chamou, e o ciclo não teria fim.
  (c) **Opt-in por agente**, `CALLING_WAKE_AGENTS` no `.env`. Hoje só `automa`;
  os outros cinco continuam com o comportamento exato de antes.
- Sufixo único na tag: o `inject.sh` carimba em todo poke um cabeçalho de
  IDEMPOTÊNCIA ("se você JÁ executou '<tag>' em <hoje>, NÃO repita"). Para um
  cron diário é o certo; para uma CONVERSA seria desastroso — a segunda mensagem
  do dia seria lida como repetição da primeira. Por isso a tag vai como
  `calling-msg-<base36 do instante>`: cada recado é um evento próprio.
- Retentativa em sessão ocupada: o `inject.sh` foi feito para cron — sessão
  ocupada, ele descarta o poke e conta com o próximo disparo do relógio. Aqui
  não há próximo disparo, então **nós** somos o relógio: 3 retentativas de 30 s.
  Esgotadas, vira `wake_gave_up` no log — e o conteúdo já está gravado.
- Log de CONTEÚDO, autorizado explicitamente pelo dono ("não tenho objeção
  nenhuma quanto a gravar o que está sendo falado para análise pós"): uma linha
  NDJSON por troca em `<workspace>/calling-log/<AAAA-MM-DD>.ndjson`, diretório
  0700 e arquivos 0600, no fuso do dono (UTC faria o arquivo virar às 21 h).
  **Separado** de `/var/log/calling-bridge/bridge.log`, que é o log de OPERAÇÃO
  e nunca viu conversa — é a garantia de que ninguém lê o que o dono falou
  procurando um erro de CORS. Misturar os dois destruiria isso de uma vez.
- Alternativas: (a) entregar na sessão viva pelos sockets `/tmp/cc-socks/*.sock`
  — rejeitada em 2026-09-19 e não reaberta; (b) um segundo canal SSE para o
  recado empurrado — rejeitada pela mesma razão de sempre: segundo cookie do
  Access, segunda reconexão, segundo jeito de quebrar; (c) acordar a cada turno
  de voz — rejeitada, encheria a sessão viva no meio da ligação; (d) um booleano
  global em vez de lista — rejeitada, mudaria os outros cinco agentes de uma vez.
- Impacto: tudo é fire-and-forget **depois** de o app já ter a resposta na tela;
  nada disso pode atrasar ou derrubar o que o dono vê. O prompt nunca é
  interpolado no `bash -c` (workspace e tag entram como `$1`/`$2`, o texto por
  stdin) — texto do dono não chega perto de uma linha de comando.
- No app, o recado empurrado cai no **mesmo balão** da resposta do agente: é a
  mesma coisa (o agente dizendo algo) e um balão só evita duas coisas brigando
  pelo espaço acima da barra. Sai sozinho, como toda resposta.
- Revisar em: quando o dono quiser ligar o segundo agente (aí é só a linha do
  `.env`) — e se 3×30 s se mostrar pouco para uma sessão viva muito ocupada.

## 2026-09-20 - A fila de recados, e o fechar que faltava em tudo

- Contexto: o agente passou a empurrar recado pelo `POST /api/agents/:slug/notify`
  (e7ca98e), e ele caia no balao da resposta, que some em 15s. Quem estivesse
  ocupado perdia o recado sem deixar rastro no app.
- Decisao: o balao continua igual (some sozinho), mas o recado tambem entra numa
  FILA. O cabecalho da lista de agentes ganha um sininho com a conta do que nao
  foi lido, e o chip ganha um ponto na cor do agente quando ha recado novo. Abrir
  a fila marca tudo como lido. A fila vive so em memoria, como o resto da
  conversa: registro de verdade e a thread do agente.
- Alternativas: painel de historico com tudo o que foi dito — rejeitada, e o
  oposto da decisao de plan-001 ("um balao so, sem historico"); notificacao do
  sistema operacional — rejeitada por enquanto, o app e uma barra quieta e isso
  seria barulho fora dele.
- Junto disso, quatro coisas que o uso mostrou:
  - o chevron so sabia ABRIR. Fechar encolhe a janela (que tem o tamanho do
    conteudo), e a geometria nova debaixo do cursor faz o Chromium disparar um
    `pointerenter` novo no proprio chevron, que reabria na hora. Agora um
    fechamento deliberado deixa o hover surdo por 600ms;
  - menu, campo de escrever e fila ganharam um `x` discreto. O Esc continua
    valendo, mas ninguem e obrigado a saber disso;
  - a engrenagem voltou a aparecer so no hover: o `:focus-within` do bloco a
    mantinha acesa enquanto o campo de escrever tinha foco;
  - o nome do agente saiu de um rotulo ABSOLUTO colado embaixo do chip e entrou
    EM FLUXO dentro dele. Fora da caixa, ele nascia fora da janela e aparecia
    cortado pela metade — a mesma armadilha que plan-001 ja tinha resolvido para
    o menu.
- Revisar em: se a fila passar a precisar sobreviver ao fechar do app.

## 2026-09-20 - O avatar do agente vem do bot dele, não da mão de ninguém

- Contexto: os seis bots do Telegram já têm foto de perfil posta pelo BotFather
  — a cara de cada agente já existia e já estava certa. Mesmo assim, para ela
  aparecer no Calling alguém tinha que baixar a imagem na mão e subir pelo app,
  ou escrever `calling-identity.json` a unha. Duas verdades para a mesma coisa,
  e a do Calling sempre atrasada em relação à do Telegram.
- Decisão: um **backfill de partida** (`server/src/telegram-avatar.ts`). Quando
  o bridge sobe, todo agente que está SEM imagem ganha a foto de perfil do
  próprio bot, em quatro chamadas à Bot API (`getMe` → `getUserProfilePhotos`
  → `getFile` → download), pegando a MAIOR resolução da foto mais recente.
- Credencial: a que já existe. `tokenFor()` saiu de `telegram.ts` exportada e é
  a mesma função que o eco na thread usa — o token é o
  `CALLING_TELEGRAM_TOKEN_<SLUG>` que já estava no `.env` dos seis. **Nenhum
  segredo novo, nenhuma variável nova.** Duplicar a regra de nome da variável
  num arquivo novo seria criar um segundo lugar para ela ficar errada.
- Só preenche o que falta, nunca substitui: `avatarPath(agent) === ''` é a
  única condição. Imagem posta pelo dono no app — ou pelo próprio agente
  escrevendo no workspace dele — não é tocada por este caminho, nem no primeiro
  boot nem em nenhum depois. Trocar ou apagar uma imagem que já existe continua
  sendo exclusividade do `PUT /api/agents/:slug/identity`, que é a porta com
  gente do outro lado. Por isso também não há rota nova aqui: um endpoint de
  "buscar de novo" seria justamente o jeito de sobrescrever sem querer.
- Nome e cor ficam como estavam. O `writeIdentity` grava os três campos juntos,
  então o backfill passa de volta o `name`/`color` EFETIVOS (`agentIdentity`),
  que já caem no `agents.json`. O backfill preenche a imagem e mais nada.
- Os bytes passam pelo `prepareAvatar`, o mesmo crivo de uma imagem que o dono
  sobe: assinatura conferida, teto de 512 kB, extensão vinda dos bytes e não do
  `file_path`. Download truncado ou página de erro no lugar da figura morre ali
  — "a origem é confiável" não é motivo para pular a validação, porque o que
  falha aqui é a rede, não a intenção do Telegram.
- Alternativas: (a) buscar a cada request de `/api/agents` — rejeitada, seria
  ir ao Telegram por causa de um refresh de tela; (b) uma volta de relógio
  periódica — rejeitada, a foto de um bot muda uma vez por ano e o disco já tem
  a resposta; (c) sobrescrever sempre, deixando o Telegram como fonte única —
  rejeitada, apagaria a escolha de quem subiu uma imagem pelo app; (d) um
  arquivo novo com a lógica de nome da variável copiada — rejeitada, ver acima.
- Impacto: dispara DEPOIS do `app.listen`, sem `await`, as seis juntas em
  `Promise.allSettled`. O bridge já está atendendo request quando isto começa,
  então Telegram lento não adia boot nenhum; cada busca tem `AbortController` de
  8 s, como o eco. Nada lança: falta de token, bot sem foto, rede caída ou
  resposta estranha viram uma linha `avatar_fetch_failed` (agente + motivo,
  nunca o token) e o bridge segue igual. Quando a imagem entra no disco, a volta
  de relógio da identidade avisa a UI sozinha — na validação, o app aberto do
  dono trocou as seis caras sem recarregar.
- Revisar em: se algum bot trocar de foto e alguém quiser a nova sem apagar a
  antiga na mão — aí é a hora de discutir um refresh manual, e não antes.

## 2026-09-21 - `/notify` trocou de credencial: a premissa de "já está na VPS" era falsa

- Contexto: a entrada de 2026-09-20 acima (item b, "Empurrar") descreve
  `/api/agents/:slug/notify` protegido pelo `requireSecret` (segredo do app),
  com a justificativa de que "quem usa essa rota já está dentro da máquina,
  com o `.env` na mão". Na prática, cada agente roda isolado no próprio
  workspace e nunca teve acesso ao `.env` do bridge — a mesma premissa falsa
  que gerou o furo do `CALLING_RING_TOKEN_<SLUG>` (ver seção de hoje mais
  acima/no README). Efeito colateral pior: o `:slug` da URL era um nome
  auto-declarado, nunca verificado — qualquer portador do segredo do app
  podia empurrar recado no nome de QUALQUER agente.
- Decisão: `/notify` passou a usar `requireAgentToken`, a MESMA credencial do
  toque (`CALLING_RING_TOKEN_<SLUG>`). A identidade vem de `req.ringAgent`
  (o token, nunca a URL); o `:slug` na URL agora só serve de conferência —
  bate ou a rota devolve `400`. Apontado pelo dono (Luiz, 21/09/2026): "o
  certo era usar a mesma, né?" — e estava certo.
- Impacto: ninguém precisa de uma segunda credencial só para empurrar recado.
  Quem só tinha `CALLING_SHARED_SECRET` no ambiente (e não o token de toque)
  perde acesso a esta rota especificamente — as outras rotas do app
  (`/api/message`, `/api/ask`, etc.) continuam com `requireSecret`, isso não
  mudou.
- Revisar em: se um dia existir um agente com credencial de toque mas sem
  vínculo nenhum com o workspace do Claude Code (fora do universo DG Claw),
  reavaliar se faz sentido ele também falar por `/notify` do mesmo jeito.
