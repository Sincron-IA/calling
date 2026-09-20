// A janela de login do Cloudflare Access.
//
// E a MESMA tela de login que o Luiz ja usa no navegador (email + codigo), so
// que aberta dentro do app. O truque todo esta na sessao: esta janela usa a
// sessao PADRAO do Electron, a mesma do app — entao o cookie `CF_Authorization`
// que o Access deixa aqui e exatamente o cookie que os `fetch` da barra vao
// levar depois. E como a sessao padrao e persistente, isso sobrevive a fechar
// e abrir o app: nao precisa logar toda vez.
//
// Como sabemos que terminou: mandamos a janela para `${bridge}/health`. Se o
// Access ainda nao conhece esta maquina, ele sequestra a navegacao para o
// dominio de login dele; quando o login termina, ele devolve a navegacao para
// o nosso proprio dominio e a pagina finalmente mostra o `{"ok":true}` do
// bridge. Ver esse corpo, no host certo, e a prova de que passamos.

const { BrowserWindow, session } = require('electron')

/**
 * Quanto tempo esperamos o login humano antes de desistir.
 *
 * Isto e tempo de GENTE, nao de rede: o Access manda um codigo por email, e o
 * caminho ate ele (trocar de app, esperar a mensagem cair, voltar, digitar)
 * passa facil de tres minutos. Se a janela morrer no meio disso, a proxima
 * tentativa recomeca o login do zero em `${bridge}/health` — ou seja, o Access
 * abre uma NOVA tentativa de login, e o codigo que ja tinha sido enviado morre
 * junto com a tentativa anterior. Dai o loop: pede codigo, chega tarde, nao
 * vale mais, pede outro. Quinze minutos cobrem a ida ao email com folga.
 */
const LOGIN_TIMEOUT_MS = 15 * 60_000

/** Se em alguns segundos nada aconteceu, mostramos a janela mesmo assim. */
const REVEAL_AFTER_MS = 2_500

/**
 * O login que esta acontecendo agora, se houver.
 *
 * Duas janelas de login ao mesmo tempo compartilham o MESMO pote de cookies
 * (e a graca toda da sessao padrao). A segunda abre uma nova tentativa de
 * login no Access e atropela o estado da primeira — quem estava no meio de
 * digitar o codigo recebe "codigo expirado". Entao so existe um de cada vez.
 *
 * @type {{win: import('electron').BrowserWindow, promise: Promise<any>} | null}
 */
let current = null

function hostOf(url) {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

/**
 * @param {import('electron').BrowserWindow | null} parent
 * @param {string} bridgeUrl
 * @returns {Promise<{status:'ok'|'cancelled'|'timeout'|'error', message?:string}>}
 */
function openCloudflareLogin(parent, bridgeUrl) {
  const base = String(bridgeUrl || '')
    .trim()
    .replace(/\/+$/, '')
  const target = `${base}/health`
  const bridgeHost = hostOf(target)

  if (!bridgeHost) {
    return Promise.resolve({
      status: 'error',
      message: 'Endereço do bridge inválido. Ele precisa começar com https://',
    })
  }

  // Ja tem um login em andamento: traz ele para frente em vez de abrir outro.
  if (current && current.promise && !current.win.isDestroyed()) {
    current.win.show()
    current.win.focus()
    return current.promise
  }

  /** A janela desta chamada, visivel tambem depois do executor. */
  let activeWin = null

  const promise = new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 480,
      height: 640,
      // Nasce escondida: se o cookie do Access ainda valer, a pagina resolve
      // sozinha em um segundo e o Luiz nem ve janela nenhuma.
      show: false,
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      backgroundColor: '#0b0d10',
      title: 'Entrar no Cloudflare',
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        // Sem `partition`: e a sessao padrao, a mesma do app. E o ponto todo.
        session: session.defaultSession,
      },
    })

    activeWin = win
    current = { win, promise: null }

    let settled = false
    let revealed = false

    const reveal = () => {
      if (revealed || settled || win.isDestroyed()) return
      revealed = true
      win.show()
      win.focus()
    }

    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(revealTimer)
      clearTimeout(deadline)
      if (current && current.win === win) current = null
      if (!win.isDestroyed()) win.destroy()
      resolve(result)
    }

    const revealTimer = setTimeout(reveal, REVEAL_AFTER_MS)
    const deadline = setTimeout(
      () =>
        finish({
          status: 'timeout',
          message: 'O login demorou demais. Tente de novo.',
        }),
      LOGIN_TIMEOUT_MS,
    )

    /** Chegamos em casa? (host do bridge + corpo do /health) */
    const check = async () => {
      if (settled || win.isDestroyed()) return

      const url = win.webContents.getURL()
      if (hostOf(url) !== bridgeHost) {
        // Estamos no dominio do Access: e a hora de o Luiz ver a tela.
        reveal()
        return
      }

      const body = await win.webContents
        .executeJavaScript('document.body ? document.body.innerText : ""', true)
        .catch(() => '')

      if (/"ok"\s*:\s*true/.test(body)) {
        finish({ status: 'ok' })
        return
      }

      // Host certo mas resposta estranha (erro do tunel, 5xx): mostra a pagina
      // para o Luiz entender o que o servidor esta dizendo.
      reveal()
    }

    win.webContents.on('did-navigate', () => void check())
    win.webContents.on('did-navigate-in-page', () => void check())
    win.webContents.on('did-finish-load', () => void check())

    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
      // -3 (ABORTED) acontece em redirect normal; nao e falha de verdade.
      if (!isMainFrame || errorCode === -3) return
      finish({
        status: 'error',
        message: `Não consegui abrir ${base} (${errorDescription}).`,
      })
    })

    // Fechou na mao antes de terminar: e cancelamento, nao erro.
    win.on('closed', () => finish({ status: 'cancelled' }))

    // Alguns provedores de identidade abrem popup. Deixamos abrir DENTRO do
    // app, na mesma sessao — se fosse para o navegador do sistema, o cookie
    // nasceria do lado errado e o login nao valeria aqui.
    win.webContents.setWindowOpenHandler(() => ({
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 480,
        height: 640,
        backgroundColor: '#0b0d10',
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          session: session.defaultSession,
        },
      },
    }))

    win.loadURL(target).catch(() => {
      // O `did-fail-load` ja conta a historia; aqui so evitamos rejeicao solta.
    })
  })

  // `finish` pode ter rodado dentro do proprio executor; so registramos o
  // login em andamento se ele ainda for este.
  if (current && current.win === activeWin) current.promise = promise
  return promise
}

module.exports = { openCloudflareLogin, LOGIN_TIMEOUT_MS }
