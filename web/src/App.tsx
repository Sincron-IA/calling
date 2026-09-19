import { useCallback, useEffect, useRef, useState } from 'react'
import { Orb } from 'orb-ui'
import type { GeminiLiveOrbAdapter } from 'orb-ui/adapters'
import { fetchAgents, endCall as endCallOnBridge, type AgentSummary } from './bridge'
import { createCallAdapter } from './gemini'

type Phase = 'idle' | 'calling' | 'in-call'

export function App() {
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [selected, setSelected] = useState<string>('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [adapter, setAdapter] = useState<GeminiLiveOrbAdapter | null>(null)
  const [lastReply, setLastReply] = useState('')
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState('')

  const callIdRef = useRef('')

  useEffect(() => {
    fetchAgents()
      .then((list) => {
        setAgents(list)
        setSelected((current) => current || list[0]?.slug || '')
      })
      .catch((err: Error) =>
        setError(`Nao consegui falar com o bridge: ${err.message}`),
      )
  }, [])

  const hangUp = useCallback(async () => {
    if (adapter) await adapter.stop().catch(() => undefined)
    if (callIdRef.current) endCallOnBridge(callIdRef.current)
    callIdRef.current = ''
    setAdapter(null)
    setPhase('idle')
    setWaiting(false)
  }, [adapter])

  const startCall = useCallback(async () => {
    if (!selected) return
    setError('')
    setLastReply('')
    setPhase('calling')

    const callId = crypto.randomUUID()
    callIdRef.current = callId

    const next = createCallAdapter(selected, callId, {
      onAgentReply: setLastReply,
      onWaitingChange: setWaiting,
      onError: setError,
    })

    try {
      await next.start()
      setAdapter(next)
      setPhase('in-call')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao consegui completar a ligacao.')
      setPhase('idle')
      callIdRef.current = ''
    }
  }, [selected])

  // Se a aba fechar no meio da ligacao, avisa o bridge para soltar a sessao.
  useEffect(() => {
    const onUnload = () => {
      if (callIdRef.current) endCallOnBridge(callIdRef.current)
    }
    window.addEventListener('pagehide', onUnload)
    return () => window.removeEventListener('pagehide', onUnload)
  }, [])

  const activeAgent = agents.find((a) => a.slug === selected)
  const inCall = phase === 'in-call'

  return (
    <main className="app">
      <header className="app__header">
        <h1 className="app__title">Calling</h1>
        <p className="app__subtitle">Fale com os agentes da Sincron</p>
      </header>

      <section className="picker" aria-label="Escolha o agente">
        {agents.length === 0 && !error && <p className="muted">Carregando agentes…</p>}
        {agents.map((agent) => (
          <button
            key={agent.slug}
            type="button"
            className={`picker__item${agent.slug === selected ? ' is-selected' : ''}`}
            onClick={() => setSelected(agent.slug)}
            disabled={phase !== 'idle'}
            aria-pressed={agent.slug === selected}
          >
            {agent.name}
          </button>
        ))}
      </section>

      <section className="stage">
        <Orb
          adapter={adapter ?? undefined}
          state={inCall ? undefined : phase === 'calling' ? 'connecting' : 'idle'}
          theme="bars"
          interactive={false}
          size={220}
          aria-label={`Visual da ligacao com ${activeAgent?.name ?? 'o agente'}`}
        />

        <p className="stage__status">
          {phase === 'idle' && activeAgent && `Pronto para ligar para ${activeAgent.name}`}
          {phase === 'calling' && 'Chamando…'}
          {inCall && !waiting && `Na linha com ${activeAgent?.name}`}
          {inCall && waiting && `${activeAgent?.name} está pensando…`}
        </p>

        {lastReply && <blockquote className="reply">{lastReply}</blockquote>}
        {error && <p className="error">{error}</p>}
      </section>

      <footer className="actions">
        {!inCall ? (
          <button
            type="button"
            className="btn btn--call"
            onClick={() => void startCall()}
            disabled={!selected || phase === 'calling'}
          >
            {phase === 'calling' ? 'Chamando…' : 'Ligar'}
          </button>
        ) : (
          <button type="button" className="btn btn--hangup" onClick={() => void hangUp()}>
            Desligar
          </button>
        )}
      </footer>
    </main>
  )
}
