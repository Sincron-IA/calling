import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GeminiLiveOrbAdapter } from 'orb-ui/adapters'
import { fetchAgents, endCall as endCallOnBridge, type AgentSummary } from './bridge'
import { createCallAdapter } from './gemini'
import { agentColor, pickPreferredAgent, registerCall } from './agents'
import { CallingBar, type CallPhase } from './CallingBar'
import {
  approveIncoming,
  declineIncoming,
  dismissIncoming,
  subscribeIncomingCalls,
  type DeclineCause,
  type IncomingCall,
} from './incoming'

export function App() {
  const [agents, setAgents] = useState<AgentSummary[]>([])
  // Quem esta no chip: o ultimo agente com quem se falou. Uma ligacao por vez —
  // o bridge so aguenta uma sessao de voz.
  const [current, setCurrent] = useState<string>('')
  const [phase, setPhase] = useState<CallPhase>('idle')
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null)
  const [incoming, setIncoming] = useState<IncomingCall[]>([])
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
        setCurrent((slug) => slug || pickPreferredAgent(list))
      })
      .catch((err: Error) =>
        setError(`Nao consegui falar com o bridge: ${err.message}`),
      )
  }, [])

  // Chamadas recebidas (um agente ligando para o Luiz). A fonte ainda e a casca
  // em `incoming.ts` — o bridge nao tem esse canal.
  useEffect(() => subscribeIncomingCalls(setIncoming), [])

  const hangUp = useCallback(async () => {
    attemptRef.current += 1
    const live = adapterRef.current
    adapterRef.current = null
    if (live) await live.stop().catch(() => undefined)
    if (callIdRef.current) endCallOnBridge(callIdRef.current)
    callIdRef.current = ''
    setPhase('idle')
    setCallStartedAt(null)
    setWaiting(false)
  }, [])

  const startCall = useCallback(async (slug: string) => {
    const attempt = (attemptRef.current += 1)
    const isCurrent = () => attemptRef.current === attempt

    setError('')
    setLastReply('')
    setCurrent(slug)
    setPhase('calling')
    setCallStartedAt(null)
    registerCall(slug)

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
      setPhase('in-call')
      setCallStartedAt(Date.now())
    } catch (err) {
      if (!isCurrent()) return
      setError(err instanceof Error ? err.message : 'Nao consegui completar a ligacao.')
      setPhase('idle')
      setCallStartedAt(null)
      callIdRef.current = ''
    }
  }, [])

  /**
   * Ligar para alguem: se ja houver ligacao de pe, ela cai antes — nunca ficam
   * duas sessoes vivas.
   */
  const call = useCallback(
    async (slug: string) => {
      if (phase !== 'idle') await hangUp()
      await startCall(slug)
    },
    [phase, hangUp, startCall],
  )

  // Se a aba fechar no meio da ligacao, avisa o bridge para soltar a sessao.
  useEffect(() => {
    const onUnload = () => {
      if (callIdRef.current) endCallOnBridge(callIdRef.current)
    }
    window.addEventListener('pagehide', onUnload)
    return () => window.removeEventListener('pagehide', onUnload)
  }, [])

  /* ------------------------------------------ chamadas recebidas ---------- */

  /** Resolve o item na hora, sem abrir voz nenhuma. */
  const onApprove = useCallback((incomingCall: IncomingCall) => {
    approveIncoming(incomingCall)
    dismissIncoming(incomingCall.id)
  }, [])

  /** Atender: e uma ligacao normal com o agente que chamou. */
  const onAnswer = useCallback(
    (incomingCall: IncomingCall) => {
      dismissIncoming(incomingCall.id)
      void call(incomingCall.agentSlug)
    },
    [call],
  )

  /**
   * Recusar (no dedo ou por tempo esgotado). Quem trata isso do outro lado e
   * responsavel por mandar a mesma `reason` no Telegram — o front nao manda
   * mensagem nenhuma.
   */
  const onDecline = useCallback((incomingCall: IncomingCall, cause: DeclineCause) => {
    declineIncoming(incomingCall, cause)
    dismissIncoming(incomingCall.id)
  }, [])

  const colorOf = useCallback(
    (slug: string) => agentColor(agents.findIndex((a) => a.slug === slug)),
    [agents],
  )

  const currentName = useMemo(
    () => agents.find((a) => a.slug === current)?.name ?? '',
    [agents, current],
  )

  return (
    <main className="desk">
      <header className="desk__head">
        <h1 className="desk__title">Calling</h1>
        <p className="desk__subtitle">
          Os agentes da Sincron ficam a um toque — e ligam de volta quando trava.
        </p>
      </header>

      {/* O trabalho acontece em silencio: a barra e a unica coisa que fala. */}
      <section className="desk__log" aria-live="polite">
        {agents.length === 0 && !error && <p className="desk__note">Carregando agentes…</p>}
        {phase === 'in-call' && waiting && (
          <p className="desk__note">{currentName} está pensando…</p>
        )}
        {lastReply && <blockquote className="desk__reply">{lastReply}</blockquote>}
        {error && <p className="desk__error">{error}</p>}
      </section>

      <CallingBar
        agents={agents}
        colorOf={colorOf}
        currentSlug={current}
        phase={phase}
        callStartedAt={callStartedAt}
        incoming={incoming}
        onCall={(slug) => void call(slug)}
        onHangUp={() => void hangUp()}
        onApprove={onApprove}
        onAnswer={onAnswer}
        onDecline={onDecline}
      />
    </main>
  )
}
