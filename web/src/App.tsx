import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GeminiLiveOrbAdapter } from 'orb-ui/adapters'
import {
  fetchAgents,
  endCall as endCallOnBridge,
  fetchAvatar,
  sendMessage,
  BridgeUnreachableError,
  type AgentSummary,
} from './bridge'
import { createCallAdapter } from './gemini'
import { agentColor, pickPreferredAgent, registerCall } from './agents'
import {
  CallingBar,
  type CallPhase,
  type ComposeState,
  type ReplyBubble,
} from './CallingBar'
import {
  answerIncoming,
  approveIncoming,
  declineIncoming,
  dismissIncoming,
  subscribeAgentsChanged,
  subscribeIncomingCalls,
  type DeclineCause,
  type IncomingCall,
} from './incoming'

export interface AppProps {
  /**
   * Recado para mostrar assim que o app nasce — hoje so o "conectou" do
   * `DesktopGate`. Ele chega por prop (e nao de dentro daqui) porque quem sabe
   * que houve uma conexao DELIBERADA e o porteiro: a reconexao silenciosa da
   * abertura do app nao manda nada, de proposito.
   */
  readyNotice?: string
}

export function App({ readyNotice = '' }: AppProps) {
  const [agents, setAgents] = useState<AgentSummary[]>([])
  // Quem esta no chip: o ultimo agente com quem se falou. Uma ligacao por vez —
  // o bridge so aguenta uma sessao de voz.
  const [current, setCurrent] = useState<string>('')
  const [phase, setPhase] = useState<CallPhase>('idle')
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null)
  const [incoming, setIncoming] = useState<IncomingCall[]>([])
  const [lastReply, setLastReply] = useState('')
  const [notice, setNotice] = useState(readyNotice)
  // O campo de escrever e o balao. Os dois vivem SO em memoria: fechou o app,
  // acabou — nao ha historico em disco nem em localStorage, de proposito.
  const [compose, setCompose] = useState<ComposeState>({
    agentSlug: '',
    draft: '',
    busy: false,
  })
  const [reply, setReply] = useState<ReplyBubble | null>(null)
  // Imagem de cada agente, ja baixada e virada em URL local. Vazio = ele nao
  // tem imagem, e o disco fica com a inicial.
  const [avatars, setAvatars] = useState<Record<string, string>>({})
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
        // A falha de rede ja vem com o texto pronto (e com o caminho de volta):
        // repetir "Nao consegui falar com o bridge" em cima dela so atrapalha.
        setError(
          err instanceof BridgeUnreachableError
            ? err.message
            : `Nao consegui falar com o bridge: ${err.message}`,
        ),
      )
  }, [])

  /**
   * As imagens dos agentes.
   *
   * Nao da para apontar um `<img src>` para o bridge (a rota pede o cabecalho
   * `Authorization`), entao baixamos e viramos blob. As URLs sao NOSSAS: se
   * nao forem soltas, cada nova lista deixa um blob preso na memoria.
   *
   * O `avatarVersion` (mtime do arquivo na VPS) entra na chave: quando o agente
   * troca a propria imagem, a versao muda e a figura e buscada de novo.
   */
  useEffect(() => {
    const wanted = agents.filter((agent) => (agent.avatarVersion ?? 0) > 0)
    if (wanted.length === 0) {
      setAvatars({})
      return
    }

    let alive = true
    const made: string[] = []

    void Promise.all(
      wanted.map(async (agent) => {
        try {
          const url = await fetchAvatar(agent.slug, agent.avatarVersion ?? 0)
          // CHEGOU TARDE: a lista ja mudou e a limpeza ja rodou. Este blob nao
          // esta em `made`, entao ninguem mais o soltaria — solta aqui mesmo.
          if (!alive) {
            URL.revokeObjectURL(url)
            return null
          }
          made.push(url)
          return [agent.slug, url] as const
        } catch {
          // Agente sem imagem servivel continua com a inicial: nao e erro.
          return null
        }
      }),
    ).then((pairs) => {
      if (!alive) return
      setAvatars(Object.fromEntries(pairs.filter(Boolean) as (readonly [string, string])[]))
    })

    return () => {
      alive = false
      made.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [agents])

  // Chamadas recebidas (um agente ligando para o Luiz): chegam do bridge por
  // SSE. A fila da tela e sempre a que o servidor manda.
  useEffect(() => subscribeIncomingCalls(setIncoming), [])

  /* A cara de alguem mudou na VPS: o agente reescreveu o proprio arquivo, ou o
     painel daqui gravou. Em vez de confiar no que o app ja tem, perguntamos a
     lista de novo — a resposta do bridge e a verdade. */
  useEffect(
    () =>
      subscribeAgentsChanged(() => {
        void fetchAgents()
          .then(setAgents)
          .catch(() => undefined)
      }),
    [],
  )

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

  /* ------------------------------------------------ recado escrito -------- */

  /** Abre o campo endereçado a um agente, sem tocar na ligacao em curso. */
  const write = useCallback((slug: string) => {
    setCompose({ agentSlug: slug, draft: '', busy: false })
  }, [])

  const closeCompose = useCallback(() => {
    setCompose({ agentSlug: '', draft: '', busy: false })
  }, [])

  /**
   * Manda o recado.
   *
   * Erro NAO come o rascunho: o texto continua no campo para uma segunda
   * tentativa. Resposta boa limpa o campo e deixa ele aberto — quem escreveu
   * uma vez costuma escrever de novo.
   */
  const sendCompose = useCallback(async () => {
    const slug = compose.agentSlug
    const text = compose.draft.trim()
    if (!slug || !text || compose.busy) return

    setCompose((state) => ({ ...state, busy: true }))
    try {
      const answer = await sendMessage(slug, text)
      setReply({ agentSlug: slug, text: answer })
      setCompose((state) =>
        // Trocou de agente no meio do caminho: o rascunho novo e dele, nao
        // deste envio — nao apagamos nada.
        state.agentSlug === slug ? { ...state, draft: '', busy: false } : state,
      )
    } catch (err) {
      setReply({
        agentSlug: slug,
        text: err instanceof Error ? err.message : 'Nao consegui falar com o bridge.',
        isError: true,
      })
      setCompose((state) => ({ ...state, busy: false }))
    }
  }, [compose.agentSlug, compose.draft, compose.busy])

  /* ------------------------------------------ chamadas recebidas ---------- */

  /** Resolve o item na hora, sem abrir voz nenhuma. */
  const onApprove = useCallback((incomingCall: IncomingCall) => {
    approveIncoming(incomingCall)
    dismissIncoming(incomingCall.id)
  }, [])

  /**
   * Atender: avisa o agente que ele foi atendido (o `/api/ring` dele volta com
   * `answered`) e abre uma ligacao normal com quem chamou.
   */
  const onAnswer = useCallback(
    (incomingCall: IncomingCall) => {
      answerIncoming(incomingCall)
      dismissIncoming(incomingCall.id)
      void call(incomingCall.agentSlug)
    },
    [call],
  )

  /**
   * Recusar (no dedo ou por tempo esgotado). Quem trata isso do outro lado e o
   * agente que ligou: e ele quem decide avisar no Telegram — o front nao manda
   * mensagem nenhuma.
   */
  const onDecline = useCallback((incomingCall: IncomingCall, cause: DeclineCause) => {
    declineIncoming(incomingCall, cause)
    dismissIncoming(incomingCall.id)
  }, [])

  /**
   * A cor vem do BRIDGE — que a leu do arquivo de identidade do agente, com o
   * `agents.json` por baixo. A paleta local so cobre quem nao tem cor em lugar
   * nenhum; ela nao decide mais nada.
   */
  const colorOf = useCallback(
    (slug: string) => {
      const index = agents.findIndex((a) => a.slug === slug)
      return agents[index]?.color || agentColor(index)
    },
    [agents],
  )

  const avatarOf = useCallback((slug: string) => avatars[slug] ?? '', [avatars])

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
        avatarOf={avatarOf}
        currentSlug={current}
        phase={phase}
        callStartedAt={callStartedAt}
        incoming={incoming}
        onCall={(slug) => void call(slug)}
        onHangUp={() => void hangUp()}
        onApprove={onApprove}
        onAnswer={onAnswer}
        onDecline={onDecline}
        notice={notice}
        onNoticeDone={() => setNotice('')}
        onWrite={write}
        onAgentsUpdated={setAgents}
        compose={compose}
        onDraftChange={(draft) => setCompose((state) => ({ ...state, draft }))}
        onSendMessage={() => void sendCompose()}
        onCloseCompose={closeCompose}
        reply={reply}
        onReplyDone={() => setReply(null)}
      />
    </main>
  )
}
