/**
 * A tela da PRIMEIRA VEZ (e a da engrenagem).
 *
 * Duas caixas e um botao: endereco do bridge, chave do app, "Conectar ao
 * Cloudflare". O botao abre a MESMA tela de login que o Luiz ja usa hoje (por
 * email), so que dentro da janela do app — quem faz isso e o processo
 * principal do Electron (`electron/login-window.js`).
 *
 * Esta tela so aparece dentro do app de desktop. No navegador o app continua
 * lendo o `.env`, como sempre.
 */

import { useState, type FormEvent, type ReactNode } from 'react'

/** Em que passo do caminho estamos (os quadros 1, 2 e 3 do desenho). */
export type ConnectPhase = 'form' | 'login' | 'validating'

export interface ConnectScreenProps {
  defaultBridgeUrl: string
  defaultSecret: string
  phase: ConnectPhase
  /** Erro em vermelho, com o formulario ainda ali para corrigir e tentar de novo. */
  error?: string
  /** Aviso calmo (ex.: a sessao do Cloudflare expirou). */
  notice?: string
  /** A maquina nao tem cofre: a chave nao sobrevive ao fechar do app. */
  secretPersisted?: boolean
  onConnect(bridgeUrl: string, sharedSecret: string): void
  /** So existe quando a tela foi aberta pela engrenagem, com o app ja ligado. */
  onCancel?: () => void
  /** Texto do botao de voltar (no painel ele fecha em vez de voltar). */
  cancelLabel?: string
  /** Dentro do painel da engrenagem: sem tela cheia, do tamanho de um menu. */
  compact?: boolean
  /** Uma palavra no canto do cabecalho: "conectado", "sem chave"… */
  statusLabel?: string
  /** Linha de acoes no pe do cartao (so o painel usa). */
  footer?: ReactNode
}

/** O quadro 3 do desenho: uma linha e um girinho, nada mais. */
export function ConnectingCard({
  label = 'Conectando…',
  compact = false,
}: {
  label?: string
  compact?: boolean
}) {
  return (
    <div className={`connect${compact ? ' connect--panel' : ''}`}>
      <div className="connect__card connect__card--status" role="status" aria-live="polite">
        <span className="connect__spinner" aria-hidden="true" />
        <span>{label}</span>
      </div>
    </div>
  )
}

export function ConnectScreen({
  defaultBridgeUrl,
  defaultSecret,
  phase,
  error,
  notice,
  secretPersisted = true,
  onConnect,
  onCancel,
  cancelLabel = 'Voltar',
  compact = false,
  statusLabel,
  footer,
}: ConnectScreenProps) {
  const [url, setUrl] = useState(defaultBridgeUrl)
  const [secret, setSecret] = useState(defaultSecret)

  // Enquanto validamos, a tela inteira vira o quadro 3 — nada para mexer.
  if (phase === 'validating') return <ConnectingCard compact={compact} />

  const busy = phase === 'login'
  const ready = url.trim().length > 0 && secret.trim().length > 0

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready || busy) return
    onConnect(url.trim(), secret)
  }

  return (
    <div className={`connect${compact ? ' connect--panel' : ''}`}>
      <form className="connect__card" onSubmit={submit}>
        <header className="connect__head">
          <span className="connect__dot" aria-hidden="true" />
          <h1 className="connect__title">Calling</h1>
          {statusLabel && <span className="connect__state">{statusLabel}</span>}
        </header>

        <label className="connect__field">
          <span className="connect__label">Endereço do bridge</span>
          <input
            className="connect__input"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://calling-bridge.sincronia.digital"
            value={url}
            disabled={busy}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>

        <label className="connect__field">
          <span className="connect__label">Chave do app</span>
          <input
            className="connect__input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="••••••••••••••••"
            value={secret}
            disabled={busy}
            onChange={(e) => setSecret(e.target.value)}
          />
        </label>

        <button className="connect__button" type="submit" disabled={!ready || busy}>
          {busy && <span className="connect__spinner" aria-hidden="true" />}
          {busy ? 'Esperando o login…' : 'Conectar ao Cloudflare'}
        </button>

        {busy && (
          <p className="connect__hint" role="status">
            Abri a janela do Cloudflare. Entre com o seu email por lá — quando terminar, eu sigo
            sozinho. Fechar aquela janela cancela.
          </p>
        )}

        {!busy && notice && <p className="connect__hint">{notice}</p>}

        {!busy && error && (
          <p className="connect__error" role="alert">
            {error}
          </p>
        )}

        {!secretPersisted && (
          <p className="connect__hint">
            Este sistema não tem cofre de senhas: a chave não fica guardada, vou pedir de novo na
            próxima vez. O endereço fica.
          </p>
        )}

        {onCancel && (
          <button className="connect__back" type="button" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
        )}

        {footer && <div className="connect__footer">{footer}</div>}
      </form>
    </div>
  )
}
