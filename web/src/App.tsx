import { useCallback, useEffect, useRef, useState } from 'react'
import type { GeminiLiveOrbAdapter } from 'orb-ui/adapters'
import { fetchAgents, endCall as endCallOnBridge, type AgentSummary } from './bridge'
import { createCallAdapter } from './gemini'
import { AgentAvatar, agentColor, type AvatarStatus } from './AgentAvatar'

type Phase = 'idle' | 'calling' | 'in-call'

export function App() {
  const [agents, setAgents] = useState<AgentSummary[]>([])
  // Quem esta no centro da tela: o ultimo agente com quem se falou (ou o primeiro
  // da lista). Uma ligacao por vez — o bridge so aguenta uma sessao de voz.
  const [focused, setFocused] = useState<string>('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [adapter, setAdapter] = useState<GeminiLiveOrbAdapter | null>(null)
  const [lastReply, setLastReply] = useState('')
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState('')

  const adapterRef = useRef<GeminiLiveOrbAdapter | null>(null)
  const callIdRef = useRef('')
  // Cada tentativa de ligacao ganha um numero. Se ele mudar no meio do caminho,
  // e porque o Luiz ja desligou ou trocou de agente: a tentativa antiga se apaga.
  const attemptRef = useRef(0)

  useEffect(() => {
    fetchAgents()
      .then((list) => {
        setAgents(list)
        setFocused((current) => current || list[0]?.slug || '')
      })
      .catch((err: Error) =>
        setError(`Nao consegui falar com o bridge: ${err.message}`),
      )
  }, [])

  const hangUp = useCallback(async () => {
    attemptRef.current += 1
    const live = adapterRef.current
    adapterRef.current = null
    if (live) await live.stop().catch(() => undefined)
    if (callIdRef.current) endCallOnBridge(callIdRef.current)
    callIdRef.current = ''
    setAdapter(null)
    setPhase('idle')
    setWaiting(false)
  }, [])

  const startCall = useCallback(async (slug: string) => {
    const attempt = (attemptRef.current += 1)
    const isCurrent = () => attemptRef.current === attempt

    setError('')
    setLastReply('')
    setFocused(slug)
    setPhase('calling')

    const callId = crypto.randomUUID()
    callIdRef.current = callId

    const next = createCallAdapter(slug, callId, {
      onAgentReply: (text) => isCurrent() && setLastReply(text),
      onWaitingChange: (value) => isCurrent() && setWaiting(value),
      onError: (message) => isCurrent() && setError(message),
    })

    try {
      await next.start()
      if (!isCurrent()) {
        // Desligaram enquanto a sessao subia: fecha a que acabou de nascer.
        await next.stop().catch(() => undefined)
        endCallOnBridge(callId)
        return
      }
      adapterRef.current = next
      setAdapter(next)
      setPhase('in-call')
    } catch (err) {
      if (!isCurrent()) return
      setError(err instanceof Error ? err.message : 'Nao consegui completar a ligacao.')
      setPhase('idle')
      callIdRef.current = ''
    }
  }, [])

  /**
   * Clicar num avatar e a interacao principal: atende/liga, cancela ou desliga.
   * Clicar em OUTRO agente no meio de uma ligacao encerra a atual antes de abrir
   * a nova — nunca ficam duas de pe.
   */
  const onAvatarClick = useCallback(
    async (slug: string) => {
      const busy = phase !== 'idle'
      if (busy && slug === focused) {
        await hangUp()
        return
      }
      if (busy) await hangUp()
      await startCall(slug)
    },
    [phase, focused, hangUp, startCall],
  )

  // Se a aba fechar no meio da ligacao, avisa o bridge para soltar a sessao.
  useEffect(() => {
    const onUnload = () => {
      if (callIdRef.current) endCallOnBridge(callIdRef.current)
    }
    window.addEventListener('pagehide', onUnload)
    return () => window.removeEventListener('pagehide', onUnload)
  }, [])

  const activeAgent = agents.find((a) => a.slug === focused)
  const inCall = phase === 'in-call'

  const statusOf = (slug: string): AvatarStatus => {
    if (slug !== focused || phase === 'idle') return 'idle'
    return phase === 'in-call' ? 'in-call' : 'ringing'
  }
  const colorOf = (slug: string) => agentColor(agents.findIndex((a) => a.slug === slug))
  const queue = agents.filter((a) => a.slug !== focused)

  return (
    <main className="app">
      <header className="app__header">
        <h1 className="app__title">Calling</h1>
        <p className="app__subtitle">Fale com os agentes da Sincron</p>
      </header>

      <section className="stage">
        {agents.length === 0 && !error && <p className="muted">Carregando agentes…</p>}

        {activeAgent && (
          <AgentAvatar
            agent={activeAgent}
            color={colorOf(activeAgent.slug)}
            status={statusOf(activeAgent.slug)}
            variant="main"
            adapter={adapter ?? undefined}
            waiting={waiting}
            onClick={() => void onAvatarClick(activeAgent.slug)}
          />
        )}

        <p className="stage__status">
          {phase === 'idle' && activeAgent && `Toque no avatar para ligar para ${activeAgent.name}`}
          {phase === 'calling' && `Chamando ${activeAgent?.name}…`}
          {inCall && !waiting && `Na linha com ${activeAgent?.name}`}
          {inCall && waiting && `${activeAgent?.name} está pensando…`}
        </p>

        {lastReply && <blockquote className="reply">{lastReply}</blockquote>}
        {error && <p className="error">{error}</p>}
      </section>

      {queue.length > 0 && (
        <section className="queue" aria-label="Outros agentes">
          {queue.map((agent) => (
            <AgentAvatar
              key={agent.slug}
              agent={agent}
              color={colorOf(agent.slug)}
              status="idle"
              variant="queued"
              onClick={() => void onAvatarClick(agent.slug)}
            />
          ))}
        </section>
      )}

      <footer className="actions">
        {phase === 'idle' ? (
          <p className="hint">Uma ligacao por vez: tocar em outro avatar troca de agente.</p>
        ) : (
          <button type="button" className="btn btn--hangup" onClick={() => void hangUp()}>
            {inCall ? 'Desligar' : 'Cancelar'}
          </button>
        )}
      </footer>
    </main>
  )
}
