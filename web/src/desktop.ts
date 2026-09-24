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

/**
 * O que o app lembra entre execucoes e nao e segredo.
 *
 * Mora no mesmo arquivo da conexao, num ramo separado — ver
 * `electron/config-store.js`.
 */
export interface AppPrefs {
  /** A barra fica por cima das janelas comuns. */
  alwaysOnTop: boolean
  /** O Calling sobe sozinho quando o Windows liga. */
  startWithWindows: boolean
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
  /** A pagina da barra montou: a janela pode aparecer. */
  mainReady(): Promise<void>
  /**
   * A janela da barra tem tamanho fixo e e transparente: o que nao e cartao
   * deixa o clique passar para quem esta embaixo. `true` = o cursor esta em
   * cima de algo da pagina, e o clique e nosso.
   */
  setMouseCapture(capture: boolean): Promise<void>
  /**
   * Comecou a arrastar. O retangulo e o do chip (ou do que estiver no lugar
   * dele), em coordenadas da pagina: e ele que fica preso ao cursor.
   */
  dragStart(rect: PanelAnchor): Promise<void>
  /** Soltou. */
  dragEnd(): Promise<void>
  /** Para que lado as coisas abrem agora. */
  getMainEdge(): Promise<MainEdgeState>
  /**
   * Ouve as mudancas disso (o chip passou da linha do meio da tela). Devolve a
   * funcao que para de ouvir.
   */
  onMainEdge(handler: (state: MainEdgeState) => void): () => void
  /**
   * A pagina ja virou o conteudo para o lado novo (e esta escondida): a janela
   * pode andar. Resolve depois que ela andou.
   */
  confirmMainEdge(token: number): Promise<void>
  /** As preferencias do app. */
  getPrefs(): Promise<AppPrefs>
  /** Muda uma preferencia; devolve o estado novo, ja aplicado na janela. */
  setPrefs(patch: Partial<AppPrefs>): Promise<AppPrefs>
  /** Ouve as mudancas feitas por fora (a bandeja). Devolve como parar. */
  onPrefs(handler: (prefs: AppPrefs) => void): () => void
  /** Fecha o painel de configuracao (chamado de dentro dele). */
  closeConfigPanel(): Promise<void>
  /** Traz a janela da barra para frente. */
  showMainWindow(): Promise<void>
  /** Encerra o Calling. */
  quit(): Promise<void>
}

/**
 * Para que lado as coisas da barra abrem — decidido pelo processo principal,
 * que sabe onde o chip esta na tela.
 *
 * `growDown`: o chip esta na metade de CIMA, entao a lista, os avisos e as
 * notificacoes abrem ABAIXO dele. `growRight`: esta na metade da ESQUERDA,
 * entao abrem a direita. A pagina troca o canto em que o CSS encosta o
 * conteudo (`.grow-down`, `.grow-right`) — ver `DesktopGate`.
 *
 * `swap` so vem numa TROCA durante o arrasto: a pagina se esconde, vira, e
 * devolve o numero pelo `confirmMainEdge` para a janela poder andar.
 */
export interface MainEdgeState {
  growDown: boolean
  growRight: boolean
  swap?: number
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
 * Ela nao tem moldura, e transparente e tem tamanho fixo em volta do chip,
 * entao o CSS de navegador (tela cheia, fundo, barra centralizada) nao serve
 * aqui. E a classe `desktop-main` no `body` que troca isso.
 */
export const isDesktopMainWindow = isDesktop && !isConfigPanel
