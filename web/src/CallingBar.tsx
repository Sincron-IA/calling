/**
 * A BARRA.
 *
 * Uma coluna no canto da tela: o chip embaixo, e acima dele tudo o que abre —
 * o menu dos agentes, a fila de recados, o balao da resposta, o campo de
 * escrever, o cartao de chamada recebida.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE NADA AQUI USA `Popover`, `DropdownMenu` NEM `Sheet`
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Todo componente de sobreposicao do shadcn (e do Radix por baixo) faz duas
 * coisas: renderiza num portal no `body` e se posiciona com `position:
 * absolute`. As duas quebram esta janela.
 *
 * A janela do app de desktop nao tem moldura e VESTE O TAMANHO DO CONTEUDO: o
 * `DesktopGate` mede o `#root` com `getBoundingClientRect()` e o Electron
 * reancora a janela no canto. Um portal sai do `#root`, e um filho posicionado
 * fora da caixa nao entra na medida do pai — nos dois casos a janela nao
 * cresce, e o menu nasce pintado FORA dela, cortado.
 *
 * Entao o que abre aqui fica EM FLUXO, nesta coluna. O que e "componente
 * pronto" nao e o posicionamento — e o conteudo: `Item`, `ItemGroup`, `Empty`,
 * `ScrollArea`, `Badge`, `Avatar`, `Button`, `InputGroup`, `Kbd`, `Spinner`,
 * `Alert`. O `className` cuida do layout, que e o que `className` deve fazer.
 *
 * Isto esta registrado em `docs/SHADCN.md` — nao e um atalho, e a leitura
 * certa da restricao.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import {
  ArrowRightIcon,
  BellIcon,
  CheckIcon,
  ChevronDownIcon,
  KeyboardIcon,
  PencilIcon,
  PhoneIcon,
  SendIcon,
  SettingsIcon,
  XIcon,
} from 'lucide-react'

import { Slot } from 'radix-ui'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Empty, EmptyDescription, EmptyHeader } from '@/components/ui/empty'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { AgentAvatar, AgentAvatarStack } from './AgentAvatar'
import { AgentPanel } from './AgentPanel'
import type { AgentSummary } from './bridge'
import { INCOMING_CALL_TIMEOUT_MS, type DeclineCause, type IncomingCall } from './incoming'

/** Fase da ligacao que o Luiz fez (ou esta fazendo). */
export type CallPhase = 'idle' | 'calling' | 'in-call'

/** Quanto tempo um aviso curto fica de pe antes de sair sozinho. */
export const NOTICE_TIMEOUT_MS = 5000

/** Quanto tempo a resposta do agente fica no balao antes de sumir. */
export const REPLY_TIMEOUT_MS = 15000

/*
 * NADA AQUI ABRE NO HOVER.
 *
 * A barra passar o mouse e abrir era a origem de quase tudo o que incomodava:
 * ela acendia sozinha ao atravessar o canto da tela, a janela mudava de tamanho
 * debaixo do cursor, e o chevron abria a lista no meio de um arrasto. Nenhuma
 * pausa de intencao resolve isso — resolve so parcialmente, e ao custo de um
 * monte de relogio e de guarda para segurar o que nao devia comecar.
 *
 * Agora e clique: as barrinhas abrem a barra, um segundo clique (ou o Esc, ou
 * clicar fora) fecham. O hover nao muda nada — nem o tamanho da janela.
 */

/** Largura da coluna: uma so, para a janela nao mudar de largura ao abrir. */
const RAIL = 'w-68'

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
  /** O recado tambem chegou na thread do agente no Telegram. */
  echoed?: boolean
}

/**
 * Um recado que o agente empurrou, guardado na fila.
 *
 * O balao mostra o mais novo e sai sozinho — mas quem estava ocupado nao pode
 * perder o que foi dito. A fila fica de pe ate alguem ler, e vive so em
 * memoria: fechou o app, acabou, como o resto da conversa. Quem quer registro
 * tem a thread do agente.
 */
export interface QueuedMessage {
  id: string
  agentSlug: string
  text: string
  /** Quando chegou (ms). */
  at: number
  read: boolean
}

/**
 * Um agente mudou a propria cara (pelo arquivo dele na VPS, nao por aqui).
 * Guardamos o ANTES para mostrar antes -> depois num olhar.
 */
export interface AgentChange {
  slug: string
  /** "trocou de cor", "trocou de nome", "trocou a imagem"... */
  what: string
  beforeName: string
  beforeColor: string
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
  /** O painel comecou a gravar a cara de alguem. */
  onAgentsSaving?: () => void
  /** Aviso de que um agente mudou a si mesmo. */
  change?: AgentChange | null
  onChangeDone?: () => void
  /** A fila de recados empurrados pelos agentes, do mais novo para o mais velho. */
  messages?: QueuedMessage[]
  /** A fila foi aberta: tudo o que estava nela conta como lido. */
  onMessagesRead?: () => void
  /** Tirar UM recado da fila. */
  onDismissMessage?: (id: string) => void
  /** Esvaziar a fila. */
  onClearMessages?: () => void
  /**
   * Abrir o painel de conexao.
   *
   * A engrenagem morava solta ao lado da barra, aparecendo no hover — mais uma
   * coisa a acertar com o mouse num canto de tela ja apertado, e que se mexia
   * quando a barra crescia. Agora ela mora no cabecalho da lista de agentes,
   * que e onde se vai para mexer em qualquer coisa do app.
   *
   * O retangulo e o do proprio botao: o processo principal usa ele para decidir
   * de onde o painel sai.
   */
  onOpenConfig?: (anchor: { x: number; y: number; width: number; height: number } | null) => void
}

/* ------------------------------------------------------------- utilidades -- */

/** Hora do recado na fila: so hora e minuto, que e o que ajuda a se localizar. */
function formatClock(at: number): string {
  const when = new Date(at)
  const hours = String(when.getHours()).padStart(2, '0')
  const minutes = String(when.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = String(Math.floor(total / 60)).padStart(2, '0')
  const seconds = String(total % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

/** Rotulo pequeno em caixa alta: "Agentes", "Para", o nome no balao. */
function Eyebrow({
  className,
  style,
  children,
}: {
  className?: string
  style?: CSSProperties
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'text-muted-foreground font-mono text-[0.625rem] leading-none tracking-[0.08em] uppercase',
        className,
      )}
      style={style}
    >
      {children}
    </span>
  )
}

/**
 * O filete que conta o tempo.
 *
 * `key` novo reinicia a animacao — e por isso que quem chama passa o conteudo
 * como chave: dois recados seguidos nao herdam o relogio um do outro.
 */
function Timer({ ms, color, held = false }: { ms: number; color?: string; held?: boolean }) {
  return (
    <span
      className={cn('timer-track', held && 'timer-held')}
      style={{ '--timer-ms': `${ms}ms`, '--timer-color': color } as CSSProperties}
      aria-hidden="true"
    >
      <span className="timer-fill" />
    </span>
  )
}

/**
 * A casca de tudo o que abre acima do chip: mesma largura, mesmo cartao.
 *
 * `asChild` porque os avisos (recado, mudanca, balao) sao um BOTAO inteiro —
 * clicar em qualquer lugar deles fecha —, e um `<button>` dentro de um `<div>`
 * de cartao daria duas caixas para alinhar em vez de uma.
 */
function Panel({
  className,
  asChild = false,
  children,
  ...rest
}: {
  className?: string
  asChild?: boolean
  children: ReactNode
} & React.ComponentProps<'div'>) {
  const Comp = asChild ? Slot.Root : "div"
  return (
    <Comp
      {...rest}
      className={cn(
        'bg-popover text-popover-foreground app-no-drag flex flex-col overflow-hidden rounded-xl border text-left shadow-2xl',
        /* Entrada curta e CURTA DE DISTANCIA: 4px de sobe-e-aparece, o mesmo
           gesto do desenho aprovado. O painel nasce colado na barra, nao vindo
           de fora da tela. */
        'animate-in fade-in-0 slide-in-from-bottom-1 duration-150 ease-out',
        RAIL,
        className,
      )}
    >
      {children}
    </Comp>
  )
}

/** Cabecalho de um painel: rotulo a esquerda, ferramentas a direita. */
function PanelHead({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="flex h-8 items-center justify-between gap-2 px-2.5">
      <Eyebrow>{label}</Eyebrow>
      <div className="flex items-center gap-0.5">{children}</div>
    </div>
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

  // Quanto ainda falta para o toque morrer sozinho. Quem manda e o SERVIDOR
  // (`expiresAt`); a constante local so cobre o caso de ele nao ter mandado.
  const expiresAt = call.expiresAt ?? call.receivedAt + INCOMING_CALL_TIMEOUT_MS
  const left = Math.max(0, expiresAt - Date.now())

  return (
    <Panel
      role="group"
      aria-label={`Chamada de ${agentName}`}
      className={cn(!inline && 'ring-1', RAIL)}
      style={
        {
          '--agent': color,
          borderColor: `color-mix(in oklch, ${color}, transparent 55%)`,
          // O brilho e do CARTAO destacado; na lista ele viraria seis brilhos.
          boxShadow: inline ? undefined : `0 0 0 1px ${color}22, 0 18px 40px -20px ${color}55`,
        } as CSSProperties
      }
    >
      <Item size="sm" className="border-0">
        <ItemMedia>
          <AgentAvatar name={agentName} color={color} src={avatar} size={24} />
        </ItemMedia>
        <ItemContent>
          <ItemTitle style={{ color }}>{agentName}</ItemTitle>
        </ItemContent>
      </Item>

      <p className="text-foreground px-3 pb-2.5 text-sm leading-snug">{call.reason}</p>

      <div className="flex items-center gap-1 px-2.5 pb-2.5">
        <Button size="sm" className="flex-1" onClick={approve}>
          <CheckIcon data-icon="inline-start" />
          Aprovar
        </Button>
        <ButtonGroup>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => onAnswer(call)}
                aria-label={`Atender ${agentName} por voz`}
              >
                <PhoneIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Atender por voz</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => onDecline(call, 'manual')}
                aria-label={`Recusar a chamada de ${agentName}`}
              >
                <XIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Recusar — cai para o Telegram</TooltipContent>
          </Tooltip>
        </ButtonGroup>
      </div>

      {/* O toque nao fica de pe para sempre, e o filete diz quanto falta. */}
      <Timer key={call.id} ms={left} color={color} />
    </Panel>
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
  onAgentsSaving,
  change = null,
  onChangeDone,
  messages = [],
  onMessagesRead,
  onDismissMessage,
  onClearMessages,
  onOpenConfig,
}: CallingBarProps) {
  // A barra esta aberta (mostrando nome, avatar e chevron). So o clique mexe.
  const [open, setOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [stackOpen, setStackOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  // O lembrete de teclas so aparece quando se procura por ele.
  const [hintOpen, setHintOpen] = useState(false)
  // Slug do agente cuja aparencia esta aberta para edicao. Vazio = nenhum.
  const [editFor, setEditFor] = useState('')
  // A fila de recados esta aberta.
  const [queueOpen, setQueueOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const draftRef = useRef<HTMLTextAreaElement>(null)

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

  /* Clicar fora, ou o Esc, fecha tudo o que esta aberto — a lista, a pilha de
     chamadas e a propria barra. Como agora e o clique que abre, tem que haver
     um clique que feche sem exigir mira no mesmo alvo de novo. */
  useEffect(() => {
    if (!menuOpen && !stackOpen && !open) return
    const closeAll = () => {
      setMenuOpen(false)
      setStackOpen(false)
      setOpen(false)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeAll()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAll()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen, stackOpen, open])

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

  // O "fulano mudou" segue a mesma regra do recado: sai sozinho, ou no clique.
  const changeDoneRef = useRef(onChangeDone)
  useEffect(() => {
    changeDoneRef.current = onChangeDone
  }, [onChangeDone])

  useEffect(() => {
    if (!change) return
    const id = window.setTimeout(() => changeDoneRef.current?.(), NOTICE_TIMEOUT_MS)
    return () => window.clearTimeout(id)
  }, [change])

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

  const unread = useMemo(() => messages.filter((m) => !m.read).length, [messages])

  const openQueue = useCallback(() => {
    setMenuOpen(false)
    setQueueOpen(true)
    onMessagesRead?.()
  }, [onMessagesRead])

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

  /** A coluna. Alinhada a direita, de baixo para cima. */
  const column = 'flex flex-col items-end gap-2'

  /* ---- 1 chamada recebida: o cartao destacado, com o brilho pulsando ---- */
  if (ringing && incoming.length === 1) {
    const call = incoming[0]
    return (
      <TooltipProvider delayDuration={300}>
        <div className={column} ref={rootRef}>
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
      </TooltipProvider>
    )
  }

  /* ---- Varias ao mesmo tempo: pilha de avatares + "N chamando" ---- */
  if (ringing) {
    // O mais recente por cima: desenhamos do fim para o comeco.
    const stack = [...incoming].reverse()
    return (
      <TooltipProvider delayDuration={300}>
        <div className={column} ref={rootRef}>
          {stackOpen && (
            <ScrollArea className={cn('max-h-105', RAIL)}>
              <div className={cn(column, 'pr-1')} role="list">
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
            </ScrollArea>
          )}

          <Button
            variant="outline"
            className="app-no-drag bg-popover h-11 rounded-full pr-3.5 pl-2.5 shadow-2xl"
            onClick={() => setStackOpen((open) => !open)}
            aria-expanded={stackOpen}
            aria-label={`${incoming.length} agentes chamando`}
          >
            {/* Quem chamou por ultimo abre a pilha, a esquerda, por cima. */}
            <AgentAvatarStack
              size={30}
              overlap={10}
              thick
              items={stack.map((call) => ({
                key: call.id,
                name: nameOf(call.agentSlug),
                color: colorOf(call.agentSlug),
                src: avatarOf?.(call.agentSlug),
              }))}
            />
            {incoming.length} chamando
            <ChevronDownIcon
              data-icon="inline-end"
              className={cn('transition-transform', stackOpen && 'rotate-180')}
            />
          </Button>
        </div>
      </TooltipProvider>
    )
  }

  /* ---- Parado / na linha: um chip so, quieto ---- */
  const label =
    phase === 'in-call' && callStartedAt !== null
      ? `${current.name} · ${formatDuration(now - callStartedAt)}`
      : phase === 'calling'
        ? `${current.name} · chamando…`
        : current.name

  return (
    <TooltipProvider delayDuration={300}>
      <div className={column} ref={rootRef}>
        {/* Recado curto. Em fluxo como todo o resto — ver o cabecalho. */}
        {notice && (
          <Panel asChild>
            <button type="button" onClick={() => onNoticeDone?.()} aria-live="polite" title="Fechar">
              <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
                <span className="bg-ok size-1.5 shrink-0 rounded-full" aria-hidden="true" />
                <span className="text-foreground text-left text-sm">{notice}</span>
              </div>

              {/* Quem esta na linha, num olhar: os discos e o numero. */}
              <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
                <AgentAvatarStack
                  size={24}
                  overlap={8}
                  items={agents.slice(0, 6).map((agent) => ({
                    key: agent.slug,
                    name: agent.name,
                    color: colorOf(agent.slug),
                    src: avatarOf?.(agent.slug),
                  }))}
                />
                <Eyebrow>
                  {agents.length === 1 ? '1 agente' : `${agents.length} agentes`}
                </Eyebrow>
              </div>

              <Timer key={notice} ms={NOTICE_TIMEOUT_MS} />
            </button>
          </Panel>
        )}

        {/* Um agente mudou a propria cara pela VPS: antes -> depois. */}
        {change && (
          <Panel asChild>
            <button
              type="button"
              onClick={() => onChangeDone?.()}
              aria-live="polite"
              title="Fechar"
            >
              <div className="flex items-center gap-2.5 px-3 py-2.5">
                <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
                  <AgentAvatar name={change.beforeName} color={change.beforeColor} size={28} />
                  <ArrowRightIcon className="text-muted-foreground size-3.5" />
                  <AgentAvatar
                    name={nameOf(change.slug)}
                    color={colorOf(change.slug)}
                    src={avatarOf?.(change.slug)}
                    size={28}
                  />
                </span>
                <span className="flex min-w-0 flex-col items-start gap-0.5">
                  <span className="text-foreground text-left text-sm leading-tight">
                    {change.beforeName} {change.what}
                  </span>
                  <Eyebrow>pelo próprio workspace</Eyebrow>
                </span>
              </div>

              <Timer
                key={`${change.slug}:${change.what}`}
                ms={NOTICE_TIMEOUT_MS}
                color={colorOf(change.slug)}
              />
            </button>
          </Panel>
        )}

        {/* A ULTIMA resposta, ou o ultimo erro. Nunca dois: quem manda outra
            mensagem troca o que esta aqui. */}
        {reply && (
          <Panel
            asChild
            className={cn(reply.isError && 'border-destructive/40')}
            style={{ '--agent': colorOf(reply.agentSlug) } as CSSProperties}
          >
            <button
              type="button"
              onClick={() => onReplyDone?.()}
              onPointerEnter={() => setReplyHeld(true)}
              onPointerLeave={() => setReplyHeld(false)}
              aria-live="polite"
              title="Fechar"
            >
              <div className="flex items-center justify-between gap-2 px-3 pt-2.5">
                <Eyebrow
                  className={cn('truncate', reply.isError && 'text-destructive')}
                  style={reply.isError ? undefined : { color: colorOf(reply.agentSlug) }}
                >
                  {reply.isError ? 'não consegui mandar' : nameOf(reply.agentSlug)}
                </Eyebrow>
                {reply.echoed ? (
                  <Badge variant="outline" className="gap-1 text-[0.625rem]">
                    <CheckIcon className="size-2.5" />
                    na thread
                  </Badge>
                ) : (
                  <Eyebrow className="shrink-0 whitespace-nowrap">clique para fechar</Eyebrow>
                )}
              </div>

              <p className="text-foreground px-3 py-2 text-left text-sm leading-snug whitespace-pre-wrap">
                {reply.text}
              </p>

              {/* Erro nao tem relogio: fica ate alguem decidir. */}
              {!reply.isError && (
                <Timer
                  key={`${reply.agentSlug}:${reply.text}`}
                  ms={REPLY_TIMEOUT_MS}
                  color={colorOf(reply.agentSlug)}
                  held={replyHeld}
                />
              )}
            </button>
          </Panel>
        )}

        {/* O MENU DOS AGENTES. */}
        {menuOpen && (
          <Panel role="menu" aria-label="Agentes">
            <PanelHead label="Agentes">
              <Eyebrow className="mr-1">
                {agents.length === 1 ? '1 na linha' : `${agents.length} na linha`}
              </Eyebrow>

              {onOpenConfig && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect()
                        setMenuOpen(false)
                        onOpenConfig({
                          x: rect.left,
                          y: rect.top,
                          width: rect.width,
                          height: rect.height,
                        })
                      }}
                      aria-label="Conexão"
                    >
                      <SettingsIcon />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Conexão</TooltipContent>
                </Tooltip>
              )}

              {/* A fila de recados. Discreta: so o sininho, com a conta quando
                  ha coisa nova. Some quando nunca houve recado. */}
              {messages.length > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="relative"
                      onClick={openQueue}
                      aria-label={
                        unread > 0 ? `Recados dos agentes (${unread} novos)` : 'Recados dos agentes'
                      }
                    >
                      <BellIcon />
                      {unread > 0 && (
                        <Badge
                          variant="default"
                          className="absolute -top-1 -right-1 size-3.5 justify-center rounded-full p-0 text-[0.5rem] tabular-nums"
                        >
                          {unread > 9 ? '9+' : unread}
                        </Badge>
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Recados dos agentes</TooltipContent>
                </Tooltip>
              )}

              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setMenuOpen(false)}
                aria-label="Fechar a lista"
              >
                <XIcon />
              </Button>
            </PanelHead>

            <Separator />

            {/* O TETO CABE A LISTA DE HOJE.
                Sao 55px por agente: com os seis atuais, 390px. O teto de 320px
                cortava o ultimo pela metade — e como a barra de rolagem so
                aparecia no hover, a lista parecia ter cinco agentes, nao seis.
                400px mostra os seis inteiros; do setimo em diante, rola. */}
            <ScrollArea className="max-h-100">
              <ItemGroup className="p-1">
                {agents.map((agent) => {
                  const isCurrent = agent.slug === current.slug
                  const color = colorOf(agent.slug)
                  return (
                    /* A LINHA NAO E CLICAVEL. Escrever vai ser a acao mais
                       frequente, mas ela nao pode virar o clique padrao: quem
                       hoje clica na linha esperando LIGAR passaria a errar
                       todas as vezes. Duas acoes nomeadas, nenhum significado
                       trocado por baixo. */
                    <Item
                      key={agent.slug}
                      size="sm"
                      variant={isCurrent ? 'muted' : 'default'}
                      className="group/agent border-0"
                    >
                      <ItemMedia>
                        {/* O disco E o botao de aparencia: o lapis no hover. */}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              role="menuitem"
                              className="focus-visible:ring-ring relative rounded-full focus-visible:ring-2 focus-visible:outline-none"
                              onClick={() => editAgent(agent.slug)}
                              aria-label={`Aparência de ${agent.name}`}
                            >
                              <AgentAvatar
                                name={agent.name}
                                color={color}
                                src={avatarOf?.(agent.slug)}
                                size={28}
                              />
                              <span
                                className="bg-background text-foreground absolute -right-0.5 -bottom-0.5 grid size-3.5 place-items-center rounded-full opacity-0 transition-opacity group-hover/agent:opacity-100"
                                aria-hidden="true"
                              >
                                <PencilIcon className="size-2" />
                              </span>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Aparência de {agent.name}</TooltipContent>
                        </Tooltip>
                      </ItemMedia>

                      <ItemContent className="gap-0">
                        <ItemTitle>{agent.name}</ItemTitle>
                        <ItemDescription className="text-xs">
                          {isCurrent ? 'no chip' : 'disponível'}
                        </ItemDescription>
                      </ItemContent>

                      <ItemActions>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              role="menuitem"
                              onClick={() => writeTo(agent.slug)}
                              aria-label={`Escrever para ${agent.name}`}
                            >
                              <SendIcon />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Escrever</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              role="menuitem"
                              onClick={() => callAgent(agent.slug)}
                              aria-label={`Ligar para ${agent.name}`}
                            >
                              <PhoneIcon />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Ligar</TooltipContent>
                        </Tooltip>
                      </ItemActions>
                    </Item>
                  )
                })}
              </ItemGroup>
            </ScrollArea>
          </Panel>
        )}

        {/* A FILA DE RECADOS.
            O balao mostra o mais novo e sai sozinho; aqui fica tudo o que
            chegou enquanto ninguem estava olhando. */}
        {queueOpen && (
          <Panel role="dialog" aria-label="Recados dos agentes">
            <PanelHead label="Recados">
              {messages.length > 0 && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    onClearMessages?.()
                    setQueueOpen(false)
                  }}
                >
                  Limpar
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setQueueOpen(false)}
                aria-label="Fechar os recados"
              >
                <XIcon />
              </Button>
            </PanelHead>

            <Separator />

            {messages.length === 0 ? (
              <Empty className="py-8">
                <EmptyHeader>
                  <EmptyDescription>Nenhum recado por enquanto.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ScrollArea className="max-h-80">
                <ItemGroup className="p-1">
                  {messages.map((message) => (
                    <Item key={message.id} size="sm" className="items-start border-0">
                      <ItemMedia className="pt-0.5">
                        <AgentAvatar
                          name={nameOf(message.agentSlug)}
                          color={colorOf(message.agentSlug)}
                          src={avatarOf?.(message.agentSlug)}
                          size={20}
                        />
                      </ItemMedia>
                      <ItemContent className="min-w-0 flex-1 gap-0.5">
                        <ItemTitle className="gap-1.5">
                          {nameOf(message.agentSlug)}
                          <span className="text-muted-foreground font-mono text-[0.625rem] font-normal tabular-nums">
                            {formatClock(message.at)}
                          </span>
                        </ItemTitle>
                        <ItemDescription className="line-clamp-none">
                          {message.text}
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions className="self-start">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => onDismissMessage?.(message.id)}
                          aria-label={`Tirar o recado de ${nameOf(message.agentSlug)} da fila`}
                        >
                          <XIcon />
                        </Button>
                      </ItemActions>
                    </Item>
                  ))}
                </ItemGroup>
              </ScrollArea>
            )}
          </Panel>
        )}

        {agentBeingEdited && (
          <AgentPanel
            agent={agentBeingEdited}
            color={colorOf(agentBeingEdited.slug)}
            avatar={avatarOf?.(agentBeingEdited.slug) ?? ''}
            onClose={() => setEditFor('')}
            onSaving={() => onAgentsSaving?.()}
            onSaved={(next) => onAgentsUpdated?.(next)}
          />
        )}

        {/* O CAMPO DE ESCREVER. */}
        {composeFor && compose && (
          <Panel style={{ '--agent': colorOf(composeFor) } as CSSProperties}>
            <div className="flex h-8 items-center justify-between gap-2 px-2.5">
              <span className="flex min-w-0 items-center gap-1.5">
                <Eyebrow>Para</Eyebrow>
                <AgentAvatar
                  name={nameOf(composeFor)}
                  color={colorOf(composeFor)}
                  src={avatarOf?.(composeFor)}
                  size={16}
                />
                <span className="truncate text-xs font-semibold">{nameOf(composeFor)}</span>
              </span>

              <span className="flex items-center gap-0.5">
                {/* O tutorial mora AQUI DENTRO, escondido: as teclas so
                    aparecem para quem for procurar por elas.

                    Era um "i" escrito a mao, em fonte mono e num botao
                    redondo — a unica coisa da interface inteira desenhada
                    assim, bem ao lado de um X que e icone. Agora e um icone
                    como todos os outros, e ele diz do que se trata. */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Teclas"
                      aria-expanded={hintOpen}
                      onPointerEnter={() => setHintOpen(true)}
                      onPointerLeave={() => setHintOpen(false)}
                      onFocus={() => setHintOpen(true)}
                      onBlur={() => setHintOpen(false)}
                    >
                      <KeyboardIcon />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Teclas</TooltipContent>
                </Tooltip>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onCloseCompose?.()}
                  aria-label="Fechar o campo"
                >
                  <XIcon />
                </Button>
              </span>
            </div>

            {/* Uma linha so, e ela esta SEMPRE no layout — ora com o lembrete,
                ora com o "esta pensando", ora vazia. Se ela entrasse e saisse,
                a janela (que tem o tamanho do conteudo) pularia a cada passada
                do mouse pelo `i`. */}
            <div
              className={cn(
                'text-muted-foreground flex h-6 items-center gap-2 px-2.5 text-[0.625rem] transition-opacity',
                compose.busy || hintOpen ? 'opacity-100' : 'opacity-0',
              )}
            >
              {compose.busy ? (
                <>
                  <Spinner className="size-3" />
                  <span>{nameOf(composeFor)} está pensando</span>
                </>
              ) : (
                /* O `Kbd` nasce `h-5 text-xs`: do tamanho exato da linha, e
                   maior que o texto ao lado dele. Aqui ele encolhe, para caber
                   na coluna de 272px sem empurrar nada para fora. */
                <>
                  <KbdGroup>
                    <Kbd className="h-4 min-w-4 px-1 text-[0.625rem]">Enter</Kbd>
                    <span>manda</span>
                  </KbdGroup>
                  <KbdGroup>
                    <Kbd className="h-4 min-w-4 px-1 text-[0.625rem]">Shift+Enter</Kbd>
                    <span>linha</span>
                  </KbdGroup>
                  <KbdGroup>
                    <Kbd className="h-4 min-w-4 px-1 text-[0.625rem]">Esc</Kbd>
                    <span>fecha</span>
                  </KbdGroup>
                </>
              )}
            </div>

            {/* O campo alinha a borda dele com o texto do cabecalho. */}
            <div className="px-2.5 pb-2.5">
              <InputGroup>
                <InputGroupTextarea
                  ref={draftRef}
                  rows={1}
                  className="max-h-24 text-sm"
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
                <InputGroupAddon align="block-end">
                  <InputGroupButton
                    size="icon-xs"
                    className="ml-auto"
                    style={
                      compose.busy || !compose.draft.trim()
                        ? undefined
                        : ({
                            background: colorOf(composeFor),
                            color: 'var(--primary-foreground)',
                          } as CSSProperties)
                    }
                    disabled={compose.busy || !compose.draft.trim()}
                    onClick={() => onSendMessage?.()}
                    aria-label={`Mandar para ${nameOf(composeFor)}`}
                  >
                    <SendIcon />
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </div>
          </Panel>
        )}

        {/* ------------------------------------------------------- O CHIP --
            DOIS ESTADOS, E ELE SALTA ENTRE OS DOIS.

            Antes o avatar, a alca e o nome cresciam de zero ate a largura
            deles em 240ms. Numa janela que veste o conteudo, animar o TAMANHO
            e uma briga que a janela sempre perde: ela chega alguns quadros
            depois e, nesse meio tempo, corta o que ha dentro — a barra piscava
            aumentando e diminuindo o tempo todo.

            Agora ou aparece, ou nao aparece. A janela muda de tamanho UMA vez
            por gesto, e ja no tamanho final: nao ha o que perseguir.

            A ALTURA nao muda nunca (`h-11`), mesmo com o chip vazio: assim o
            unico eixo que se mexe no hover e a largura. */}
        <div
          className={cn(
            'app-drag relative flex h-11 cursor-move items-center rounded-full border px-3 transition-colors',
            open || active ? 'border-border' : 'border-transparent',
            open
              ? 'bg-popover/90 shadow-2xl backdrop-blur-sm'
              : active
                ? 'bg-muted/60'
                : 'bg-transparent',
          )}
          style={{ '--agent': currentColor } as CSSProperties}
        >
          {/* AS BARRINHAS SAO O BOTAO.
              Elas sao a unica coisa que existe com a barra fechada, entao sao
              elas que abrem — e fecham. Precisam ser `no-drag`: no Windows uma
              area de arrasto engole o clique inteiro.

              O que sobra em volta delas (a folga do `px-3` dos lados e os 13px
              de cada lado dentro da altura de 44px) continua sendo arrasto, e e
              por ali que a janela se pega. */}
          <button
            type="button"
            className="app-no-drag focus-visible:ring-ring cursor-pointer rounded focus-visible:ring-2 focus-visible:outline-none"
            onClick={() => setOpen((isOpen) => !isOpen)}
            aria-expanded={open}
            aria-label={open ? 'Fechar a barra' : 'Abrir a barra'}
          >
            <span className="wave" data-live={active} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </button>

          {/* O NOME (e o cronometro) ficam EM FLUXO, dentro do chip: fora dele,
              a janela — que tem o tamanho do conteudo — cortava o texto pela
              metade. */}
          {(open || active) && (
            <span
              className="text-muted-foreground ml-2 max-w-38 truncate text-xs"
              aria-live="off"
            >
              {label}
            </span>
          )}

          {/* Tem recado esperando: um ponto, e so. Quem abre a lista ve o
              sininho com a conta. */}
          {unread > 0 && !queueOpen && !open && (
            <span
              className="absolute top-1.5 right-1.5 size-2 rounded-full"
              style={{ background: colorOf(messages[0].agentSlug) }}
              aria-hidden="true"
            />
          )}

          {open && (
            <span className="app-no-drag relative ml-2 flex items-center">
              {/* O AVATAR ESCREVE, NAO LIGA.
                  Ele era o "liga de novo num toque", e ligar e a acao mais cara
                  que existe aqui: abre microfone, gasta token e interrompe quem
                  esta do outro lado. Escrever e o gesto do dia a dia, e era o
                  que dava mais trabalho alcancar — a lista, a linha do agente,
                  o aviaozinho. Trocamos: o avatar abre o campo, e ligar
                  continua a um clique, no telefone da linha dele na lista.

                  Na ligacao viva ele nao muda de ideia: ali ele desliga. */}
              <button
                type="button"
                className="focus-visible:ring-ring rounded-full transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:outline-none"
                onClick={() => (active ? onHangUp() : writeTo(current.slug))}
                aria-label={
                  active
                    ? `Desligar a ligacao com ${current.name}`
                    : `Escrever para ${current.name}`
                }
              >
                <AgentAvatar
                  name={current.name}
                  color={currentColor}
                  src={avatarOf?.(current.slug)}
                  size={32}
                />
              </button>

              {/* O CHEVRON ABRE NO CLIQUE, E SO NO CLIQUE.
                  Abrir no hover transformava qualquer passagem do mouse — um
                  arrasto da janela, o caminho ate a engrenagem — em uma lista
                  aberta que ninguem pediu. E era ele que exigia os tres
                  remendos que sairam daqui: a marca de "abri no hover", o
                  guarda de 600ms contra reabrir e o relogio de intencao. */}
              <Button
                variant="secondary"
                size="icon-xs"
                className="absolute -top-1 right-0 size-4 rounded-full border"
                onClick={() => setMenuOpen((isOpen) => !isOpen)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Escolher outro agente"
              >
                <ChevronDownIcon className="size-2.5" />
              </Button>
            </span>
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}
