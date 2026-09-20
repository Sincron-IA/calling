// A unica ponte entre a pagina e o Node.
//
// Nada de `require` solto no renderer: o `contextBridge` publica um punhado de
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

  /**
   * Abre o painel de configuracao colado na engrenagem.
   * @param anchor retangulo da engrenagem em coordenadas da pagina
   */
  openConfigPanel: (anchor) => ipcRenderer.invoke('calling:open-config', anchor),

  /** O painel diz a altura do seu conteudo; a janela acompanha. */
  resizeConfigPanel: (height) => ipcRenderer.invoke('calling:resize-config', height),

  /** Fecha o painel (o proprio painel chama isto). */
  closeConfigPanel: () => ipcRenderer.invoke('calling:close-config'),

  /** Traz a janela da barra para frente. */
  showMainWindow: () => ipcRenderer.invoke('calling:show-main'),

  /** Encerra o Calling de verdade, bandeja inclusive. */
  quit: () => ipcRenderer.invoke('calling:quit'),
})
