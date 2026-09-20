// Um servidorzinho de arquivos, so para o proprio app.
//
// POR QUE ISTO EXISTE: uma pagina aberta em `file://` nao tem origem. O
// Chromium manda `Origin: null` nas chamadas, e o bridge — que so aceita
// origens conhecidas (`CALLING_ALLOWED_ORIGINS`) — recusa antes de olhar a
// chave. Testado contra o bridge de verdade: `Origin: null` volta 500.
//
// Entao o app serve o `web/dist` no proprio computador, em
// `http://localhost:5173` — a MESMA origem que o `npm run dev` usa e que o
// bridge ja libera. Do ponto de vista do bridge, o app de desktop e o mesmo
// navegador de sempre; nada de regra nova no servidor.
//
// Escuta so no loopback (127.0.0.1 e ::1). Nada disso aparece na rede.

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

/** A porta que o bridge ja conhece. `CALLING_APP_PORT` muda se precisar. */
const DEFAULT_PORT = Number(process.env.CALLING_APP_PORT || 5173)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
}

function handler(root) {
  return (req, res) => {
    let rawPath
    try {
      rawPath = decodeURIComponent((req.url || '/').split('?')[0])
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('caminho invalido')
      return
    }
    const wanted = path.join(root, path.normalize(rawPath))

    // Cinto de seguranca: nada fora da pasta do app sai daqui.
    const inside = wanted === root || wanted.startsWith(root + path.sep)
    let file = inside && fs.existsSync(wanted) && fs.statSync(wanted).isFile() ? wanted : ''

    // Rota desconhecida cai no index: o app e uma pagina so.
    if (!file) file = path.join(root, 'index.html')

    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('nao encontrei')
        return
      }
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
      })
      res.end(data)
    })
  }
}

function bind(serve, port, host) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(serve)
    const onError = (err) => {
      server.close()
      reject(err)
    }
    server.once('error', onError)
    server.listen(port, host, () => {
      server.removeListener('error', onError)
      resolve({ server, port: server.address().port })
    })
  })
}

/**
 * Sobe o servidor e devolve a origem para carregar na janela.
 * @param {string} root pasta do `web/dist`
 * @returns {Promise<{origin:string, port:number, preferred:boolean, close:()=>void}>}
 */
async function serveApp(root) {
  const serve = handler(path.resolve(root))

  let preferred = true
  let v4
  try {
    v4 = await bind(serve, DEFAULT_PORT, '127.0.0.1')
  } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err
    // Alguem (o `npm run dev`, provavelmente) ja esta na porta de sempre.
    preferred = false
    v4 = await bind(serve, 0, '127.0.0.1')
  }

  // `localhost` pode resolver para ::1 antes de 127.0.0.1. Escutamos nos dois
  // para a origem ser sempre `http://localhost:<porta>`, que e o que o bridge
  // libera — se o IPv6 nao existir nesta maquina, tudo bem, seguimos com o v4.
  const v6 = await bind(serve, v4.port, '::1').catch(() => null)

  return {
    origin: `http://localhost:${v4.port}`,
    port: v4.port,
    preferred,
    close: () => {
      v4.server.close()
      v6?.server.close()
    },
  }
}

module.exports = { serveApp, DEFAULT_PORT }
