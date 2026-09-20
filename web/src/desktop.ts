/**
 * A ponte com o app de desktop (Electron).
 *
 * O `electron/preload.js` publica `window.callingDesktop` com estas quatro
 * funcoes. No navegador comum esse objeto simplesmente nao existe — e e assim
 * que o app sabe em qual mundo esta rodando, sem nenhuma variavel de ambiente
 * nova e sem mudar o fluxo antigo.
 */

/** Como terminou a ida ate a tela de login do Cloudflare. */
export type LoginStatus = 'ok' | 'cancelled' | 'timeout' | 'error'

export interface LoginResult {
  status: LoginStatus
  /** Texto pronto para a tela quando deu errado. */
  message?: string
}

export interface StoredConfig {
  bridgeUrl: string
  sharedSecret: string
  /**
   * `false` quando o sistema nao tem cofre (o `safeStorage` do Electron): a
   * chave NAO fica salva entre execucoes — nunca gravamos em texto puro.
   */
  secretPersisted: boolean
}

export interface CallingDesktopApi {
  /** Config salva, ou `null` se esta e a primeira vez. */
  getConfig(): Promise<StoredConfig | null>
  /** Salva endereco + chave (a chave vai cifrada). */
  saveConfig(config: { bridgeUrl: string; sharedSecret: string }): Promise<{
    secretPersisted: boolean
  }>
  /** Esquece tudo: endereco, chave e a sessao do Cloudflare. */
  clearConfig(): Promise<void>
  /** Abre a janela de login do Cloudflare Access e espera ela terminar. */
  openCloudflareLogin(bridgeUrl: string): Promise<LoginResult>
}

declare global {
  interface Window {
    callingDesktop?: CallingDesktopApi
  }
}

/** A API do desktop, ou `null` quando estamos num navegador comum. */
export const desktop: CallingDesktopApi | null =
  typeof window !== 'undefined' && window.callingDesktop ? window.callingDesktop : null

/** Estamos dentro do app de desktop? */
export const isDesktop = desktop !== null
