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
function restingBounds(width, height) {
  const { workArea } = screen.getPrimaryDisplay()
  return {
    x: Math.round(workArea.x + workArea.width - width - 24),
    y: Math.round(workArea.y + workArea.height - height - 24),
  }
}

async function createWindow() {
  const width = 480
  const height = 760

  const win = new BrowserWindow({
    width,
    height,
    ...restingBounds(width, height),
    // Nasce escondida e sem roubar o foco: o Calling e um app de canto, nao
    // uma janela que se planta na frente de quem estava trabalhando.
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d10',
    title: 'Calling',
    webPreferences: {
      // A pagina segue sem Node: a ponte e so o preload, com quatro funcoes.
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })
  mainWindow = win
  win.once('ready-to-show', () => win.showInactive())

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
    if (mainWindow === win) mainWindow = null
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
