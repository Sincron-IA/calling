// O Calling na bandeja do sistema.
//
// O app vive quieto: a janela nasce discreta no canto e o icone da bandeja e
// o caminho de volta para ela (mostrar/esconder, abrir a configuracao, sair).
// Se a maquina nao tiver area de notificacao, nada disso e obrigatorio — o
// app continua funcionando pela janela.

const { Tray, Menu, nativeImage } = require('electron')
const path = require('node:path')

const ICON_FILE = path.join(__dirname, 'assets', 'tray-icon.png')

let tray = null

function trayImage() {
  const image = nativeImage.createFromPath(ICON_FILE)
  if (image.isEmpty()) return image

  // 16px e o tamanho que macOS e Linux esperam; o Windows aceita o de 32.
  if (process.platform === 'win32') return image

  const small = image.resize({ width: 16, height: 16 })
  // No macOS o icone da barra e monocromatico e acompanha o tema do sistema.
  if (process.platform === 'darwin') small.setTemplateImage(true)
  return small
}

/**
 * @param {{onToggle:()=>void, onConfig:(anchor:Electron.Rectangle|null)=>void, onQuit:()=>void}} actions
 * @returns {Electron.Tray | null}
 */
function createTray({ onToggle, onConfig, onQuit }) {
  const image = trayImage()
  if (image.isEmpty()) {
    console.warn(`[calling] icone da bandeja nao encontrado em ${ICON_FILE}`)
  }

  try {
    tray = new Tray(image)
  } catch (err) {
    console.warn('[calling] este sistema nao tem bandeja:', err.message)
    return null
  }

  /** Onde o icone esta na tela — e a ancora do painel de configuracao. */
  const anchor = () => {
    const bounds = tray?.getBounds?.()
    // No Linux o indicador costuma devolver zeros: sem ancora, o painel se
    // vira sozinho (canto de baixo a direita).
    return bounds && bounds.width > 0 ? bounds : null
  }

  tray.setToolTip('Calling')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Mostrar/esconder', click: () => onToggle() },
      { label: 'Configuração…', click: () => onConfig(anchor()) },
      { type: 'separator' },
      { label: 'Sair', click: () => onQuit() },
    ]),
  )

  tray.on('click', () => onToggle())
  tray.on('double-click', () => onToggle())

  return tray
}

function destroyTray() {
  if (tray && !tray.isDestroyed()) tray.destroy()
  tray = null
}

module.exports = { createTray, destroyTray }
