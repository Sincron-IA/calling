import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { XIcon } from 'lucide-react'
import { AgentAvatar } from './AgentAvatar'
import { isDesktopMainWindow } from './desktop'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchAgents,
  endCall as endCallOnBridge,
  fetchAvatar,
  sendMessage,
  BridgeUnreachableError,
  type AgentSummary,
} from './bridge'
import {
  createVoiceAdapter,
  readVoiceProvider,
  saveVoiceProvider,
  type CallAdapter,
  type VoiceProvider,
} from './voice'
import { agentColor, pickPreferredAgent, registerCall } from './agents'
import {
  CallingBar,
  formatClock,
  type CallingBarProps,
  type AgentChange,
  type CallPhase,
  type ComposeState,
  type QueuedMessage,
  type ReplyBubble,
} from './CallingBar'
import {
  answerIncoming,
  approveIncoming,
  declineIncoming,
  dismissIncoming,
  subscribeAgentMessages,
  subscribeAgentsChanged,
  subscribeIncomingCalls,
  subscribeMissedCalls,
  type DeclineCause,
  type IncomingCall,
  type LateAction,
} from './incoming'

/**
 * Quantos recados empurrados a fila guarda. Passou disso, o mais velho sai.
 * Toque esperando decisao nao conta aqui e nunca sai por falta de espaco.
 */
const MESSAGE_QUEUE_MAX = 30

/** Poe uma notificacao nova na frente, sem nunca empurrar um pedido pendente para fora. */
function withNotification(queue: QueuedMessage[], item: QueuedMessage): QueuedMessage[] {
  let room = MESSAGE_QUEUE_MAX
  return [item, ...queue].filter((entry) => entry.call || room-- > 0)
}

/**
 * O recado que leva ao agente uma decisao que chegou atrasada.
 *
 * O `/api/ring` dele ja voltou com `no_answer`, entao a resposta vai pelo mesmo
 * caminho de um recado escrito (`/api/message`): a sessao de recados dele
 * recebe, a thread do Telegram ganha o eco, e a sessao viva fica sabendo. O
 * texto diz a que pedido se refere — ele pode ter feito outros desde entao.
 */
function lateDecisionText(call: IncomingCall, action: 'approve' | 'decline', reply?: string): string {
  const verdict = action === 'approve' ? 'Aprovado' : 'Recusado'
  const head = `${verdict} — sobre o seu toque das ${formatClock(call.receivedAt)} ("${call.reason}"), que eu não vi a tempo.`
  return reply ? `${head}\n\n${reply}` : head
}

/** Quanto tempo depois de salvar por aqui o SSE ainda e "eco nosso". */
const OWN_SAVE_WINDOW_MS = 4000

/**
 * O que mudou na cara de um agente entre duas listas do bridge. Um recado so,
 * do primeiro agente que mudou — mais de um ao mesmo tempo e raro, e a lista
 * ja mostra todos.
 */
function describeChange(before: AgentSummary[], after: AgentSummary[]): AgentChange | null {
  for (const next of after) {
    const index = before.findIndex((a) => a.slug === next.slug)
    if (index < 0) continue
    const prev = before[index]
    const changed: string[] = []
    if (prev.name !== next.name) changed.push('trocou de nome')
    if ((prev.color ?? '') !== (next.color ?? '')) changed.push('trocou de cor')
    if ((prev.avatarVersion ?? 0) !== (next.avatarVersion ?? 0)) changed.push('trocou a imagem')
    if (changed.length === 0) continue
    return {
      slug: next.slug,
      what: changed.length === 1 ? changed[0] : 'mudou a aparência',
      beforeName: prev.name,
      beforeColor: prev.color || agentColor(index),
    }
  }
  return null
}

export interface AppProps {
  /**
   * Recado para mostrar assim que o app nasce — hoje so o "conectou" do
   * `DesktopGate`. Ele chega por prop (e nao de dentro daqui) porque quem sabe
   * que houve uma conexao DELIBERADA e o porteiro: a reconexao silenciosa da
   * abertura do app nao manda nada, de proposito.
   */
  readyNotice?: string
  /** Abrir o painel de conexao — a engrenagem mora no cabecalho da lista. */
  onOpenConfig?: CallingBarProps['onOpenConfig']
}

export function App({ readyNotice = '', onOpenConfig }: AppProps) {
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
  // Um agente mudou a si mesmo pela VPS: o antes -> depois acima da barra.
  const [change, setChange] = useState<AgentChange | null>(null)
  /* Os recados que os agentes empurraram, do mais novo para o mais velho.
     O balao mostra o novo e sai sozinho; esta fila e o que sobra para quem
     estava ocupado. So memoria: fechou o app, acabou — a mesma regra do resto
     da conversa. */
  const [messages, setMessages] = useState<QueuedMessage[]>([])
  // A lista que a tela mostra agora, para comparar com a que o SSE anuncia.
  const agentsRef = useRef<AgentSummary[]>([])
  // Quando o painel daqui salvou pela ultima vez: o SSE dessa gravacao nao e
  // "o agente mudou sozinho", e nao vira recado.
  const ownSaveAtRef = useRef(0)
  // Imagem de cada agente, ja baixada e virada em URL local. Vazio = ele nao
  // tem imagem, e o disco fica com a inicial.
  const [avatars, setAvatars] = useState<Record<string, string>>({})
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState('')

  const adapterRef = useRef<CallAdapter | null>(null)
  // Camada de voz da PROXIMA ligacao. Padrao Gemini; a escolha fica no
  // localStorage. A ligacao em curso nao muda — so a seguinte.
  const [voiceProvider, setVoiceProvider] = useState<VoiceProvider>(readVoiceProvider)
  const voiceProviderRef = useRef(voiceProvider)
  const changeVoiceProvider = useCallback((next: VoiceProvider) => {
    voiceProviderRef.current = next
    setVoiceProvider(next)
    saveVoiceProvider(next)
  }, [])
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

  /* A ULTIMA NOTIFICACAO ASSUME O CHIP.
     O Flow mandou recado: e o Flow que aparece no chip — avatar, nome, e o
     avatar abre o campo endereçado a ele. Duas excecoes, pelo mesmo motivo
     (o chip nao pode desdizer o que esta acontecendo): no meio de uma ligacao
     o chip e de quem esta na linha, e com o campo aberto ele e de quem esta
     recebendo o texto. Os dois sao lidos por ref porque as assinaturas do SSE
     nascem uma vez so. */
  const phaseRef = useRef(phase)
  const composeForRef = useRef(compose.agentSlug)
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])
  useEffect(() => {
    composeForRef.current = compose.agentSlug
  }, [compose.agentSlug])

  const followNotification = useCallback((slug: string) => {
    if (phaseRef.current !== 'idle' || composeForRef.current) return
    setCurrent(slug)
  }, [])

  /* O agente falou primeiro: recado empurrado pela sessao viva dele, sem que o
     Luiz tenha escrito nada. Cai no MESMO balao da resposta — e a mesma coisa
     (o agente dizendo algo), e um balao so evita duas coisas disputando o
     espaco acima da barra. Ele sai sozinho, como toda resposta. */
  useEffect(
    () =>
      subscribeAgentMessages((message) => {
        setReply({ agentSlug: message.agent, text: message.text })
        setMessages((queue) =>
          withNotification(queue, {
            // `randomUUID` nao existe em contexto inseguro; o relogio mais um
            // acaso cobre o que a chave precisa ser: unica nesta lista.
            id: `${message.at}-${Math.random().toString(36).slice(2, 8)}`,
            agentSlug: message.agent,
            text: message.text,
            at: message.at,
            read: false,
          }),
        )
        followNotification(message.agent)
      }),
    [followNotification],
  )

  /* O TOQUE QUE NINGUEM ATENDEU VIRA NOTIFICACAO.
     Chega por dois caminhos — o relogio da propria barra (`onDecline` com
     `timeout`) e o servidor avisando `no_answer` (o tempo dele, ou o agente
     que desistiu de esperar) — e os dois podem chegar para o mesmo toque: o
     `id` do toque segura a repeticao. */
  const addMissed = useCallback(
    (missed: IncomingCall) => {
      setMessages((queue) =>
        queue.some((item) => item.call?.id === missed.id)
          ? queue
          : withNotification(queue, {
              id: `call-${missed.id}`,
              agentSlug: missed.agentSlug,
              text: missed.reason,
              at: missed.receivedAt,
              read: false,
              call: missed,
            }),
      )
      followNotification(missed.agentSlug)
    },
    [followNotification],
  )

  useEffect(() => subscribeMissedCalls(addMissed), [addMissed])

  useEffect(() => {
    agentsRef.current = agents
  }, [agents])

  // Marcado no COMECO da gravacao: o aviso do SSE pode chegar antes da
  // resposta do proprio PUT.
  const onAgentsSaving = useCallback(() => {
    ownSaveAtRef.current = Date.now()
  }, [])

  const onAgentsUpdated = useCallback((next: AgentSummary[]) => {
    ownSaveAtRef.current = Date.now()
    setAgents(next)
  }, [])

  /* A cara de alguem mudou na VPS: o agente reescreveu o proprio arquivo, ou o
     painel daqui gravou. Em vez de confiar no que o app ja tem, perguntamos a
     lista de novo — a resposta do bridge e a verdade. */
  useEffect(
    () =>
      subscribeAgentsChanged(() => {
        void fetchAgents()
          .then((next) => {
            const recent = Date.now() - ownSaveAtRef.current < OWN_SAVE_WINDOW_MS
            const found = recent ? null : describeChange(agentsRef.current, next)
            if (found) setChange(found)
            setAgents(next)
          })
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
    setLastReply('')
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

    const next = createVoiceAdapter(voiceProviderRef.current, slug, callId, {
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

  /**
   * Abre o campo endereçado a um agente, sem tocar na ligacao em curso — e
   * FECHA se ele ja estiver aberto para esse mesmo agente.
   *
   * O avatar do chip e um botao so: ele abria o campo e nao tinha como
   * desfazer o gesto: quem clicasse sem querer tinha que ir ate o X. Agora o
   * mesmo clique vai e volta.
   */
  const write = useCallback(
    (slug: string) => {
      /* Fechar nao e trocar de destinatario: o chip fica com quem estava. O
         `compose.agentSlug` aqui segue o mesmo criterio do `sendCompose`, que
         ja le esse campo para saber para quem esta escrevendo. */
      if (compose.agentSlug === slug) {
        setCompose({ agentSlug: '', draft: '', busy: false })
        return
      }

      /* O CHIP SEGUE QUEM RECEBE.
         Ligar ja trocava o agente do chip (`startCall`); escrever nao trocava, e
         o resultado era a barra dizendo "Automa" enquanto o campo aberto acima
         dela dizia "Para Ivo". Quem se escreve agora e com quem se vai falar de
         novo em seguida — e o chip existe para ser esse atalho. */
      setCurrent(slug)
      setCompose({ agentSlug: slug, draft: '', busy: false })
    },
    [compose.agentSlug],
  )

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
      setReply({ agentSlug: slug, text: answer.reply, echoed: answer.echoed })
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

  /**
   * Resolve o item na hora, sem abrir voz nenhuma.
   *
   * `reply` e o recado que o Luiz escreveu no cartao do toque, se escreveu:
   * segue como veio, palavra por palavra, ate o agente que ligou.
   */
  const onApprove = useCallback((incomingCall: IncomingCall, reply?: string) => {
    approveIncoming(incomingCall, reply)
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
  const onDecline = useCallback(
    (incomingCall: IncomingCall, cause: DeclineCause, reply?: string) => {
      declineIncoming(incomingCall, cause, reply)
      dismissIncoming(incomingCall.id)
      // Tempo esgotado nao e "nao": o cartao sai daqui, o pedido vai para as
      // notificacoes e espera por uma decisao de verdade.
      if (cause === 'timeout') addMissed(incomingCall)
    },
    [addMissed],
  )

  /**
   * Decidir um toque que ficou para depois.
   *
   * Ligar e o mesmo gesto do toque vivo: abre a ligacao com quem pediu. Aprovar
   * e recusar viram um recado escrito para o agente (ver `lateDecisionText`),
   * e a resposta dele aparece no balao, como a de qualquer recado. O pedido so
   * sai das notificacoes quando o recado chegou — se falhar, ele fica ali para
   * uma segunda tentativa.
   */
  const resolveLate = useCallback(
    async (item: QueuedMessage, action: LateAction, reply?: string) => {
      const late = item.call
      if (!late || item.busy) return

      if (action === 'answer') {
        setMessages((queue) => queue.filter((entry) => entry.id !== item.id))
        void call(item.agentSlug)
        return
      }

      const setBusy = (busy: boolean) =>
        setMessages((queue) => queue.map((entry) => (entry.id === item.id ? { ...entry, busy } : entry)))

      setBusy(true)
      try {
        const answer = await sendMessage(item.agentSlug, lateDecisionText(late, action, reply))
        setMessages((queue) => queue.filter((entry) => entry.id !== item.id))
        setReply({ agentSlug: item.agentSlug, text: answer.reply, echoed: answer.echoed })
      } catch (err) {
        setBusy(false)
        setReply({
          agentSlug: item.agentSlug,
          text: err instanceof Error ? err.message : 'Nao consegui falar com o bridge.',
          isError: true,
        })
      }
    },
    [call],
  )

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
    /* No navegador isto e uma PAGINA: a barra se ancora no canto de baixo a
       direita da viewport. Na janela do app nao ha pagina — a janela tem o
       tamanho do conteudo, e quem ancora e o Electron. E a unica diferenca. */
    <main
      className={cn(
        'flex flex-col',
        // `calling-stack`: o gancho que vira a coluna quando a barra troca de
        // lado na tela (ver `index.css`).
        isDesktopMainWindow
          ? 'calling-stack items-end gap-2'
          : 'bg-background min-h-svh items-center justify-center gap-6 p-6',
      )}
    >
      {!isDesktopMainWindow && (
        <header className="flex flex-col items-center gap-1.5 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Calling</h1>
          <p className="text-muted-foreground max-w-sm text-sm">
            Os agentes da Sincron ficam a um toque — e ligam de volta quando trava.
          </p>
        </header>
      )}

      {/* O trabalho acontece em silencio: a barra e a unica coisa que fala. */}
      <section className="flex w-full max-w-65 flex-col items-stretch gap-2" aria-live="polite">
        {/* `data-surface`: no app de desktop so o que e cartao segura o
            clique — o resto da janela e transparente e deixa passar. */}
        {agents.length === 0 && !error && (
          <p
            data-surface=""
            className="text-muted-foreground flex items-center justify-center gap-2 text-sm"
          >
            <Spinner className="size-3.5" />
            Carregando agentes…
          </p>
        )}
        {phase === 'in-call' && waiting && (
          <p
            data-surface=""
            className="text-muted-foreground flex items-center justify-center gap-2 text-sm"
          >
            <Spinner className="size-3.5" />
            {currentName} está pensando…
          </p>
        )}
        {lastReply && (
          <div data-surface="" className="bg-card text-card-foreground rounded-xl border p-3">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <AgentAvatar name={currentName} color={colorOf(current)} src={avatarOf(current)} size={18} />
                <span className="truncate text-xs font-semibold" style={{ color: colorOf(current) }}>
                  {currentName}
                </span>
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setLastReply('')}
                aria-label="Fechar"
              >
                <XIcon />
              </Button>
            </div>
            <p className="text-sm leading-snug">{lastReply}</p>
          </div>
        )}
        {error && (
          <Alert data-surface="" variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
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
        onAgentsUpdated={onAgentsUpdated}
        onAgentsSaving={onAgentsSaving}
        change={change}
        onChangeDone={() => setChange(null)}
        messages={messages}
        onMessagesRead={() =>
          setMessages((queue) => queue.map((item) => (item.read ? item : { ...item, read: true })))
        }
        onDismissMessage={(id) => setMessages((queue) => queue.filter((item) => item.id !== id))}
        // Limpar leva os recados; pedido esperando decisao fica ate ser decidido.
        onClearMessages={() => setMessages((queue) => queue.filter((item) => item.call))}
        onResolveLate={(item, action, reply) => void resolveLate(item, action, reply)}
        onOpenConfig={onOpenConfig}
        voiceProvider={voiceProvider}
        onVoiceProviderChange={changeVoiceProvider}
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
