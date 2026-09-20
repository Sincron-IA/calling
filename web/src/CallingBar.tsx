import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import type { AgentSummary } from './bridge'
import { AgentPanel } from './AgentPanel'
import { initialOf } from './agents'
import { INCOMING_CALL_TIMEOUT_MS, type DeclineCause, type IncomingCall } from './incoming'

/** Fase da ligacao que o Luiz fez (ou esta fazendo). */
export type CallPhase = 'idle' | 'calling' | 'in-call'

/** Quanto tempo um aviso curto fica de pe antes de sair sozinho. */
export const NOTICE_TIMEOUT_MS = 5000

/** Quanto tempo a resposta do agente fica no balao antes de sumir. */
export const REPLY_TIMEOUT_MS = 15000

/** O campo de escrever. `agentSlug` vazio = fechado. */
export interface ComposeState {
  agentSlug: string
  draft: string
  /** Mandou e esta esperando: o campo trava ate a resposta chegar. */
  busy: boolean
}

/** O balao acima da barra: a ULTIMA resposta, ou o ultimo erro. Nunca dois. */
export interface ReplyBubble {
  agentSlug: string
  text: string
  /** Erro nao sai sozinho — ele pede uma decisao. */
  isError?: boolean
}

export interface CallingBarProps {
  agents: AgentSummary[]
  /** Cor de cada agente (a barra so pergunta; quem decide e o bridge). */
  colorOf: (slug: string) => string
  /** Imagem de cada agente, se ele tiver uma. Vazio = fica a inicial. */
  avatarOf?: (slug: string) => string
  /** Agente do chip: o ultimo chamado. */
  currentSlug: string
  phase: CallPhase
  /** Quando a ligacao atual comecou (ms) — cronometro do estado "na linha". */
  callStartedAt: number | null
  /** Chamadas recebidas em aberto, da mais antiga para a mais nova. */
  incoming: IncomingCall[]
  /** Ligar para um agente (clique no avatar ou numa linha do menu). */
  onCall: (slug: string) => void
  /** Desligar/cancelar a ligacao em curso. */
  onHangUp: () => void
  /** Resolver o item pendente SEM abrir voz. */
  onApprove: (call: IncomingCall) => void
  /** Atender por voz (abre a ligacao de verdade). */
  onAnswer: (call: IncomingCall) => void
  /** Recusar — quem trata isso e responsavel por cair para o Telegram. */
  onDecline: (call: IncomingCall, cause: DeclineCause) => void
  /** Recado curto acima da barra (hoje: "conectou"). Vazio = nada na tela. */
  notice?: string
  /** Chamado quando o recado sai — por tempo ou por clique. */
  onNoticeDone?: () => void
  /** Escrever para um agente (aviaozinho na linha do menu). */
  onWrite?: (slug: string) => void
  /** Estado do campo de escrever. Quem manda a mensagem e o dono do estado. */
  compose?: ComposeState
  onDraftChange?: (draft: string) => void
  onSendMessage?: () => void
  onCloseCompose?: () => void
  /** Balao da ultima resposta (ou do ultimo erro). */
  reply?: ReplyBubble | null
  onReplyDone?: () => void
  /** A lista nova, depois que a cara de alguem foi editada por aqui. */
  onAgentsUpdated?: (agents: AgentSummary[]) => void
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = String(Math.floor(total / 60)).padStart(2, '0')
  const seconds = String(total % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

/* ---------------------------------------------------------------- icones -- */

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path
        d="M3.5 8.5l3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <path
        d="M5.2 2.6 6.4 5 5.1 6.4a8.3 8.3 0 0 0 4.5 4.5L11 9.6l2.4 1.2v2.1c0 .6-.5 1.1-1.1 1C6.6 13.5 2.5 9.4 2 3.7c0-.6.4-1.1 1-1.1h2.2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path
        d="M4 4l8 8M12 4l-8 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Aviaozinho: a acao DESPACHA um recado — nao edita um texto parado. */
function SendIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <path
        d="M13.9 2.4 2.5 6.9l4.3 1.8 1.8 4.3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M13.9 2.4 6.8 8.7" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

/** Lapis: aqui SIM e editar — a aparencia do agente. */
function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <path
        d="M2.5 12.2V13.5h1.3l7.1-7.1-1.3-1.3-7.1 7.1zM12.6 4.2c.2-.2.2-.5 0-.6l-.8-.8c-.2-.2-.5-.2-.6 0l-.7.7 1.4 1.4.7-.7z"
        fill="currentColor"
      />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true" focusable="false">
      <path
        d="M4 6.5l4 4 4-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/* --------------------------------------------------------------- avatares -- */

interface AvatarProps {
  name: string
  color: string
  size: number
  className?: string
  style?: CSSProperties
  /** Imagem do agente. Vazio (ou que nao carrega) cai na inicial. */
  src?: string
}

/**
 * Disco do agente: a imagem dele quando existe, a inicial quando nao.
 *
 * A imagem que nao carrega volta para a inicial — nunca para um icone
 * quebrado. E por isso que ela e um `<img>` de verdade, e nao um
 * `background-image`: so a tag avisa quando falha.
 */
function AgentDisc({ name, color, size, className, style, src = '' }: AvatarProps) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [src])

  const showImage = Boolean(src) && !failed

  return (
    <span
      className={`disc${showImage ? ' disc--photo' : ''}${className ? ` ${className}` : ''}`}
      style={
        {
          ...style,
          '--disc-color': color,
          '--disc-size': `${size}px`,
        } as CSSProperties
      }
      aria-hidden="true"
    >
      {showImage ? (
        <img className="disc__img" src={src} alt="" onError={() => setFailed(true)} />
      ) : (
        initialOf(name)
      )}
    </span>
  )
}

/* ------------------------------------------------------ chamada recebida -- */

interface IncomingCardProps {
  call: IncomingCall
  agentName: string
  color: string
  avatar?: string
  onApprove: (call: IncomingCall) => void
  onAnswer: (call: IncomingCall) => void
  onDecline: (call: IncomingCall, cause: DeclineCause) => void
  /** Cartao dentro da lista expandida: sem o brilho pulsante proprio. */
  inline?: boolean
}

function IncomingCard({
  call,
  agentName,
  color,
  avatar = '',
  onApprove,
  onAnswer,
  onDecline,
  inline = false,
}: IncomingCardProps) {
  // Handler isolado de proposito: se um dia o "Aprovar" precisar de confirmacao
  // (duplo clique, undo), e aqui dentro que ela entra, sem mexer no resto.
  const approve = useCallback(() => onApprove(call), [onApprove, call])

  return (
    <div
      className={`incoming${inline ? ' incoming--inline' : ''}`}
      style={{ '--ring': color } as CSSProperties}
      role="group"
      aria-label={`Chamada de ${agentName}`}
    >
      <div className="incoming__head">
        <AgentDisc name={agentName} color={color} size={24} src={avatar} />
        <span className="incoming__name">{agentName}</span>
      </div>
      <p className="incoming__reason">{call.reason}</p>
      <div className="incoming__actions">
        <button type="button" className="pill pill--approve" onClick={approve}>
          <CheckIcon />
          Aprovar
        </button>
        <button
          type="button"
          className="round"
          onClick={() => onAnswer(call)}
          title="Atender por voz"
          aria-label={`Atender ${agentName} por voz`}
        >
          <PhoneIcon />
        </button>
        <button
          type="button"
          className="round"
          onClick={() => onDecline(call, 'manual')}
          title="Recusar"
          aria-label={`Recusar a chamada de ${agentName}`}
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ barra -- */

export function CallingBar({
  agents,
  colorOf,
  avatarOf,
  currentSlug,
  phase,
  callStartedAt,
  incoming,
  onCall,
  onHangUp,
  onApprove,
  onAnswer,
  onDecline,
  notice = '',
  onNoticeDone,
  onWrite,
  compose,
  onDraftChange,
  onSendMessage,
  onCloseCompose,
  reply = null,
  onReplyDone,
  onAgentsUpdated,
}: CallingBarProps) {
  const [hovered, setHovered] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [stackOpen, setStackOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  // O lembrete de teclas so aparece quando se procura por ele.
  const [hintOpen, setHintOpen] = useState(false)
  // Slug do agente cuja aparencia esta aberta para edicao. Vazio = nenhum.
  const [editFor, setEditFor] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const draftRef = useRef<HTMLTextAreaElement>(null)
  // O menu abre no hover; o clique que vem logo depois nao pode fechar o que o
  // proprio mouse acabou de abrir.
  const openedByHoverRef = useRef(false)

  const nameOf = useCallback(
    (slug: string) => agents.find((a) => a.slug === slug)?.name ?? slug,
    [agents],
  )

  const current = useMemo(
    () => agents.find((a) => a.slug === currentSlug) ?? agents[0],
    [agents, currentSlug],
  )

  /* O toque nao fica de pe para sempre: passado o tempo, vira "ninguem
     atendeu". Cada chamada tem o seu proprio relogio, e quem manda na hora de
     morrer e o SERVIDOR (`expiresAt`, que vem junto do toque) — a constante
     local so cobre o caso de ele nao ter mandado. */
  const declineRef = useRef(onDecline)
  useEffect(() => {
    declineRef.current = onDecline
  }, [onDecline])

  useEffect(() => {
    const timers = incoming.map((call) => {
      const expiresAt = call.expiresAt ?? call.receivedAt + INCOMING_CALL_TIMEOUT_MS
      const left = Math.max(0, expiresAt - Date.now())
      return window.setTimeout(() => declineRef.current(call, 'timeout'), left)
    })
    return () => timers.forEach((id) => window.clearTimeout(id))
  }, [incoming])

  // Cronometro da ligacao viva.
  useEffect(() => {
    if (phase !== 'in-call' || callStartedAt === null) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [phase, callStartedAt])

  // Fecha o menu (e a lista de chamadas) ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!menuOpen && !stackOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false)
        setStackOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        setStackOpen(false)
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen, stackOpen])

  // Uma chamada recebida some da fila: nao faz sentido segurar a lista aberta.
  useEffect(() => {
    if (incoming.length < 2) setStackOpen(false)
  }, [incoming.length])

  /* O aviso sai sozinho. O relogio e re-armado a cada aviso NOVO (a string
     muda), entao dois recados seguidos nao herdam o tempo um do outro. */
  const noticeDoneRef = useRef(onNoticeDone)
  useEffect(() => {
    noticeDoneRef.current = onNoticeDone
  }, [onNoticeDone])

  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(() => noticeDoneRef.current?.(), NOTICE_TIMEOUT_MS)
    return () => window.clearTimeout(id)
  }, [notice])

  /* O balao sai sozinho — mas so o que E resposta. Erro fica ate alguem
     decidir o que fazer com ele.

     O relogio PARA com o mouse em cima e retoma de onde estava quando ele sai:
     ler uma resposta nao pode ser uma corrida contra o cronometro. Por isso
     guardamos o que sobrou, e nao so um timer. */
  const replyDoneRef = useRef(onReplyDone)
  useEffect(() => {
    replyDoneRef.current = onReplyDone
  }, [onReplyDone])

  const [replyHeld, setReplyHeld] = useState(false)
  const replyLeftRef = useRef(REPLY_TIMEOUT_MS)

  useEffect(() => {
    // Balao novo: o relogio recomeca inteiro.
    replyLeftRef.current = REPLY_TIMEOUT_MS
  }, [reply])

  useEffect(() => {
    if (!reply || reply.isError || replyHeld) return
    const startedAt = Date.now()
    const id = window.setTimeout(() => replyDoneRef.current?.(), replyLeftRef.current)
    return () => {
      window.clearTimeout(id)
      replyLeftRef.current = Math.max(0, replyLeftRef.current - (Date.now() - startedAt))
    }
  }, [reply, replyHeld])

  /* O campo nasce com foco: quem clicou em "escrever" quer digitar, nao
     procurar onde clicar de novo. */
  const composeFor = compose?.agentSlug ?? ''
  useEffect(() => {
    if (composeFor) draftRef.current?.focus()
  }, [composeFor])

  /* O campo acompanha o texto ate um teto; passado ele, rola por dentro. A
     janela do app cresce junto, que e o comportamento que se espera de um
     widget do tamanho do conteudo. */
  useEffect(() => {
    const el = draftRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`
  }, [compose?.draft, composeFor])

  const callAgent = useCallback(
    (slug: string) => {
      setMenuOpen(false)
      onCall(slug)
    },
    [onCall],
  )

  const writeTo = useCallback(
    (slug: string) => {
      setMenuOpen(false)
      setHintOpen(false)
      setEditFor('')
      onWrite?.(slug)
    },
    [onWrite],
  )

  const editAgent = useCallback((slug: string) => {
    setMenuOpen(false)
    setEditFor(slug)
  }, [])

  const agentBeingEdited = useMemo(
    () => agents.find((a) => a.slug === editFor) ?? null,
    [agents, editFor],
  )

  if (agents.length === 0 || !current) return null

  const currentColor = colorOf(current.slug)
  const active = phase !== 'idle'
  const ringing = incoming.length > 0

  /* ---- 1 chamada recebida: o cartao destacado, com o brilho pulsando ---- */
  if (ringing && incoming.length === 1) {
    const call = incoming[0]
    return (
      <div className="bar bar--ringing" ref={rootRef}>
        <IncomingCard
          call={call}
          agentName={nameOf(call.agentSlug)}
          color={colorOf(call.agentSlug)}
          avatar={avatarOf?.(call.agentSlug)}
          onApprove={onApprove}
          onAnswer={onAnswer}
          onDecline={onDecline}
        />
      </div>
    )
  }

  /* ---- Varias ao mesmo tempo: pilha de avatares + "N chamando" ---- */
  if (ringing) {
    // O mais recente por cima: desenhamos do fim para o comeco.
    const stack = [...incoming].reverse()
    return (
      <div className="bar bar--ringing" ref={rootRef}>
        {stackOpen && (
          <div className="stack__list" role="list">
            {stack.map((call) => (
              <div role="listitem" key={call.id}>
                <IncomingCard
                  call={call}
                  agentName={nameOf(call.agentSlug)}
                  color={colorOf(call.agentSlug)}
                  avatar={avatarOf?.(call.agentSlug)}
                  onApprove={onApprove}
                  onAnswer={onAnswer}
                  onDecline={onDecline}
                  inline
                />
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          className="stack"
          onClick={() => setStackOpen((open) => !open)}
          aria-expanded={stackOpen}
          aria-label={`${incoming.length} agentes chamando`}
        >
          <span className="stack__discs">
            {stack.map((call, index) => (
              <AgentDisc
                key={call.id}
                name={nameOf(call.agentSlug)}
                color={colorOf(call.agentSlug)}
                src={avatarOf?.(call.agentSlug)}
                size={30}
                className="stack__disc"
                // Quem chamou por ultimo fica por cima da pilha.
                style={{ zIndex: stack.length - index }}
              />
            ))}
          </span>
          <span className="stack__label">{incoming.length} chamando</span>
        </button>
      </div>
    )
  }

  /* ---- Parado / na linha: um chip so, quieto ---- */
  const open = hovered || menuOpen
  const label: ReactNode =
    phase === 'in-call' && callStartedAt !== null
      ? `${current.name} · ${formatDuration(now - callStartedAt)}`
      : phase === 'calling'
        ? `${current.name} · chamando…`
        : `${current.name} · clica pra ligar de novo`

  return (
    <div className="bar" ref={rootRef}>
      {/* Recado curto, em fluxo como o menu — ver o porque logo abaixo. */}
      {notice && (
        <button type="button" className="notice" onClick={() => onNoticeDone?.()}>
          <span className="notice__dot" aria-hidden="true" />
          {notice}
        </button>
      )}

      {/* A ULTIMA resposta, ou o ultimo erro. Nunca dois: quem manda outra
          mensagem troca o que esta aqui. */}
      {reply && (
        <button
          type="button"
          className={`bubble${reply.isError ? ' bubble--error' : ''}`}
          style={{ '--bubble-color': colorOf(reply.agentSlug) } as CSSProperties}
          onClick={() => onReplyDone?.()}
          onPointerEnter={() => setReplyHeld(true)}
          onPointerLeave={() => setReplyHeld(false)}
          aria-live="polite"
          title="Fechar"
        >
          <span className="bubble__who">
            {reply.isError ? 'não consegui mandar' : nameOf(reply.agentSlug)}
          </span>
          <span className="bubble__text">{reply.text}</span>
        </button>
      )}

      {/* O MENU E IRMAO DO CHIP, NAO FILHO — e nao e posicionado.
          A janela do app tem o tamanho do conteudo, e quem o mede e o
          `getBoundingClientRect()` do `#root`, que IGNORA filho posicionado
          fora da caixa de borda. Menu absoluto = janela que nao cresce = menu
          pintado fora dela e cortado. Em fluxo, dentro desta coluna, a janela
          cresce sozinha e a ancora de canto (`electron/main.js`) faz ela subir
          em vez de escorregar. No navegador da no mesmo: `.bar` e uma coluna
          ancorada pelo `bottom`. */}
      {menuOpen && agents.length > 0 && (
        <div className="menu" role="menu" aria-label="Agentes">
          {agents.map((agent) => {
            const isCurrent = agent.slug === current.slug
            return (
              /* A LINHA NAO E MAIS CLICAVEL. Escrever vai ser a acao mais
                 frequente, mas ela nao pode virar o clique padrao: quem hoje
                 clica na linha esperando LIGAR passaria a errar todas as vezes.
                 Duas acoes nomeadas, nenhum significado trocado por baixo. */
              <div key={agent.slug} className={`menu__row${isCurrent ? ' is-current' : ''}`}>
                <span
                  className="menu__dot"
                  style={{ background: colorOf(agent.slug) }}
                  aria-hidden="true"
                />
                <span className="menu__name">
                  {agent.name}
                  {isCurrent && <span className="menu__tag"> · atual</span>}
                </span>
                <span className="menu__acts">
                  <button
                    type="button"
                    role="menuitem"
                    className="menu__act"
                    onClick={() => editAgent(agent.slug)}
                    title={`Aparência de ${agent.name}`}
                    aria-label={`Aparência de ${agent.name}`}
                  >
                    <PencilIcon />
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="menu__act"
                    onClick={() => writeTo(agent.slug)}
                    title={`Escrever para ${agent.name}`}
                    aria-label={`Escrever para ${agent.name}`}
                  >
                    <SendIcon />
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="menu__act"
                    onClick={() => callAgent(agent.slug)}
                    title={`Ligar para ${agent.name}`}
                    aria-label={`Ligar para ${agent.name}`}
                  >
                    <PhoneIcon />
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      )}

      {agentBeingEdited && (
        <AgentPanel
          agent={agentBeingEdited}
          color={colorOf(agentBeingEdited.slug)}
          avatar={avatarOf?.(agentBeingEdited.slug) ?? ''}
          onClose={() => setEditFor('')}
          onSaved={(next) => onAgentsUpdated?.(next)}
        />
      )}

      {composeFor && compose && (
        <div className="compose">
          <div className="compose__head">
            <span className="compose__to">
              <AgentDisc
                name={nameOf(composeFor)}
                color={colorOf(composeFor)}
                size={18}
                src={avatarOf?.(composeFor)}
              />
              para o {nameOf(composeFor)}
            </span>
            {/* O tutorial mora AQUI DENTRO, escondido: as teclas so aparecem
                para quem for procurar por elas. */}
            <button
              type="button"
              className={`compose__hint${hintOpen ? ' is-open' : ''}`}
              aria-label="Como mandar"
              aria-expanded={hintOpen}
              onPointerEnter={() => setHintOpen(true)}
              onPointerLeave={() => setHintOpen(false)}
              onFocus={() => setHintOpen(true)}
              onBlur={() => setHintOpen(false)}
            >
              i
            </button>
          </div>

          {/* Uma linha so, e ela esta SEMPRE no layout — ora com o lembrete,
              ora com o "esta pensando", ora vazia. Se ela entrasse e saisse, a
              janela (que tem o tamanho do conteudo) pularia a cada passada do
              mouse pelo `i`. */}
          <span className={`compose__line${compose.busy || hintOpen ? ' is-open' : ''}`}>
            {compose.busy
              ? `${nameOf(composeFor)} está pensando…`
              : 'Enter manda · Shift+Enter quebra linha · Esc fecha'}
          </span>

          <div className="compose__field">
            <textarea
              ref={draftRef}
              className="compose__text"
              rows={1}
              value={compose.draft}
              disabled={compose.busy}
              placeholder={`Recado para ${nameOf(composeFor)}…`}
              onChange={(event) => onDraftChange?.(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  onCloseCompose?.()
                  return
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  if (!compose.busy && compose.draft.trim()) onSendMessage?.()
                }
              }}
            />
            <button
              type="button"
              className="compose__send"
              disabled={compose.busy || !compose.draft.trim()}
              onClick={() => onSendMessage?.()}
              aria-label={`Mandar para ${nameOf(composeFor)}`}
              title="Mandar"
            >
              {compose.busy ? (
                <span className="thinking" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              ) : (
                <SendIcon />
              )}
            </button>
          </div>
        </div>
      )}

      <div
        className={`chip${open ? ' is-open' : ''}${active ? ' is-active' : ''}`}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        {/* Parado: tres barrinhas mudas. Na linha: as mesmas tres, vivas. */}
        <span className={`wave${active ? ' wave--live' : ''}`} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>

        <span className="chip__reveal">
          <button
            type="button"
            className="chip__avatar"
            onClick={() => (active ? onHangUp() : callAgent(current.slug))}
            onFocus={() => setHovered(true)}
            onBlur={() => setHovered(false)}
            aria-label={
              active ? `Desligar a ligacao com ${current.name}` : `Ligar de novo para ${current.name}`
            }
          >
            <AgentDisc
              name={current.name}
              color={currentColor}
              size={28}
              src={avatarOf?.(current.slug)}
            />
          </button>
          <button
            type="button"
            className="chip__chevron"
            onClick={() => {
              if (openedByHoverRef.current) {
                openedByHoverRef.current = false
                setMenuOpen(true)
                return
              }
              setMenuOpen((value) => !value)
            }}
            onPointerEnter={() => {
              openedByHoverRef.current = !menuOpen
              setMenuOpen(true)
            }}
            onPointerLeave={() => {
              openedByHoverRef.current = false
            }}
            onFocus={() => setHovered(true)}
            onBlur={() => setHovered(false)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Escolher outro agente"
          >
            <ChevronIcon />
          </button>
        </span>

        <span className="chip__label" aria-live="off">
          {label}
        </span>
      </div>
    </div>
  )
}
