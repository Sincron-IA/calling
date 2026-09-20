// A unica ponte entre a pagina e o Node.
//
// Nada de `require` solto no renderer: o `contextBridge` publica quatro
// funcoes, e so. A chave do app atravessa por aqui (para ser salva e para
// preencher o campo de volta), mas NUNCA e escrita em texto puro no disco nem
// impressa em log — quem guarda e o `config-store.js`, cifrando.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('callingDesktop', {
  /** Config salva, ou `null` na primeira vez. */
  getConfig: () => ipcRenderer.invoke('calling:get-config'),

  /** Guarda endereco + chave (a chave vai cifrada pelo safeStorage). */
  saveConfig: (config) => ipcRenderer.invoke('calling:save-config', config),

  /** Esquece endereco, chave e a sessao do Cloudflare. */
  clearConfig: () => ipcRenderer.invoke('calling:clear-config'),

  /**
   * Abre a tela de login do Cloudflare Access dentro do app e resolve quando
   * ela termina: `{ status: 'ok' | 'cancelled' | 'timeout' | 'error' }`.
   */
  openCloudflareLogin: (bridgeUrl) => ipcRenderer.invoke('calling:open-login', bridgeUrl),
})
