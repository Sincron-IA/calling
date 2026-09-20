// Wrapper de desktop do Calling.
//
// A janela continua sendo o mesmo app web. O que o desktop acrescenta e o que
// o navegador nao consegue dar:
//
//   - uma tela de conexao propria (endereco do bridge + chave do app), sem
//     ninguem precisar editar `.env`;
//   - o login do Cloudflare Access DENTRO do app, na mesma sessao — o cookie
//     nasce aqui e fica, entao nao precisa logar toda vez;
//   - a chave guardada cifrada pelo cofre do sistema.
//
// Com `CALLING_APP_URL` a janela abre outra URL (ex.: `npm run dev`); sem ela,
// o app serve o `web/dist` no loopback. Ver `app-server.js` para o porque.

const { app, BrowserWindow, Menu, ipcMain, screen, session, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const { serveApp } = require('./app-server')
const { openCloudflareLogin } = require('./login-window')
const {
  openConfigPanel,
  resizeConfigPanel,
  closeConfigPanel,
  closeConfigPanelIfIdle,
} = require('./config-panel')
const { createTray, destroyTray } = require('./tray')
const store = require('./config-store')

const DEV_URL = process.env.CALLING_APP_URL || ''
const LOCAL_BUILD_DIR = path.join(__dirname, '..', 'web', 'dist')

/** Referencia da janela principal: a de login nasce filha dela. */
let mainWindow = null
/** Servidor local dos arquivos do app (quando nao ha `CALLING_APP_URL`). */
let appServer = null
/** Endereco do app ja resolvido (o painel de configuracao carrega o mesmo). */
let appUrl = ''
/** Fechar a janela so encerra o app quando o pedido veio do menu "Sair". */
let quitting = false
/** Se a bandeja existe. Sem ela, esconder a janela seria sumir com o app. */
let trayReady = false

/**
 * Tamanho de partida da janela, valendo so ate a pagina dizer o dela. Nao e
 * "o tamanho do app": e o minimo para a janela nao nascer enorme e preta atras
 * do cartao enquanto o React ainda nem montou.
 */
const MAIN_START = { width: 360, height: 400 }

/** Respiro entre a janela e o canto da area util. */
const MAIN_GAP = 24

/**
 * Quanto espaco a engrenagem quer ter entre a barra e a borda DIREITA da area
 * util para continuar ao lado dela. Abaixo disso a pagina passa a desenhar a
 * engrenagem EMBAIXO da barra — senao ela ficaria espremida contra o canto da
 * tela (e, no Windows, em cima da faixa que abre a central de notificacoes).
 *
 * O repouso da janela ja deixa `MAIN_GAP` (24px) de folga, maior que isto: o
 * desenho aprovado — engrenagem ao lado — continua sendo o normal. Quem cai no
 * caso de baixo e quem ARRASTOU a barra ate encostar na borda.
 */
const MAIN_EDGE_MARGIN = 16

/**
 * O canto de BAIXO A DIREITA da janela principal, em coordenadas de tela.
 *
 * E este ponto que fica parado quando o conteudo muda de tamanho: a janela
 * cresce para cima e para a esquerda, como um widget de bandeja, em vez de
 * escorregar para fora da tela. Se o usuario arrastar a janela, o ponto vai
 * junto — dai em diante ela cresce a partir de onde ele deixou.
 */
let mainAnchor = null

/** Ultimo retangulo que NOS aplicamos: e como sabemos se o 'move' foi do usuario. */
let mainApplied = null

/** A janela so aparece depois que a pagina diz o tamanho dela (ou no estouro). */
let mainRevealed = false
let mainRevealTimer = null

const MISSING_APP_PAGE =
  'data:text/html,' +
  encodeURIComponent(
    '<body style="font-family:system-ui;background:#0b0d10;color:#e9edf2;padding:40px">' +
      '<h2>Calling</h2>' +
      '<p>Nao encontrei o app.</p>' +
      '<p>Rode <code>npm run build</code> na raiz, ou defina <code>CALLING_APP_URL</code>.</p>' +
      '</body>',
  )

async function resolveAppUrl() {
  if (DEV_URL) return DEV_URL

  if (!fs.existsSync(path.join(LOCAL_BUILD_DIR, 'index.html'))) return ''

  if (!appServer) {
    appServer = await serveApp(LOCAL_BUILD_DIR)
    if (!appServer.preferred) {
      console.warn(
        `[calling] a porta de sempre estava ocupada; o app subiu em ${appServer.origin}. ` +
          'Se o bridge recusar por origem, inclua este endereco em CALLING_ALLOWED_ORIGINS.',
      )
    }
  }
  return appServer.origin
}

/** Canto de baixo a direita da area util: onde a barra do Calling mora. */
function restingAnchor() {
  const { workArea } = screen.getPrimaryDisplay()
  return {
    x: Math.round(workArea.x + workArea.width - MAIN_GAP),
    y: Math.round(workArea.y + workArea.height - MAIN_GAP),
  }
}

/**
 * O retangulo da janela para um tamanho de conteudo, mantendo a ancora (o canto
 * de baixo a direita) no lugar e sem deixar nada sair da area util.
 */
function placeMain(width, height) {
  if (!mainAnchor) mainAnchor = restingAnchor()
  const display = screen.getDisplayNearestPoint(mainAnchor) || screen.getPrimaryDisplay()
  const { workArea } = display

  const w = Math.min(Math.max(1, Math.round(width)), workArea.width)
  const h = Math.min(Math.max(1, Math.round(height)), workArea.height)
  const x = Math.min(
    Math.max(Math.round(mainAnchor.x) - w, workArea.x),
    workArea.x + workArea.width - w,
  )
  const y = Math.min(
    Math.max(Math.round(mainAnchor.y) - h, workArea.y),
    workArea.y + workArea.height - h,
  )

  return { x: Math.round(x), y: Math.round(y), width: w, height: h }
}

function applyMainBounds(bounds) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainApplied = bounds
  mainWindow.setBounds(bounds)
  emitMainEdge()
}

/* ------------------------------------------- a barra encostou na borda? --- */

/** Ultimo estado ja avisado a pagina: so falamos quando ele muda. */
let mainEdgeSent = null

/**
 * De onde a barra mora ate a borda direita da area util, em px.
 *
 * A conta e sobre a ANCORA (o canto de baixo a direita da janela), nao sobre o
 * retangulo atual: assim ela nao depende do tamanho do conteudo, que muda o
 * tempo todo. Sem isso, mudar o desenho por causa da borda mudaria a largura,
 * que mudaria a conta — e a engrenagem ficaria piscando de um lado para o
 * outro.
 */
function mainRightGap() {
  const anchor = mainAnchor || restingAnchor()
  const display = screen.getDisplayNearestPoint(anchor) || screen.getPrimaryDisplay()
  const { workArea } = display
  return Math.round(workArea.x + workArea.width - anchor.x)
}

/** O que a pagina precisa saber sobre onde a janela esta. */
function mainEdgeState() {
  return { rightEdge: mainRightGap() < MAIN_EDGE_MARGIN }
}

/** Conta para a janela da barra, se algo mudou (a pagina decide o desenho). */
function emitMainEdge() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const state = mainEdgeState()
  if (mainEdgeSent && mainEdgeSent.rightEdge === state.rightEdge) return
  mainEdgeSent = state
  mainWindow.webContents.send('calling:main-edge', state)
}

/** Mostra a janela na primeira vez — e so na primeira. */
function revealMainWindow() {
  if (mainRevealTimer) {
    clearTimeout(mainRevealTimer)
    mainRevealTimer = null
  }
  if (mainRevealed) return
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainRevealed = true
  // Sem roubar o foco: o Calling e um app de canto, nao uma janela que se
  // planta na frente de quem estava trabalhando.
  mainWindow.showInactive()
}

/**
 * A janela acompanha o TAMANHO DO CONTEUDO — a mesma ideia do painel da
 * engrenagem, aqui para a janela principal. Sem isso a moldura sobraria em
 * volta do cartao: fundo preto enorme atras de um cartaozinho.
 *
 * @param {{width:number, height:number}} size tamanho do conteudo, em px de pagina
 */
function resizeMainWindow(size) {
  if (!mainWindow || mainWindow.isDestroyed()) return

  const width = Math.max(96, Math.round(size?.width || 0))
  const height = Math.max(48, Math.round(size?.height || 0))
  const current = mainWindow.getBounds()

  if (Math.abs(current.width - width) >= 2 || Math.abs(current.height - height) >= 2) {
    applyMainBounds(placeMain(width, height))
  }
  revealMainWindow()
}

async function createWindow() {
  const { width, height } = MAIN_START

  const win = new BrowserWindow({
    ...placeMain(width, height),
    // Nasce escondida: so aparece quando a pagina ja disse o tamanho dela.
    show: false,
    // Sem moldura do sistema. O Calling e um widget de canto, nao uma janela de
    // app com titulo e botoes — quem mostra/esconde e encerra e a bandeja, e a
    // faixa em volta do conteudo arrasta a janela (`-webkit-app-region: drag`).
    frame: false,
    // Tirar a moldura NAO torna a janela transparente: sem isto ela continua um
    // retangulo opaco da cor de `backgroundColor`, e como o cartao/barra tem
    // canto arredondado sobrava um fundo escuro nos cantos e nas bordas — o
    // "fundo preto com borda branca". Com `transparent`, o que se ve e so o que
    // a pagina pinta.
    transparent: true,
    // Em janela transparente o fundo tem que ser transparente TAMBEM aqui: uma
    // cor opaca aqui volta a preencher a janela inteira.
    backgroundColor: '#00000000',
    // A sombra e do SISTEMA, desenhada no RETANGULO da janela — justamente a
    // "borda" clara em volta do conteudo arredondado no Windows. Quem faz a
    // profundidade agora e o `box-shadow` do proprio cartao, no CSS.
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    title: 'Calling',
    webPreferences: {
      // A pagina segue sem Node: a ponte e so o preload, com quatro funcoes.
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })
  mainWindow = win
  mainRevealed = false
  mainApplied = null

  // Quem manda mostrar e a pagina, quando ela diz o tamanho do conteudo
  // (`calling:resize-main`). O relogio aqui e so a rede de seguranca: se a
  // pagina nao carregar (build faltando, erro), a janela aparece assim mesmo.
  win.once('ready-to-show', () => {
    mainRevealTimer = setTimeout(() => revealMainWindow(), 1500)
  })

  // Arrastou a janela: a ancora vai junto, senao o proximo redimensionamento a
  // jogaria de volta para o canto.
  win.on('move', () => {
    if (win.isDestroyed()) return
    const bounds = win.getBounds()
    if (
      mainApplied &&
      bounds.x === mainApplied.x &&
      bounds.y === mainApplied.y &&
      bounds.width === mainApplied.width &&
      bounds.height === mainApplied.height
    ) {
      return
    }
    mainAnchor = { x: bounds.x + bounds.width, y: bounds.y + bounds.height }
    // Arrastar a barra para o canto e justamente o que faz a engrenagem descer.
    emitMainEdge()
  })

  // Recarregou (salvar pelo painel recarrega a barra): a pagina nova nao ouviu
  // nada ainda, entao repetimos o recado.
  win.webContents.on('did-finish-load', () => {
    mainEdgeSent = null
    emitMainEdge()
  })

  // Voltar para a barra e o mesmo que sair do painel — menu que fica aberto
  // atras da janela nao e menu.
  win.on('focus', () => closeConfigPanelIfIdle())

  // O X da janela guarda o app na bandeja em vez de mata-lo: quem encerra de
  // verdade e o "Sair" do menu da bandeja.
  win.on('close', (event) => {
    if (quitting || !trayReady) return
    event.preventDefault()
    win.hide()
  })

  win.on('closed', () => {
    if (mainWindow !== win) return
    mainWindow = null
    mainApplied = null
    mainRevealed = false
    if (mainRevealTimer) {
      clearTimeout(mainRevealTimer)
      mainRevealTimer = null
    }
  })

  // O microfone e o motivo do app existir: liberamos midia e negamos o resto.
  win.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media')
  })

  // Link externo abre no navegador do sistema, nao dentro do app. (A janela de
  // login do Cloudflare tem regra propria: la o popup precisa ficar aqui.)
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const target = await resolveAppUrl().catch((err) => {
    console.error('[calling] nao consegui servir o app local:', err.message)
    return ''
  })
  appUrl = target

  void win.loadURL(target || MISSING_APP_PAGE)
}

/* ------------------------------------------------------------- bandeja --- */

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    void createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  // Pedido explicito (bandeja, "Abrir a barra"): a janela ja foi mostrada, e a
  // primeira aparicao automatica nao precisa mais acontecer.
  mainRevealed = true
  if (mainRevealTimer) {
    clearTimeout(mainRevealTimer)
    mainRevealTimer = null
  }
  mainWindow.show()
  mainWindow.focus()
}

function toggleMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    mainWindow.hide()
    return
  }
  showMainWindow()
}

/**
 * Abre o painel de configuracao ancorado onde o usuario clicou.
 *
 * @param {{x:number,y:number,width:number,height:number} | null} anchor ja em coordenadas de tela
 */
function showConfigPanel(anchor) {
  if (!appUrl) return
  openConfigPanel({ appUrl, anchor })
}

/* ------------------------------------------------------------- ipc ------- */

function registerIpc() {
  ipcMain.handle('calling:get-config', () => store.getConfig())

  ipcMain.handle('calling:save-config', (event, config) => {
    const result = store.saveConfig(config)
    // Salvou pelo painel: a janela da barra recarrega para pegar o endereco e
    // a chave novos (o `DesktopGate` le a config ao nascer).
    const sender = BrowserWindow.fromWebContents(event.sender)
    if (mainWindow && !mainWindow.isDestroyed() && sender !== mainWindow) mainWindow.reload()
    return result
  })

  ipcMain.handle('calling:clear-config', async () => {
    store.clearConfig()
    // Esquecer de verdade inclui o cookie do Access.
    await session.defaultSession.clearStorageData({ storages: ['cookies'] })
  })

  ipcMain.handle('calling:open-login', (event, bridgeUrl) => {
    // A janela de login nasce filha de QUEM pediu: pelo painel, ela fica presa
    // ao painel — e assim o painel nao se esconde quando o login rouba o foco.
    const parent = BrowserWindow.fromWebContents(event.sender) || mainWindow
    return openCloudflareLogin(parent, bridgeUrl)
  })

  ipcMain.handle('calling:open-config', (event, anchor) => {
    // A engrenagem manda o retangulo dela em coordenadas da PAGINA; aqui ele
    // vira coordenada de tela, que e o que o posicionamento entende.
    const sender = BrowserWindow.fromWebContents(event.sender)
    let screenAnchor = null
    if (anchor && sender && !sender.isDestroyed()) {
      const bounds = sender.getContentBounds()
      screenAnchor = {
        x: Math.round(bounds.x + anchor.x),
        y: Math.round(bounds.y + anchor.y),
        width: Math.round(anchor.width),
        height: Math.round(anchor.height),
      }
    }
    showConfigPanel(screenAnchor)
  })

  ipcMain.handle('calling:resize-config', (_event, height) => resizeConfigPanel(height))

  // A janela da barra faz o mesmo que o painel: veste o tamanho do conteudo.
  ipcMain.handle('calling:resize-main', (event, size) => {
    // So a propria janela principal manda nisso (o painel tem o handler dele).
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (BrowserWindow.fromWebContents(event.sender) !== mainWindow) return
    resizeMainWindow(size)
  })

  // A pagina pergunta ao nascer; depois disso quem fala primeiro somos nos
  // (`calling:main-edge`), toda vez que a janela se mexe.
  ipcMain.handle('calling:get-main-edge', () => mainEdgeState())

  ipcMain.handle('calling:close-config', () => closeConfigPanel())

  ipcMain.handle('calling:show-main', () => showMainWindow())

  ipcMain.handle('calling:quit', () => {
    quitting = true
    app.quit()
  })
}

// Nada de File/Edit/View dentro da janela — era isso que estava feio.
//
// No macOS, porem, esse menu nao fica na janela: ele E a barra do sistema, e
// tirar ela levaria junto os atalhos de copiar e colar (a chave do app se cola
// no painel). La o menu de sempre fica.
if (process.platform !== 'darwin') Menu.setApplicationMenu(null)

app.whenReady().then(() => {
  registerIpc()
  void createWindow()

  trayReady = Boolean(
    createTray({
      onToggle: toggleMainWindow,
      onConfig: (anchor) => showConfigPanel(anchor),
      onQuit: () => {
        quitting = true
        app.quit()
      },
    }),
  )

  // Mudou a resolucao, chegou/saiu um monitor, a barra de tarefas trocou de
  // lado: a borda direita e outra, e a engrenagem pode ter que mudar de lugar.
  screen.on('display-metrics-changed', () => emitMainEdge())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
    else showMainWindow()
  })
})

// Com bandeja, a janela some mas o app fica vivo la. Sem bandeja, fechar a
// janela volta a ser o mesmo que sair — senao o app ficaria rodando invisivel.
app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return
  if (quitting || !trayReady) app.quit()
})

app.on('before-quit', () => {
  quitting = true
  destroyTray()
  appServer?.close()
  appServer = null
})
