// Onde o app de desktop guarda o que o Luiz digitou na tela de conexao.
//
// Duas coisas, com pesos diferentes:
//   - o ENDERECO do bridge e publico: vai em JSON, sem cerimonia;
//   - a CHAVE do app e segredo: so entra no arquivo cifrada pelo `safeStorage`
//     do Electron (que usa o cofre do sistema — Keychain, DPAPI, libsecret).
//
// Se a maquina nao tiver cofre, a chave NAO e gravada. Nada de texto puro no
// disco: ela fica so na memoria desta execucao, e o app avisa na tela que vai
// pedir de novo da proxima vez.

const { app, safeStorage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

/** Chave viva so nesta execucao (usada quando nao ha cofre no sistema). */
let sessionSecret = ''

function configFile() {
  return path.join(app.getPath('userData'), 'calling-config.json')
}

function hasVault() {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function readFile() {
  try {
    const raw = JSON.parse(fs.readFileSync(configFile(), 'utf8'))
    return raw && typeof raw === 'object' ? raw : null
  } catch {
    // Arquivo inexistente ou estragado: e o mesmo que nao ter config.
    return null
  }
}

/** O que a tela de conexao precisa saber, ou `null` se nunca houve config. */
function getConfig() {
  const raw = readFile()
  const bridgeUrl = typeof raw?.bridgeUrl === 'string' ? raw.bridgeUrl : ''

  let sharedSecret = sessionSecret
  if (!sharedSecret && raw?.secret?.mode === 'encrypted' && typeof raw.secret.value === 'string') {
    try {
      sharedSecret = safeStorage.decryptString(Buffer.from(raw.secret.value, 'base64'))
    } catch {
      // Cofre trocado, perfil movido de maquina: melhor pedir de novo.
      sharedSecret = ''
    }
  }

  if (!bridgeUrl && !sharedSecret) return null
  return { bridgeUrl, sharedSecret, secretPersisted: hasVault() }
}

/** Salva. Devolve se a chave realmente sobreviveu ao disco. */
function saveConfig(config) {
  const bridgeUrl = String(config?.bridgeUrl || '').trim()
  const sharedSecret = String(config?.sharedSecret || '')
  sessionSecret = sharedSecret

  const vault = hasVault()
  const payload = {
    bridgeUrl,
    // Sem cofre, marcamos o motivo — e nao gravamos a chave de jeito nenhum.
    secret: vault
      ? { mode: 'encrypted', value: safeStorage.encryptString(sharedSecret).toString('base64') }
      : { mode: 'unavailable' },
    savedAt: new Date().toISOString(),
  }

  fs.mkdirSync(path.dirname(configFile()), { recursive: true })
  fs.writeFileSync(configFile(), JSON.stringify(payload, null, 2), { mode: 0o600 })

  return { secretPersisted: vault }
}

function clearConfig() {
  sessionSecret = ''
  try {
    fs.rmSync(configFile(), { force: true })
  } catch {
    /* ja nao existia */
  }
}

module.exports = { getConfig, saveConfig, clearConfig, configFile }
