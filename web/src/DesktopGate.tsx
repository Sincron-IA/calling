/**
 * O porteiro do app de desktop.
 *
 * Ele e quem decide o que a janela mostra:
 *
 *   1. primeira vez        -> a tela de conexao (endereco + chave)
 *   2. clicou no botao     -> a janela de login do Cloudflare abre por cima
 *   3. voltou do login     -> "Conectando…" enquanto conferimos com o bridge
 *   4. deu certo           -> o app de sempre, com a barra do Calling
 *
 * Depois disso a configuracao nao volta mais como tela cheia: a engrenagem no
 * canto abre o painel compacto (`ConfigPanel`, numa janela sem moldura).
 *
 * Nas vezes seguintes o passo 1 nem aparece: a configuracao esta salva e o
 * cookie do Cloudflare continua na sessao do Electron, entao o app confere em
 * silencio e cai direto no passo 4. So se a sessao do Access tiver expirado e
 * que a tela volta — ja preenchida, faltando so clicar no botao.
 *
 * Este arquivo NAO existe no navegador: o `main.tsx` so o monta quando
 * `window.callingDesktop` esta presente.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { App } from './App'
import { ConnectScreen, ConnectingCard, type ConnectPhase } from './ConnectScreen'
import { fetchAgents } from './bridge'
import { DEFAULT_BRIDGE_URL, setConfig } from './config'
import { resetIncomingStream } from './incoming'
import { desktop } from './desktop'

type Phase = 'boot' | ConnectPhase

const GENERIC_ERROR = 'Não consegui falar com o bridge. Confira o endereço e a chave.'

export function DesktopGate() {
  const api = desktop!

  const [phase, setPhase] = useState<Phase>('boot')
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [secretPersisted, setSecretPersisted] = useState(true)
  const [saved, setSaved] = useState({ bridgeUrl: DEFAULT_BRIDGE_URL, sharedSecret: '' })
  // Muda a cada conexao bem-sucedida: forca o App a nascer de novo lendo a
  // configuracao nova (lista de agentes, fluxo de chamadas recebidas).
  const [session, setSession] = useState(0)
  // A barra encostou na borda direita da tela? Entao a engrenagem desce.
  const [rightEdge, setRightEdge] = useState(false)
  const gearRef = useRef<HTMLButtonElement>(null)

  /* --------------------------------------------------- abertura do app ---- */

  useEffect(() => {
    let alive = true

    void (async () => {
      const stored = await api.getConfig().catch(() => null)
      if (!alive) return

      if (stored) {
        setSaved({ bridgeUrl: stored.bridgeUrl, sharedSecret: stored.sharedSecret })
        setSecretPersisted(stored.secretPersisted)
      }

      // Sem endereco ou sem chave nao ha o que tentar: e a primeira vez.
      if (!stored?.bridgeUrl || !stored.sharedSecret) {
        setPhase('form')
        return
      }

      setConfig({ bridgeUrl: stored.bridgeUrl, sharedSecret: stored.sharedSecret })
      try {
        // A mesma pergunta de sempre ao bridge: se ela passa, o cookie do
        // Access e a chave do app estao os dois valendo.
        await fetchAgents()
        if (!alive) return
        setConnected(true)
      } catch {
        if (!alive) return
        setNotice('A sessão do Cloudflare expirou. É só conectar de novo.')
        setPhase('form')
      }
    })()

    return () => {
      alive = false
    }
  }, [api])

  /* --------------------------------------------- a janela veste o conteudo */

  /**
   * A janela nao tem moldura nem tamanho proprio: ela e do tamanho do que esta
   * dentro dela. O `#root` e quem sabe isso (no desktop ele encolhe ate o
   * conteudo, ver `.desktop-main` no CSS) — aqui so contamos para o processo
   * principal, que reancora a janela no canto.
   *
   * Um observador basta para tudo: a tela de conexao, a barra, o chip que
   * cresce no hover e o cartao de chamada recebida passam todos por aqui.
   */
  useEffect(() => {
    const root = document.getElementById('root')
    if (!root) return

    const report = () => {
      const rect = root.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return
      void api.resizeMainWindow({
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height),
      })
    }

    report()
    const observer = new ResizeObserver(report)
    observer.observe(root)
    return () => observer.disconnect()
  }, [api])

  /* ------------------------------------ a engrenagem ao lado ou embaixo --- */

  /**
   * Quem sabe ONDE a janela esta e o processo principal (ele e quem a ancora no
   * canto). Perguntamos uma vez ao nascer e depois ficamos ouvindo: arrastar a
   * barra ate a borda direita, ou trocar a resolucao, muda a resposta.
   */
  useEffect(() => {
    let alive = true

    void api
      .getMainEdge()
      .then((state) => {
        if (alive && state) setRightEdge(state.rightEdge)
      })
      .catch(() => undefined)

    const stop = api.onMainEdge((state) => {
      if (state) setRightEdge(state.rightEdge)
    })

    return () => {
      alive = false
      stop?.()
    }
  }, [api])

  /* ------------------------------------------------ conectar de verdade -- */

  const connect = useCallback(
    async (bridgeUrl: string, sharedSecret: string) => {
      setError('')
      setNotice('')
      setConfig({ bridgeUrl, sharedSecret })
      setPhase('login')

      // SILENCIO NO BRIDGE ANTES DE COMECAR.
      //
      // O fluxo SSE das chamadas recebidas pode estar pendurado no endereco
      // antigo e, com a sessao do Access vencida, cada tentativa dele bate no
      // endpoint de login do Cloudflare — no MESMO pote de cookies da janela de
      // login, porque e tudo a sessao padrao do Electron. Se isso acontece
      // entre "me manda o codigo" e "aqui esta o codigo", o Access ja esta em
      // outra tentativa de login e responde que o codigo expirou. Fechamos o
      // fluxo aqui, ANTES de abrir a janela; ele volta sozinho no `setSession`
      // la embaixo, ja com a configuracao nova.
      resetIncomingStream()

      // Abre (ou reaproveita) a sessao do Cloudflare Access. Se o cookie ainda
      // estiver de pe, isso volta na hora e nenhuma janela chega a aparecer.
      const login = await api.openCloudflareLogin(bridgeUrl).catch((err: Error) => ({
        status: 'error' as const,
        message: err.message,
      }))

      if (login.status === 'cancelled') {
        // Fechou a janela de login: volta para o formulario, sem drama.
        setPhase('form')
        return
      }

      if (login.status !== 'ok') {
        setError(login.message || 'Não consegui abrir o login do Cloudflare.')
        setPhase('form')
        return
      }

      setPhase('validating')
      try {
        await fetchAgents()
      } catch {
        setError(GENERIC_ERROR)
        setPhase('form')
        return
      }

      const result = await api
        .saveConfig({ bridgeUrl, sharedSecret })
        .catch(() => ({ secretPersisted: false }))

      setSecretPersisted(result.secretPersisted)
      setSaved({ bridgeUrl, sharedSecret })
      setSession((n) => n + 1)
      setConnected(true)
      setPhase('form')
    },
    [api],
  )

  /* -------------------------------------------------- painel da engrenagem */

  /**
   * A engrenagem manda o proprio retangulo junto: e a ancora do painel. Quem
   * decide se ele desce ou sobe e o processo principal, olhando o espaco que
   * sobra na tela (no Windows, com a barra de tarefas embaixo, ele sobe).
   */
  const openConfigPanel = useCallback(() => {
    const rect = gearRef.current?.getBoundingClientRect()
    void api.openConfigPanel(
      rect ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : null,
    )
  }, [api])

  /* ------------------------------------------------------------ desenho -- */

  if (!connected) {
    return phase === 'boot' ? (
      <ConnectingCard />
    ) : (
      <ConnectScreen
        defaultBridgeUrl={saved.bridgeUrl}
        defaultSecret={saved.sharedSecret}
        phase={phase}
        error={error}
        notice={notice}
        secretPersisted={secretPersisted}
        onConnect={(url, secret) => void connect(url, secret)}
      />
    )
  }

  /**
   * Barra e engrenagem moram no MESMO bloco de proposito: e nele que o `:hover`
   * (e o `:focus-within`, para quem anda de Tab) acende a engrenagem. Em repouso
   * ela fica invisivel — a barra sozinha, como o Luiz pediu.
   *
   * `shell--stacked` e a barra colada na borda direita: a engrenagem desce para
   * baixo da barra em vez de ficar espremida contra o canto da tela.
   */
  return (
    <div className={`shell${rightEdge ? ' shell--stacked' : ''}`}>
      <App key={session} />

      <button
        ref={gearRef}
        className="gear"
        type="button"
        title="Conexão"
        aria-label="Conexão"
        onClick={openConfigPanel}
      >
        <GearIcon />
      </button>
    </div>
  )
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
      />
    </svg>
  )
}
