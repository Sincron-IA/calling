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
  /**
   * Abre o painel de configuracao. O retangulo e o da engrenagem, em
   * coordenadas da pagina — o processo principal traduz para a tela e decide
   * se o painel desce ou sobe.
   */
  openConfigPanel(anchor?: PanelAnchor | null): Promise<void>
  /** Ajusta a altura da janela do painel a do conteudo. */
  resizeConfigPanel(height: number): Promise<void>
  /**
   * Ajusta a janela da barra ao tamanho do conteudo. Sem isso a janela teria um
   * tamanho fixo e sobraria fundo em volta do cartao — o oposto de um widget de
   * canto. Quem reancora no canto de baixo a direita e o processo principal.
   */
  resizeMainWindow(size: { width: number; height: number }): Promise<void>
  /** Fecha o painel de configuracao (chamado de dentro dele). */
  closeConfigPanel(): Promise<void>
  /** Traz a janela da barra para frente. */
  showMainWindow(): Promise<void>
  /** Encerra o Calling. */
  quit(): Promise<void>
}

/** Retangulo de onde o painel deve sair. */
export interface PanelAnchor {
  x: number
  y: number
  width: number
  height: number
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

/**
 * Esta janela e o painel de configuracao?
 *
 * O painel carrega o MESMO app, so que com `#config` — e assim que ele herda
 * as cores e as fontes de verdade sem uma segunda copia de HTML.
 */
export const isConfigPanel =
  typeof window !== 'undefined' && window.location.hash.startsWith('#config')

/**
 * Esta janela e a PRINCIPAL do app de desktop (a da barra / da primeira
 * conexao)?
 *
 * Ela nao tem moldura e veste o tamanho do conteudo, entao o CSS de navegador
 * (tela cheia, `100vh`, barra ancorada no canto da viewport) nao serve aqui —
 * quem ancora e o Electron. E a classe `desktop-main` no `body` que troca isso.
 */
export const isDesktopMainWindow = isDesktop && !isConfigPanel
