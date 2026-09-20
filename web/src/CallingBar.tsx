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
import { initialOf } from './agents'
import { INCOMING_CALL_TIMEOUT_MS, type DeclineCause, type IncomingCall } from './incoming'

/** Fase da ligacao que o Luiz fez (ou esta fazendo). */
export type CallPhase = 'idle' | 'calling' | 'in-call'

export interface CallingBarProps {
  agents: AgentSummary[]
  /** Cor de cada agente (a barra so pergunta; a paleta mora em `agents.ts`). */
  colorOf: (slug: string) => string
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
}

/** Disco com a inicial do agente e a borda na cor dele. */
function AgentDisc({ name, color, size, className, style }: AvatarProps) {
  return (
    <span
      className={`disc${className ? ` ${className}` : ''}`}
      style={
        {
          ...style,
          '--disc-color': color,
          '--disc-size': `${size}px`,
        } as CSSProperties
      }
      aria-hidden="true"
    >
      {initialOf(name)}
    </span>
  )
}

/* ------------------------------------------------------ chamada recebida -- */

interface IncomingCardProps {
  call: IncomingCall
  agentName: string
  color: string
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
        <AgentDisc name={agentName} color={color} size={24} />
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
  currentSlug,
  phase,
  callStartedAt,
  incoming,
  onCall,
  onHangUp,
  onApprove,
  onAnswer,
  onDecline,
}: CallingBarProps) {
  const [hovered, setHovered] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [stackOpen, setStackOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const rootRef = useRef<HTMLDivElement>(null)
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
  const others = useMemo(
    () => agents.filter((a) => a.slug !== current?.slug),
    [agents, current],
  )

  /* O toque nao fica de pe para sempre: passado o tempo, vira recusa implicita
     (e o servidor cai para o Telegram). Cada chamada tem o seu proprio relogio,
     contado a partir de quando ela chegou. */
  const declineRef = useRef(onDecline)
  useEffect(() => {
    declineRef.current = onDecline
  }, [onDecline])

  useEffect(() => {
    const timers = incoming.map((call) => {
      const left = Math.max(0, call.receivedAt + INCOMING_CALL_TIMEOUT_MS - Date.now())
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

  const callAgent = useCallback(
    (slug: string) => {
      setMenuOpen(false)
      onCall(slug)
    },
    [onCall],
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
      <div
        className={`chip${open ? ' is-open' : ''}${active ? ' is-active' : ''}`}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        {menuOpen && others.length > 0 && (
          <div className="menu" role="menu" aria-label="Outros agentes">
            {others.map((agent) => (
              <button
                key={agent.slug}
                type="button"
                role="menuitem"
                className="menu__row"
                onClick={() => callAgent(agent.slug)}
              >
                <span
                  className="menu__dot"
                  style={{ background: colorOf(agent.slug) }}
                  aria-hidden="true"
                />
                {agent.name}
              </button>
            ))}
          </div>
        )}

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
            <AgentDisc name={current.name} color={currentColor} size={28} />
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
