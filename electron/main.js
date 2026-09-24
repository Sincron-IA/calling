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
  configPanelWindow,
} = require('./config-panel')
const { createTray, refreshTrayMenu, destroyTray } = require('./tray')
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
 * A JANELA DA BARRA TEM TAMANHO FIXO.
 *
 * Ela vestia o tamanho do conteudo: cada coisa que abria (a lista, o chip, um
 * aviso) virava um `setBounds`. E o Windows, ao redimensionar uma janela
 * transparente, pinta UM quadro com a imagem velha no canto de cima a esquerda
 * do retangulo novo antes de a pagina redesenhar — era esse o "tchucho": o
 * chip piscando fora do lugar a cada abertura. Folga, espera por calmaria,
 * tolerancia de DPI: tudo remendo em volta de um redimensionamento que nao
 * precisava existir.
 *
 * Agora a janela e um retangulo transparente fixo em volta do chip, e o que
 * abre, abre dentro dele, so com CSS. O que nao e cartao deixa o clique passar
 * para quem esta embaixo (`setIgnoreMouseEvents` + o `calling:mouse-capture`
 * da pagina). A janela so se mexe quando alguem arrasta o chip.
 *
 * O tamanho cobre a coluna mais alta que a barra monta (lista + aviso +
 * balao + chip) e a tela de conexao (344px de largura).
 */
const MAIN_SIZE = { width: 380, height: 720 }

/** Respiro entre a janela e o canto da area util, no repouso. */
const MAIN_GAP = 24

/** Folga do `#root` (`index.css`): o chip mora a isto do canto da janela. */
const MAIN_PAD = 8

/**
 * A troca de lado so acontece quando o chip passa a linha do meio da tela por
 * esta distancia. Sem ela, arrastar em cima da linha faria a coluna virar e
 * desvirar a cada pixel.
 */
const FLIP_HYSTERESIS = 32

/** Ritmo do arrasto: a janela segue o cursor a cada 8ms (~120 quadros/s). */
const DRAG_TICK_MS = 8

/** Se a pagina nao confirmar a troca de lado nisso, trocamos assim mesmo. */
const SWAP_FALLBACK_MS = 400

/**
 * Para que lado as coisas abrem.
 *
 * `down`: o chip esta na metade de CIMA da tela, entao a lista, os avisos e as
 * notificacoes abrem ABAIXO dele. `right`: o chip esta na metade da ESQUERDA,
 * entao abrem a direita. O repouso (canto de baixo a direita) e os dois
 * `false`: tudo abre para cima e para a esquerda.
 */
let mainMode = { down: false, right: false }

/**
 * O canto da janela que fica PARADO: o do lado do chip. Com `mainMode` de
 * repouso e o canto de baixo a direita; virado para baixo, o de cima; e assim
 * por diante. O CSS encosta o conteudo nesse mesmo canto (`.grow-down`,
 * `.grow-right` no `index.css`).
 */
let mainCorner = null

/** A janela aparece quando a pagina montou (ou no estouro do relogio). */
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

/** A area util do monitor onde um ponto esta. */
function workAreaAt(point) {
  const display = screen.getDisplayNearestPoint({
    x: Math.round(point.x),
    y: Math.round(point.y),
  })
  return (display || screen.getPrimaryDisplay()).workArea
}

/** Canto de baixo a direita da area util: onde a barra do Calling mora. */
function restingCorner() {
  const { workArea } = screen.getPrimaryDisplay()
  return {
    x: Math.round(workArea.x + workArea.width - MAIN_GAP),
    y: Math.round(workArea.y + workArea.height - MAIN_GAP),
  }
}

/** O tamanho fixo, sem passar do monitor (tela baixa encolhe a janela). */
function mainSize(corner) {
  const workArea = workAreaAt(corner)
  return {
    width: Math.min(MAIN_SIZE.width, workArea.width),
    height: Math.min(MAIN_SIZE.height, workArea.height),
  }
}

/**
 * O retangulo da janela a partir do canto parado.
 *
 * A janela pode sobrar para fora da tela do lado OPOSTO ao chip — e so
 * transparencia, e do lado de dentro (para onde as coisas abrem) sempre ha a
 * metade da tela, porque e ela que decide o `mainMode`.
 */
function placeMain() {
  if (!mainCorner) mainCorner = restingCorner()
  const { width, height } = mainSize(mainCorner)
  return {
    x: Math.round(mainMode.right ? mainCorner.x : mainCorner.x - width),
    y: Math.round(mainMode.down ? mainCorner.y : mainCorner.y - height),
    width,
    height,
  }
}

/**
 * O canto parado da janela, dado onde o chip esta na tela.
 *
 * `chip` e o retangulo da ancora (o chip, ou o que estiver no lugar dele) em
 * coordenadas de tela. O conteudo encosta no canto com `MAIN_PAD` de folga,
 * entao o canto da janela fica essa folga para fora do canto do chip.
 */
function cornerForChip(chip, mode) {
  return {
    x: mode.right ? chip.x - MAIN_PAD : chip.x + chip.width + MAIN_PAD,
    y: mode.down ? chip.y - MAIN_PAD : chip.y + chip.height + MAIN_PAD,
  }
}

/**
 * Para que lado as coisas devem abrir, com o chip neste lugar.
 *
 * A regra e a mais simples que existe: abre para o lado onde ha MAIS tela. Na
 * metade de cima, abre para baixo; na metade da esquerda, abre para a direita.
 * Nao depende do tamanho do que esta aberto — por isso nada vira e desvira
 * quando a lista abre ou um aviso chega.
 */
function modeForChip(chip, current) {
  const center = { x: chip.x + chip.width / 2, y: chip.y + chip.height / 2 }
  const workArea = workAreaAt(center)
  const midX = workArea.x + workArea.width / 2
  const midY = workArea.y + workArea.height / 2
  return {
    down: current.down ? center.y <= midY + FLIP_HYSTERESIS : center.y < midY - FLIP_HYSTERESIS,
    right: current.right ? center.x <= midX + FLIP_HYSTERESIS : center.x < midX - FLIP_HYSTERESIS,
  }
}

/** O chip inteiro dentro da area util: soltar na borda nao deixa ele pela metade. */
function clampChip(chip) {
  const workArea = workAreaAt({ x: chip.x + chip.width / 2, y: chip.y + chip.height / 2 })
  return {
    ...chip,
    x: Math.min(Math.max(chip.x, workArea.x), workArea.x + workArea.width - chip.width),
    y: Math.min(Math.max(chip.y, workArea.y), workArea.y + workArea.height - chip.height),
  }
}

/**
 * Liga/desliga o "sempre no topo" na janela da barra.
 *
 * `screen-saver` e o nivel que fica acima de janelas em tela cheia; para um
 * widget de canto isso seria demais. `floating` e o que o Luiz espera: por cima
 * das janelas comuns, e nada mais.
 */
function applyAlwaysOnTop(value) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.setAlwaysOnTop(Boolean(value), 'floating')
}

/**
 * Liga/desliga o Calling subir sozinho com o Windows.
 *
 * `process.execPath` e o `.exe` que esta rodando agora — certo para o
 * portatil, que roda de onde o Luiz deixou. Se ele mover ou renomear o
 * arquivo, o registro do Windows continua apontando pro lugar velho ate
 * a preferencia ser trocada de novo (desligada e religada), como em
 * qualquer app portatil.
 */
function applyStartWithWindows(value) {
  try {
    app.setLoginItemSettings({ openAtLogin: Boolean(value), path: process.execPath })
  } catch {
    // Em `electron .` (desenvolvimento) isto aponta pro binario errado do
    // Electron — nao ha o que aplicar fora de um empacotamento de verdade.
  }
}

/** Poe a janela no lugar que o `mainCorner`/`mainMode` mandam, se ela nao estiver. */
function applyMainPlacement() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const next = placeMain()
  const current = mainWindow.getBounds()
  if (
    current.x === next.x &&
    current.y === next.y &&
    current.width === next.width &&
    current.height === next.height
  )
    return
  mainWindow.setBounds(next)
}

/* ------------------------------------------------ para que lado abre? --- */

/** O que a pagina precisa saber para encostar o conteudo no canto certo. */
function mainEdgeState() {
  return { growDown: mainMode.down, growRight: mainMode.right }
}

/**
 * A TROCA DE LADO, SEM PISCAR.
 *
 * Virar e duas coisas ao mesmo tempo: a pagina encosta o conteudo no outro
 * canto e a janela anda para o chip continuar onde estava. Sao dois processos,
 * e qualquer ordem deixa um quadro com os dois desencontrados — o chip
 * aparecendo do outro lado da janela por um instante.
 *
 * Entao a pagina se esconde primeiro: ela recebe o lado novo com um numero
 * (`swap`), apaga o conteudo, vira o CSS e confirma (`calling:edge-ready`).
 * So entao a janela anda — com nada desenhado — e a pagina reaparece ja no
 * lugar. Se a confirmacao nao vier (pagina travada), o relogio troca assim
 * mesmo.
 */
let swapSeq = 0
let pendingSwap = null

/** Ultima posicao conhecida do chip, em coordenadas de tela. */
let lastChip = null

function startSwap(mode) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const token = ++swapSeq
  pendingSwap = {
    token,
    mode,
    timer: setTimeout(() => commitSwap(token), SWAP_FALLBACK_MS),
  }
  mainWindow.webContents.send('calling:main-edge', {
    growDown: mode.down,
    growRight: mode.right,
    swap: token,
  })
}

function commitSwap(token) {
  if (!pendingSwap || pendingSwap.token !== token) return
  clearTimeout(pendingSwap.timer)
  mainMode = pendingSwap.mode
  pendingSwap = null
  // O chip fica onde esta; quem muda e o canto parado da janela.
  if (lastChip) mainCorner = cornerForChip(lastChip, mainMode)
  applyMainPlacement()
}

/* ------------------------------------------------------------ arrasto --- */

/**
 * O ARRASTO E DO APP, NAO DO SISTEMA.
 *
 * O `-webkit-app-region: drag` entrega o arrasto ao Windows, e ai nada aqui
 * sabe quando ele comeca ou termina — nem da para virar a coluna no meio do
 * caminho. Pior: uma regiao de arrasto nao recebe os eventos de mouse que a
 * janela transparente precisa para saber quando deixar o clique passar.
 *
 * Agora a pagina diz "comecou" (com onde o chip esta nela), a janela segue o
 * cursor por aqui, e a pagina diz "soltou".
 */
let drag = null

/** Onde o chip estaria agora, pelo cursor. */
function chipAtCursor() {
  const cursor = screen.getCursorScreenPoint()
  return {
    x: cursor.x - drag.grab.x,
    y: cursor.y - drag.grab.y,
    width: drag.size.width,
    height: drag.size.height,
  }
}

function dragTick() {
  if (!drag || !mainWindow || mainWindow.isDestroyed()) return
  const chip = chipAtCursor()
  lastChip = chip

  // Passou da linha do meio: a coluna vira no meio do arrasto, nao so no fim.
  if (!pendingSwap) {
    const wanted = modeForChip(chip, mainMode)
    if (wanted.down !== mainMode.down || wanted.right !== mainMode.right) startSwap(wanted)
  }

  mainCorner = cornerForChip(chip, mainMode)
  applyMainPlacement()
}

/**
 * @param {{x:number,y:number,width:number,height:number}} rect o chip, em coordenadas da pagina
 */
function startDrag(rect) {
  if (!mainWindow || mainWindow.isDestroyed() || !rect) return
  stopDrag()
  const bounds = mainWindow.getContentBounds()
  const cursor = screen.getCursorScreenPoint()
  drag = {
    grab: { x: cursor.x - (bounds.x + rect.x), y: cursor.y - (bounds.y + rect.y) },
    size: { width: Math.round(rect.width), height: Math.round(rect.height) },
    timer: setInterval(dragTick, DRAG_TICK_MS),
  }
}

function stopDrag() {
  if (!drag) return
  clearInterval(drag.timer)
  drag = null
}

function endDrag() {
  if (!drag) return
  const chip = clampChip(chipAtCursor())
  stopDrag()
  lastChip = chip
  // Soltou com o chip saindo da tela: ele volta inteiro. O lado nao muda
  // aqui — e o que ja estava na tela durante o arrasto.
  if (!pendingSwap) {
    mainCorner = cornerForChip(chip, mainMode)
    applyMainPlacement()
  }
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

async function createWindow() {
  const win = new BrowserWindow({
    ...placeMain(),
    // Nasce escondida: so aparece quando a pagina montou.
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
    // Fora da barra de tarefas: o Calling fica ativo sem um botao "aberto" la
    // embaixo, como o Wispr Flow. Quem mostra/esconde e encerra e a bandeja.
    skipTaskbar: true,
    // "Sempre no topo" nasce ligado (ver DEFAULT_PREFS); a bandeja desliga.
    alwaysOnTop: store.getPrefs().alwaysOnTop,
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

  // Quem manda mostrar e a pagina, quando monta (`calling:main-ready`). O
  // relogio aqui e so a rede de seguranca: se a pagina nao carregar (build
  // faltando, erro), a janela aparece assim mesmo.
  win.once('ready-to-show', () => {
    mainRevealTimer = setTimeout(() => revealMainWindow(), 1500)
  })

  // Recarregou (salvar pelo painel recarrega a barra): a pagina nova nao ouviu
  // nada ainda. Uma troca de lado que estava no meio do caminho vale ja, e o
  // clique volta a ser da janela ate a pagina nova dizer onde estao os cartoes.
  win.webContents.on('did-finish-load', () => {
    if (pendingSwap) commitSwap(pendingSwap.token)
    stopDrag()
    win.setIgnoreMouseEvents(false)
    win.webContents.send('calling:main-edge', mainEdgeState())
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
    mainRevealed = false
    stopDrag()
    if (pendingSwap) {
      clearTimeout(pendingSwap.timer)
      pendingSwap = null
    }
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

  /* A janela da barra. Tudo aqui so vale para ELA: o painel da engrenagem
     tem moldura propria e nao atravessa clique. */
  const fromMain = (event) =>
    Boolean(mainWindow && !mainWindow.isDestroyed()) &&
    BrowserWindow.fromWebContents(event.sender) === mainWindow

  // A pagina montou: pode aparecer.
  ipcMain.handle('calling:main-ready', (event) => {
    if (fromMain(event)) revealMainWindow()
  })

  /* O CLIQUE ATRAVESSA O QUE NAO E CARTAO.
     A pagina sabe o que esta debaixo do cursor e diz se aquilo e dela
     (`true`) ou transparencia (`false`). Com `forward`, o movimento do mouse
     continua chegando mesmo atravessando — e e por ele que a pagina percebe a
     hora de pegar o clique de volta. */
  ipcMain.handle('calling:mouse-capture', (event, capture) => {
    if (!fromMain(event)) return
    if (capture) mainWindow.setIgnoreMouseEvents(false)
    else mainWindow.setIgnoreMouseEvents(true, { forward: true })
  })

  ipcMain.handle('calling:drag-start', (event, rect) => {
    if (fromMain(event)) startDrag(rect)
  })

  ipcMain.handle('calling:drag-end', (event) => {
    if (fromMain(event)) endDrag()
  })

  // A pagina ja virou o conteudo (e esta escondida): a janela pode andar.
  ipcMain.handle('calling:edge-ready', (event, token) => {
    if (fromMain(event)) commitSwap(token)
  })

  // A pagina pergunta ao nascer; depois disso quem fala primeiro somos nos
  // (`calling:main-edge`), toda vez que o lado muda.
  ipcMain.handle('calling:get-main-edge', () => mainEdgeState())

  ipcMain.handle('calling:get-prefs', () => store.getPrefs())

  /* Quem muda a preferencia pode ser o painel OU a bandeja, entao quem aplica
     e um lugar so: grava, aplica na janela e devolve o estado novo para os
     dois se acertarem com ele. */
  ipcMain.handle('calling:set-prefs', (_event, patch) => {
    const prefs = store.savePrefs(patch)
    applyAlwaysOnTop(prefs.alwaysOnTop)
    applyStartWithWindows(prefs.startWithWindows)
    refreshTrayMenu(prefs)
    return prefs
  })

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

  // O registro do Windows pode ter desalinhado do que esta gravado (o Luiz
  // desligou pelo Configurações do sistema, por exemplo) — todo boot
  // reaplica o que o Calling acha que e verdade.
  applyStartWithWindows(store.getPrefs().startWithWindows)

  trayReady = Boolean(
    createTray({
      prefs: store.getPrefs(),
      onToggle: toggleMainWindow,
      onConfig: (anchor) => showConfigPanel(anchor),
      onAlwaysOnTop: (value) => {
        const prefs = store.savePrefs({ alwaysOnTop: value })
        applyAlwaysOnTop(prefs.alwaysOnTop)
        // O painel pode estar aberto mostrando o contrario. Quem sabe se ele
        // existe e o `config-panel.js`, dono da janela — aqui nao ha variavel
        // nenhuma com ela, e era essa a `configWindow` que nao existia.
        configPanelWindow()?.webContents.send('calling:prefs', prefs)
      },
      onStartWithWindows: (value) => {
        const prefs = store.savePrefs({ startWithWindows: value })
        applyStartWithWindows(prefs.startWithWindows)
        configPanelWindow()?.webContents.send('calling:prefs', prefs)
      },
      onQuit: () => {
        quitting = true
        app.quit()
      },
    }),
  )

  // Mudou a resolucao, saiu um monitor, a barra de tarefas trocou de lado: o
  // canto parado volta para dentro da area util, e o chip junto.
  screen.on('display-metrics-changed', () => {
    if (!mainCorner || drag) return
    const workArea = workAreaAt(mainCorner)
    mainCorner = {
      x: Math.min(Math.max(mainCorner.x, workArea.x), workArea.x + workArea.width),
      y: Math.min(Math.max(mainCorner.y, workArea.y), workArea.y + workArea.height),
    }
    applyMainPlacement()
  })

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
