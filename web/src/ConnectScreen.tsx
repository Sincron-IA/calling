/**
 * A tela da PRIMEIRA VEZ (e a da engrenagem).
 *
 * Duas caixas e um botao: endereco do bridge, chave do app, "Conectar ao
 * Cloudflare". O botao abre a MESMA tela de login que o Luiz ja usa hoje (por
 * email), so que dentro da janela do app — quem faz isso e o processo
 * principal do Electron (`electron/login-window.js`).
 *
 * Com `connected`, a mesma tela vira o oposto: nada de formulario, so a linha
 * que diz que esta tudo de pe. E o que o painel da engrenagem mostra quando a
 * conferencia com o bridge passou.
 *
 * Esta tela so aparece dentro do app de desktop. No navegador o app continua
 * lendo o `.env`, como sempre.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'

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
  /**
   * Ja esta tudo conectado — entao NAO ha formulario.
   *
   * Esta tela nasceu para a PRIMEIRA conexao e o painel da engrenagem a
   * reaproveitou para tambem mostrar o estado "ja conectado". Sem isto ele
   * pedia endereco, chave e "Conectar ao Cloudflare" de novo, com o selo
   * "conectado" logo ali em cima — duas coisas opostas na mesma tela.
   *
   * Quem decide e quem chama: so o painel, e so quando a conferencia com o
   * bridge passou. Sessao vencida ou sem chave continuam vendo o formulario,
   * que e o que resolve o problema deles.
   */
  connected?: boolean
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
  connected = false,
  footer,
}: ConnectScreenProps) {
  const [url, setUrl] = useState(defaultBridgeUrl)
  const [secret, setSecret] = useState(defaultSecret)

  /**
   * O clique JA conta como "estou indo".
   *
   * Quem sabe que a janela do Cloudflare abriu e o pai (`phase`), e isso demora
   * o tempo de uma ida ao processo principal. Nesse meio tempo o botao ficava
   * com a cara de quem nao ouviu nada — e a pessoa clicava de novo. Este estado
   * local cobre exatamente esse vao: ele acende no proprio `submit` e apaga
   * quando o pai devolve o formulario (deu errado, cancelou ou nem abriu).
   */
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (phase !== 'login') setSubmitting(false)
  }, [phase, error])

  // Enquanto validamos, a tela inteira vira o quadro 3 — nada para mexer.
  if (phase === 'validating') return <ConnectingCard compact={compact} />

  const waiting = phase === 'login'
  const busy = waiting || submitting
  const ready = url.trim().length > 0 && secret.trim().length > 0

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready || busy) return
    setSubmitting(true)
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

        {connected ? (
          /* Nada a fazer aqui: endereco, chave e sessao do Cloudflare estao de
             pe. Fica so a linha que diz isso — e um caminho discreto para
             refazer o login, que e o unico motivo de alguem querer o
             formulario de volta com tudo funcionando. */
          <>
            <p className="connect__hint">
              Conectado ao Cloudflare.{' '}
              {secretPersisted
                ? 'O endereço e a chave já estão guardados.'
                : 'O endereço já está guardado.'}
            </p>
            <button className="connect__link" type="submit" disabled={busy}>
              Conectar de novo
            </button>
          </>
        ) : (
          <>
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

            <button
              className="connect__button"
              type="submit"
              disabled={!ready || busy}
              aria-busy={busy || undefined}
              aria-live="polite"
            >
              {busy && <span className="connect__spinner" aria-hidden="true" />}
              {busy ? (waiting ? 'Esperando o login…' : 'Abrindo…') : 'Conectar ao Cloudflare'}
            </button>
          </>
        )}

        {waiting && (
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
