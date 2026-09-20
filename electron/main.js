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

const { app, BrowserWindow, ipcMain, session, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const { serveApp } = require('./app-server')
const { openCloudflareLogin } = require('./login-window')
const store = require('./config-store')

const DEV_URL = process.env.CALLING_APP_URL || ''
const LOCAL_BUILD_DIR = path.join(__dirname, '..', 'web', 'dist')

/** Referencia da janela principal: a de login nasce filha dela. */
let mainWindow = null
/** Servidor local dos arquivos do app (quando nao ha `CALLING_APP_URL`). */
let appServer = null

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

async function createWindow() {
  const win = new BrowserWindow({
    width: 480,
    height: 760,
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

  void win.loadURL(target || MISSING_APP_PAGE)
}

/* ------------------------------------------------------------- ipc ------- */

function registerIpc() {
  ipcMain.handle('calling:get-config', () => store.getConfig())

  ipcMain.handle('calling:save-config', (_event, config) => store.saveConfig(config))

  ipcMain.handle('calling:clear-config', async () => {
    store.clearConfig()
    // Esquecer de verdade inclui o cookie do Access.
    await session.defaultSession.clearStorageData({ storages: ['cookies'] })
  })

  ipcMain.handle('calling:open-login', (_event, bridgeUrl) =>
    openCloudflareLogin(mainWindow, bridgeUrl),
  )
}

app.whenReady().then(() => {
  registerIpc()
  void createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  appServer?.close()
  appServer = null
})
