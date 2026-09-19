// Wrapper fino do Calling.
//
// Isto NAO e um app nativo: e so uma janela do Chromium abrindo o mesmo app web.
// Por padrao abre a URL publicada; com CALLING_APP_URL voce aponta pra outro
// lugar (ex.: http://localhost:5173 durante o desenvolvimento).

const { app, BrowserWindow, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const DEV_URL = process.env.CALLING_APP_URL || ''
const LOCAL_BUILD = path.join(__dirname, '..', 'web', 'dist', 'index.html')

function resolveTarget() {
  if (DEV_URL) return { type: 'url', value: DEV_URL }
  if (fs.existsSync(LOCAL_BUILD)) return { type: 'file', value: LOCAL_BUILD }
  return null
}

function createWindow() {
  const win = new BrowserWindow({
    width: 480,
    height: 760,
    backgroundColor: '#0b0d10',
    title: 'Calling',
    webPreferences: {
      // O app nao precisa de nenhuma ponte com o Node: e so uma pagina web.
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // O microfone e o motivo do app existir: liberamos midia e negamos o resto.
  win.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media')
  })

  // Link externo abre no navegador do sistema, nao dentro do app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const target = resolveTarget()
  if (!target) {
    void win.loadURL(
      'data:text/html,' +
        encodeURIComponent(
          '<body style="font-family:system-ui;background:#0b0d10;color:#e9edf2;padding:40px">' +
            '<h2>Calling</h2>' +
            '<p>Nao encontrei o app.</p>' +
            '<p>Rode <code>npm run build</code> na raiz, ou defina <code>CALLING_APP_URL</code>.</p>' +
            '</body>',
        ),
    )
    return
  }

  if (target.type === 'url') void win.loadURL(target.value)
  else void win.loadFile(target.value)
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
