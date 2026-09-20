/**
 * O painel da engrenagem — a configuracao do tamanho de um menu.
 *
 * Roda numa janela sem moldura (`electron/config-panel.js`), carregando este
 * MESMO app com `#config`: por isso o painel tem as cores, as fontes e o
 * formulario de verdade, sem uma segunda copia de tela para manter.
 *
 * O caminho e o mesmo da primeira vez (endereco + chave + login do Cloudflare);
 * ao terminar, o painel se fecha e a janela da barra recarrega sozinha — quem
 * faz isso e o processo principal, ao salvar.
 */

import { useCallback, useEffect, useState } from 'react'
import { ConnectScreen, ConnectingCard, type ConnectPhase } from './ConnectScreen'
import { fetchAgents } from './bridge'
import { DEFAULT_BRIDGE_URL, setConfig } from './config'
import { desktop } from './desktop'

const GENERIC_ERROR = 'Não consegui falar com o bridge. Confira o endereço e a chave.'

export function ConfigPanel() {
  const api = desktop!

  const [loaded, setLoaded] = useState(false)
  const [phase, setPhase] = useState<ConnectPhase>('form')
  const [status, setStatus] = useState('sem chave')
  const [error, setError] = useState('')
  const [secretPersisted, setSecretPersisted] = useState(true)
  const [saved, setSaved] = useState({ bridgeUrl: DEFAULT_BRIDGE_URL, sharedSecret: '' })

  const close = useCallback(() => void api.closeConfigPanel(), [api])

  /* ------------------------------------------------- o que ja esta salvo -- */

  useEffect(() => {
    let alive = true

    void (async () => {
      const stored = await api.getConfig().catch(() => null)
      if (!alive) return

      if (stored?.bridgeUrl || stored?.sharedSecret) {
        setSaved({ bridgeUrl: stored.bridgeUrl || DEFAULT_BRIDGE_URL, sharedSecret: stored.sharedSecret })
        setSecretPersisted(stored.secretPersisted)
      }
      setLoaded(true)

      if (!stored?.bridgeUrl || !stored.sharedSecret) return

      // Confere em silencio so para dizer no cabecalho como esta a conexao.
      setConfig({ bridgeUrl: stored.bridgeUrl, sharedSecret: stored.sharedSecret })
      try {
        await fetchAgents()
        if (alive) setStatus('conectado')
      } catch {
        if (alive) setStatus('reconectar')
      }
    })()

    return () => {
      alive = false
    }
  }, [api])

  // A janela acompanha a altura do cartao: sem sobra embaixo quando o texto e
  // curto, sem recado escondido atras da borda quando ele cresce.
  useEffect(() => {
    const card = document.querySelector('.connect__card')
    if (!card) return
    const report = () => void api.resizeConfigPanel(Math.ceil(card.getBoundingClientRect().height))
    report()
    const observer = new ResizeObserver(report)
    observer.observe(card)
    return () => observer.disconnect()
  }, [api, loaded, phase])

  // Esc fecha, como em qualquer menu.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [close])

  /* ---------------------------------------------------------- conectar --- */

  const connect = useCallback(
    async (bridgeUrl: string, sharedSecret: string) => {
      setError('')
      setStatus('login aberto')
      setConfig({ bridgeUrl, sharedSecret })
      setPhase('login')

      const login = await api.openCloudflareLogin(bridgeUrl).catch((err: Error) => ({
        status: 'error' as const,
        message: err.message,
      }))

      if (login.status === 'cancelled') {
        setStatus('reconectar')
        setPhase('form')
        return
      }

      if (login.status !== 'ok') {
        setError(login.message || 'Não consegui abrir o login do Cloudflare.')
        setStatus('reconectar')
        setPhase('form')
        return
      }

      setPhase('validating')
      try {
        await fetchAgents()
      } catch {
        setError(GENERIC_ERROR)
        setStatus('reconectar')
        setPhase('form')
        return
      }

      // Salvar avisa o processo principal, que recarrega a janela da barra com
      // o endereco e a chave novos. Aqui so fechamos.
      await api.saveConfig({ bridgeUrl, sharedSecret }).catch(() => undefined)
      close()
    },
    [api, close],
  )

  if (!loaded) return <ConnectingCard label="Abrindo…" compact />

  return (
    <ConnectScreen
      defaultBridgeUrl={saved.bridgeUrl}
      defaultSecret={saved.sharedSecret}
      phase={phase}
      error={error}
      secretPersisted={secretPersisted}
      statusLabel={status}
      compact
      onConnect={(url, secret) => void connect(url, secret)}
      onCancel={close}
      cancelLabel="Fechar"
      footer={
        <>
          <button type="button" className="connect__link" onClick={() => void api.showMainWindow()}>
            Abrir a barra
          </button>
          <button type="button" className="connect__link" onClick={() => void api.quit()}>
            Sair do Calling
          </button>
        </>
      }
    />
  )
}
