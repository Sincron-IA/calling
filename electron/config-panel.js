// O painel de configuracao — a mesma tela de conexao, do tamanho de um menu.
//
// Nao e uma janela de app: nasce sem moldura, sem barra de tarefas, por cima
// de tudo e colada no que a abriu (a engrenagem do app ou o icone da bandeja).
// O conteudo e o MESMO app web, carregado com `#config`: assim as cores, as
// fontes e o formulario sao os de verdade, sem HTML paralelo para manter.

const { BrowserWindow, screen } = require('electron')
const path = require('node:path')

/** Tamanho do painel. Cabe o formulario inteiro sem virar janela de app. */
const PANEL = { width: 360, height: 470 }

/** Respiro entre a ancora (engrenagem/bandeja) e o painel. */
const GAP = 8

/** So existe um painel de cada vez. */
let panel = null
/** De onde o painel saiu: o mesmo ponto serve quando ele muda de altura. */
let lastAnchor = null

/**
 * Decide se o painel abre para BAIXO ou para CIMA.
 *
 * Isto nao e preciosismo: no Windows a barra de tarefas fica embaixo por
 * padrao, entao o icone da bandeja nasce no canto INFERIOR direito e um painel
 * que sempre descesse cairia fora da tela. Se nao couber abaixo da ancora,
 * abrimos acima dela; nas maquinas com a barra em cima (ou no macOS, com o
 * menu no topo) o caminho normal continua sendo para baixo.
 *
 * @param {{x:number,y:number,width:number,height:number}} anchor em coordenadas de tela
 * @param {{width:number,height:number}} size
 * @param {{x:number,y:number,width:number,height:number}} workArea area util do monitor
 */
function placePanel(anchor, size, workArea) {
  const bottomLimit = workArea.y + workArea.height
  // Monitor baixo (ou muita barra de tarefas): o painel encolhe em vez de
  // nascer com metade dele fora da tela.
  const height = Math.min(size.height, workArea.height - GAP * 2)
  const width = Math.min(size.width, workArea.width - GAP * 2)

  const below = anchor.y + anchor.height + GAP
  const above = anchor.y - GAP - height

  let y = below + height <= bottomLimit ? below : above
  if (y < workArea.y) y = Math.max(workArea.y, bottomLimit - height)

  const minX = workArea.x + GAP
  const maxX = workArea.x + workArea.width - width - GAP
  const centered = anchor.x + anchor.width / 2 - width / 2
  const x = Math.round(Math.min(Math.max(centered, minX), Math.max(minX, maxX)))

  return { x, y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

/** A area util do monitor onde a ancora esta (nao necessariamente o principal). */
function workAreaFor(anchor) {
  const point = {
    x: Math.round(anchor.x + anchor.width / 2),
    y: Math.round(anchor.y + anchor.height / 2),
  }
  const display = screen.getDisplayNearestPoint(point) || screen.getPrimaryDisplay()
  return display.workArea
}

/** Sem ancora conhecida (bandeja sem bounds no Linux): canto de baixo a direita. */
function fallbackAnchor() {
  const { workArea } = screen.getPrimaryDisplay()
  return {
    x: workArea.x + workArea.width - 40,
    y: workArea.y + workArea.height - 40,
    width: 24,
    height: 24,
  }
}

/**
 * Abre (ou traz de volta) o painel de configuracao.
 *
 * @param {{appUrl:string, anchor?:{x:number,y:number,width:number,height:number}|null}} options
 */
function openConfigPanel({ appUrl, anchor }) {
  if (!appUrl) return null

  const target = anchor && Number.isFinite(anchor.x) && anchor.width > 0 ? anchor : fallbackAnchor()
  lastAnchor = target
  const bounds = placePanel(target, PANEL, workAreaFor(target))

  if (panel && !panel.isDestroyed()) {
    panel.setBounds(bounds)
    panel.show()
    panel.focus()
    return panel
  }

  const win = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    // Mesmo motivo da janela da barra (ver `main.js`): sem `transparent` a
    // janela e um retangulo opaco e o canto arredondado do cartao aparece
    // recortado num fundo escuro. Aqui o cartao E a janela inteira, entao o
    // retangulo sobrava exatamente nos quatro cantos.
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'Calling · conexão',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  panel = win
  win.on('closed', () => {
    if (panel === win) panel = null
  })

  win.once('ready-to-show', () => win.show())

  // Fecha como um menu do sistema: saiu o foco, sumiu. Com uma excecao que
  // nao e detalhe — a janela de login do Cloudflare nasce FILHA do painel, e
  // fechar o pai destruiria o login no meio do caminho.
  win.on('blur', () => {
    setTimeout(() => {
      if (win.isDestroyed()) return
      if (win.getChildWindows().some((child) => !child.isDestroyed())) return
      if (BrowserWindow.getFocusedWindow()) return
      win.close()
    }, 120)
  })

  // `#config` e o que faz o app web montar o painel em vez da barra.
  void win.loadURL(`${appUrl.split('#')[0]}#config`)

  return win
}

/**
 * A janela acompanha a altura do conteudo (o painel cresce com um erro na
 * tela, encolhe quando ele some) — e reancora, porque quem abre para cima
 * cresce a partir de baixo.
 *
 * @param {number} height altura do cartao, em px de pagina
 */
function resizeConfigPanel(height) {
  if (!panel || panel.isDestroyed() || !lastAnchor) return
  const wanted = Math.max(200, Math.round(height))
  if (Math.abs(panel.getBounds().height - wanted) < 2) return
  panel.setBounds(
    placePanel(lastAnchor, { width: PANEL.width, height: wanted }, workAreaFor(lastAnchor)),
  )
}

function closeConfigPanel() {
  if (panel && !panel.isDestroyed()) panel.close()
  panel = null
}

/** Fecha o painel, a nao ser que ele esteja segurando o login do Cloudflare. */
function closeConfigPanelIfIdle() {
  if (!panel || panel.isDestroyed()) return
  if (panel.getChildWindows().some((child) => !child.isDestroyed())) return
  closeConfigPanel()
}

/** A janela do painel, se estiver aberta. */
function configPanelWindow() {
  return panel && !panel.isDestroyed() ? panel : null
}

module.exports = {
  openConfigPanel,
  resizeConfigPanel,
  closeConfigPanel,
  closeConfigPanelIfIdle,
  configPanelWindow,
  placePanel,
  PANEL,
}
