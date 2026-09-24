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
 * A janela do app de desktop e transparente, de tamanho fixo, com o chip num
 * canto — e esse canto troca conforme a metade da tela onde o chip esta (ver
 * `.grow-down`/`.grow-right` no `index.css`). O que esta EM FLUXO nesta coluna
 * vira junto de graca; um portal posicionado por coordenada nao vira, e ainda
 * pode nascer para o lado de fora da janela, cortado. E a parte transparente
 * deixa o clique passar: so o que tem `data-surface` segura o mouse.
 *
 * Entao o que abre aqui fica EM FLUXO, nesta coluna. O que e "componente
 * pronto" nao e o posicionamento — e o conteudo: `Item`, `ItemGroup`,
 * `ScrollArea`, `Badge`, `Avatar`, `Button`, `InputGroup`, `Kbd`, `Spinner`,
 * `Alert`. O `className` cuida do layout, que e o que `className` deve fazer.
 *
 * Isto esta registrado em `docs/SHADCN.md` — nao e um atalho, e a leitura
 * certa da restricao.
 */

import {
  useCallback,
  useEffect,
  useId,
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
  PhoneOffIcon,
  SendIcon,
  SettingsIcon,
  XIcon,
} from 'lucide-react'

import { Slot } from 'radix-ui'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Input } from '@/components/ui/input'
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
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { AgentAvatar, AgentAvatarStack } from './AgentAvatar'
import { AgentPanel } from './AgentPanel'
import type { AgentSummary } from './bridge'
import {
  INCOMING_CALL_TIMEOUT_MS,
  type DeclineCause,
  type IncomingCall,
  type LateAction,
} from './incoming'

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
  /**
   * Um TOQUE que passou do tempo sem decisao — o agente pediu e ninguem
   * respondeu. Este nao sai com o "Limpar" nem com um X: fica ate o Luiz
   * aprovar, ligar ou recusar. `text` e o motivo do toque.
   */
  call?: IncomingCall
  /** A decisao tardia esta indo para o agente (o recado ainda nao voltou). */
  busy?: boolean
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
  /**
   * Resolver o item pendente SEM abrir voz.
   *
   * `reply` e o recado que o dono escreveu no cartao, quando escreveu algum: a
   * barra so carrega o texto daqui ate quem trata a decisao.
   */
  onApprove: (call: IncomingCall, reply?: string) => void
  /** Atender por voz (abre a ligacao de verdade). */
  onAnswer: (call: IncomingCall) => void
  /** Recusar — quem trata isso e responsavel por cair para o Telegram. */
  onDecline: (call: IncomingCall, cause: DeclineCause, reply?: string) => void
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
  /**
   * As notificacoes, da mais nova para a mais velha: os recados que os
   * agentes empurraram e os toques que ficaram sem resposta.
   */
  messages?: QueuedMessage[]
  /** As notificacoes foram abertas: tudo o que estava nelas conta como lido. */
  onMessagesRead?: () => void
  /** Tirar UM recado da fila. */
  onDismissMessage?: (id: string) => void
  /** Esvaziar os recados (os toques pendentes ficam). */
  onClearMessages?: () => void
  /**
   * Decidir um toque que ficou para depois. `reply` e o recado escrito junto,
   * como no cartao do toque vivo.
   */
  onResolveLate?: (item: QueuedMessage, action: LateAction, reply?: string) => void
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
export function formatClock(at: number): string {
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
      // Cartao segura o clique; a transparencia em volta deixa passar.
      data-surface=""
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

/*
 * O CAMPO DE RESPOSTA.
 *
 * Aprovar e recusar sao gestos mudos: o agente descobre o desfecho e nada
 * mais. O teclado abre uma linha para o dono dizer POR QUE — e so isso vai
 * junto na decisao. Atender por voz nao usa: ali ele responde falando.
 *
 * Mora aqui em cima porque serve a dois lugares: o cartao do toque vivo e o
 * toque que ficou para depois, nas notificacoes.
 */
function useReplyDraft() {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const id = useId()
  const ref = useRef<HTMLInputElement | null>(null)

  // Abriu, o cursor ja esta la: o clique no teclado e o pedido de escrever, nao
  // o pedido de ver um campo para depois clicar nele.
  useEffect(() => {
    if (open) ref.current?.focus()
  }, [open])

  /* O que segue com a decisao: so existe se o campo estiver ABERTO e com texto
     de verdade. Fechado (ou vazio) o payload e exatamente o de sempre. */
  const reply = open ? text.trim() || undefined : undefined

  return { open, setOpen, text, setText, id, ref, reply }
}

type ReplyDraft = ReturnType<typeof useReplyDraft>

/** O teclado que abre o campo. Some ate o mouse chegar no cartao. */
function ReplyToggle({
  draft,
  agentName,
  color,
}: {
  draft: ReplyDraft
  agentName: string
  color: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          /* Escondido ate o mouse chegar no CARTAO (nao no proprio botao — um
             alvo invisivel nao se acha). Fade + escala de uma passada so: nada
             aqui fica se mexendo sozinho. */
          className={cn(
            'transition-[opacity,transform,color] duration-200 ease-out focus-visible:scale-100 focus-visible:opacity-100',
            'group-hover/incoming:scale-100 group-hover/incoming:opacity-100',
            draft.open ? 'scale-100 opacity-100' : 'text-muted-foreground scale-[0.8] opacity-0',
          )}
          // Aceso na cor do agente — e so o traco do icone, sem chip atras.
          style={draft.open ? { color } : undefined}
          // `aria-pressed` e nao `aria-expanded`: o `ghost` pinta um fundo no
          // expandido, e o desenho aprovado nao tem fundo nenhum.
          aria-pressed={draft.open}
          aria-controls={draft.id}
          onClick={() => draft.setOpen((open) => !open)}
          aria-label={`Escrever uma resposta para ${agentName}`}
        >
          <KeyboardIcon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Responder por escrito</TooltipContent>
    </Tooltip>
  )
}

/**
 * A linha de escrever.
 *
 * A ALTURA E ANIMADA PELO GRID. `0fr` -> `1fr` deixa o proprio conteudo dizer o
 * tamanho, sem pulo e sem ninguem medindo pixel em JS. O filho precisa de
 * `min-h-0` + `overflow-hidden`, senao ele nao aceita ser espremido ate zero.
 */
function ReplyField({
  draft,
  agentName,
  className,
}: {
  draft: ReplyDraft
  agentName: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'grid transition-[grid-template-rows] duration-200 ease-out',
        draft.open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
      )}
    >
      <div className="min-h-0 overflow-hidden">
        <div className={className}>
          <Label htmlFor={draft.id} className="sr-only">
            Resposta para {agentName}
          </Label>
          <Input
            id={draft.id}
            ref={draft.ref}
            value={draft.text}
            onChange={(event) => draft.setText(event.target.value)}
            placeholder="Escreva algo pro agente"
            // Fechado ele continua no layout (e o que da a animacao), entao sai
            // da ordem do Tab para nao virar uma parada invisivel.
            tabIndex={draft.open ? undefined : -1}
            maxLength={500}
            className="h-7 text-[0.8rem]"
          />
        </div>
      </div>
    </div>
  )
}

/** Aprovar (o gesto principal), atender por voz e recusar. */
function DecisionButtons({
  agentName,
  busy = false,
  declineHint,
  onApprove,
  onAnswer,
  onDecline,
  className,
}: {
  agentName: string
  /** A decisao esta a caminho: nada aqui aceita um segundo clique. */
  busy?: boolean
  declineHint: string
  onApprove: () => void
  onAnswer: () => void
  onDecline: () => void
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Button size="sm" className="flex-1" onClick={onApprove} disabled={busy}>
        {busy ? <Spinner data-icon="inline-start" /> : <CheckIcon data-icon="inline-start" />}
        Aprovar
      </Button>
      <ButtonGroup>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={onAnswer}
              disabled={busy}
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
              onClick={onDecline}
              disabled={busy}
              aria-label={`Recusar o pedido de ${agentName}`}
            >
              <XIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{declineHint}</TooltipContent>
        </Tooltip>
      </ButtonGroup>
    </div>
  )
}

interface IncomingCardProps {
  call: IncomingCall
  agentName: string
  color: string
  avatar?: string
  /** `reply`: o recado que o dono escreveu no cartao, quando escreveu algum. */
  onApprove: (call: IncomingCall, reply?: string) => void
  onAnswer: (call: IncomingCall) => void
  onDecline: (call: IncomingCall, cause: DeclineCause, reply?: string) => void
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
  const draft = useReplyDraft()
  const { reply } = draft

  // Handler isolado de proposito: se um dia o "Aprovar" precisar de confirmacao
  // (duplo clique, undo), e aqui dentro que ela entra, sem mexer no resto.
  const approve = useCallback(() => onApprove(call, reply), [onApprove, call, reply])

  // Quanto ainda falta para o toque sair daqui e ir para as notificacoes. Quem
  // manda e o SERVIDOR (`expiresAt`); a constante local so cobre o caso de ele
  // nao ter mandado.
  const expiresAt = call.expiresAt ?? call.receivedAt + INCOMING_CALL_TIMEOUT_MS
  const left = Math.max(0, expiresAt - Date.now())

  return (
    <Panel
      role="group"
      aria-label={`Chamada de ${agentName}`}
      // Sozinho, o cartao e o que ocupa o lugar do chip: fica parado no canto.
      data-anchor={inline ? undefined : ''}
      className={cn('group/incoming', !inline && 'ring-1', RAIL)}
      style={
        {
          '--agent': color,
          /* O CARTAO PARA DE BRILHAR.
             A borda na cor cheia e o halo grande faziam o cartao vazar para
             fora de si mesmo — na tela do Luiz parecia um corte de luz em volta
             da caixa. A cor continua dizendo de quem e o toque; ela so nao grita
             mais. */
          borderColor: `color-mix(in oklch, ${color}, transparent 82%)`,
          // O brilho e do CARTAO destacado; na lista ele viraria seis brilhos.
          boxShadow: inline ? undefined : `0 0 0 1px ${color}0d, 0 10px 22px -18px ${color}4d`,
        } as CSSProperties
      }
    >
      {/* O cabecalho e a alca: sozinho, o cartao arrasta a barra. */}
      <Item
        size="sm"
        className={cn('border-0', !inline && 'cursor-move')}
        data-drag-handle={inline ? undefined : ''}
      >
        <ItemMedia>
          <AgentAvatar name={agentName} color={color} src={avatar} size={24} />
        </ItemMedia>
        <ItemContent>
          <ItemTitle style={{ color }}>{agentName}</ItemTitle>
        </ItemContent>
        <ItemActions>
          <ReplyToggle draft={draft} agentName={agentName} color={color} />
        </ItemActions>
      </Item>

      <p className="text-foreground px-3 pb-2.5 text-sm leading-snug">{call.reason}</p>

      <ReplyField draft={draft} agentName={agentName} className="px-2.5 pb-2.5" />

      <DecisionButtons
        agentName={agentName}
        declineHint="Recusar — cai para o Telegram"
        onApprove={approve}
        onAnswer={() => onAnswer(call)}
        onDecline={() => onDecline(call, 'manual', reply)}
        className="px-2.5 pb-2.5"
      />

      {/* O toque nao fica de pe para sempre, e o filete diz quanto falta para
          ele ir para as notificacoes. */}
      <Timer key={call.id} ms={left} color={color} />
    </Panel>
  )
}

/* ----------------------------------------------- toque que ficou pendente -- */

/**
 * Um toque que passou do tempo sem ninguem decidir.
 *
 * O `/api/ring` do agente ja voltou com `no_answer` — ele seguiu a vida e
 * talvez tenha perguntado no Telegram. Mas o pedido continua valendo, e some
 * da tela era perder o pedido. Aqui ele fica com as mesmas tres saidas do
 * cartao vivo; a decisao chega ao agente por recado escrito (quem monta o
 * texto e o `App`).
 */
function LateCallItem({
  item,
  agentName,
  color,
  avatar = '',
  onResolve,
}: {
  item: QueuedMessage
  agentName: string
  color: string
  avatar?: string
  onResolve?: (item: QueuedMessage, action: LateAction, reply?: string) => void
}) {
  const draft = useReplyDraft()
  const busy = item.busy === true

  return (
    <Item
      size="sm"
      className="group/incoming items-start border-0"
      role="group"
      aria-label={`Pedido de ${agentName} esperando resposta`}
      aria-busy={busy}
    >
      <ItemMedia className="pt-0.5">
        <AgentAvatar name={agentName} color={color} src={avatar} size={20} />
      </ItemMedia>
      <ItemContent className="min-w-0 flex-1 gap-1">
        <ItemTitle className="gap-1.5">
          <span style={{ color }}>{agentName}</span>
          <span className="text-muted-foreground font-mono text-[0.625rem] font-normal tabular-nums">
            {formatClock(item.at)}
          </span>
          <Badge
            variant="outline"
            className="h-4 px-1.5 text-[0.625rem] font-normal"
            style={{ borderColor: `color-mix(in oklch, ${color}, transparent 60%)` }}
          >
            esperando você
          </Badge>
        </ItemTitle>
        <ItemDescription className="text-foreground line-clamp-none">{item.text}</ItemDescription>
        <ReplyField draft={draft} agentName={agentName} className="pt-1" />
        <DecisionButtons
          agentName={agentName}
          busy={busy}
          declineHint="Recusar — ele fica sabendo por escrito"
          onApprove={() => onResolve?.(item, 'approve', draft.reply)}
          onAnswer={() => onResolve?.(item, 'answer')}
          onDecline={() => onResolve?.(item, 'decline', draft.reply)}
          className="pt-1"
        />
      </ItemContent>
      <ItemActions className="self-start">
        <ReplyToggle draft={draft} agentName={agentName} color={color} />
      </ItemActions>
    </Item>
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
  onResolveLate,
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
  // As notificacoes estao abertas.
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
     um clique que feche sem exigir mira no mesmo alvo de novo.

     No app de desktop o "fora" quase sempre e OUTRO app: a parte transparente
     da janela deixa o clique passar, e ele nunca chega aqui. O que chega e a
     janela perdendo o foco — e ai fecham a lista e a pilha. A barra aberta
     fica: ela nao cobre nada, e e nela que o agente do chip aparece. */
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
    const onBlur = () => {
      setMenuOpen(false)
      setStackOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', onBlur)
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

  /* O campo acompanha o texto ate um teto; passado ele, rola por dentro. */
  useEffect(() => {
    const el = draftRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`
  }, [compose?.draft, composeFor])

  const unread = useMemo(() => messages.filter((m) => !m.read).length, [messages])

  /* As notificacoes em dois grupos: primeiro o que ESPERA uma decisao (os
     toques que ficaram para depois), depois os recados. Cada grupo do mais
     novo para o mais velho, que e a ordem em que chegam. */
  const pending = useMemo(() => messages.filter((m) => m.call), [messages])
  const plain = useMemo(() => messages.filter((m) => !m.call), [messages])

  /* O sino fica aceso na cor de quem pede atencao: o recado novo mais
     recente, ou — sem nada novo — o toque mais recente ainda esperando. */
  const alertFrom = messages.find((m) => !m.read) ?? pending[0]

  const toggleQueue = useCallback(() => {
    setMenuOpen(false)
    // Abrir e ler: tudo o que estava ali conta como visto.
    if (!queueOpen) onMessagesRead?.()
    setQueueOpen(!queueOpen)
  }, [queueOpen, onMessagesRead])

  // Esvaziou (tudo decidido, tudo limpo): nao ha o que mostrar aberto.
  useEffect(() => {
    if (messages.length === 0) setQueueOpen(false)
  }, [messages.length])

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

  /* A coluna. Alinhada a direita, de baixo para cima — com o chip na metade de
     cima (ou da esquerda) da tela, o `.grow-down` (`.grow-right`) do
     `index.css` inverte o sentido (ver `DesktopGate`). A classe
     `calling-stack` e o gancho dessas regras; nao estiliza nada sozinha. */
  const column = 'calling-stack flex flex-col items-end gap-2'

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
            // A lista inteira segura o mouse, frestas incluidas: e nela que a
            // roda rola.
            <ScrollArea className={cn('max-h-105', RAIL)} data-surface="">
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

          {/* No lugar do chip: segura o mouse, fica parado no canto e arrasta
              a barra (o clique so abre se o cursor nao andou). */}
          <Button
            variant="outline"
            className="app-no-drag bg-popover h-11 rounded-full pr-3.5 pl-2.5 shadow-2xl"
            data-surface=""
            data-anchor=""
            data-drag-handle=""
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
            className={cn(reply.isError && 'border-destructive/40')}
            style={{ '--agent': colorOf(reply.agentSlug) } as CSSProperties}
            onPointerEnter={() => setReplyHeld(true)}
            onPointerLeave={() => setReplyHeld(false)}
            aria-live="polite"
          >
            <div className="flex items-center justify-between gap-2 px-3 pt-2.5">
              <span className="flex min-w-0 items-center gap-1.5">
                {!reply.isError && (
                  <AgentAvatar
                    name={nameOf(reply.agentSlug)}
                    color={colorOf(reply.agentSlug)}
                    src={avatarOf?.(reply.agentSlug)}
                    size={16}
                  />
                )}
                <Eyebrow
                  className={cn('truncate', reply.isError && 'text-destructive')}
                  style={reply.isError ? undefined : { color: colorOf(reply.agentSlug) }}
                >
                  {reply.isError ? 'não consegui mandar' : nameOf(reply.agentSlug)}
                </Eyebrow>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {reply.echoed && (
                  <Badge variant="outline" className="gap-1 text-[0.625rem]">
                    <CheckIcon className="size-2.5" />
                    na thread
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onReplyDone?.()}
                  aria-label="Fechar"
                >
                  <XIcon />
                </Button>
              </span>
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

              {/* O sino morava aqui, e so aparecia com a lista aberta. Agora ele
                  mora no proprio chip, de pe enquanto houver notificacao. */}

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

        {/* AS NOTIFICACOES.
            O balao mostra o mais novo e sai sozinho; aqui fica tudo o que
            chegou enquanto ninguem estava olhando — os recados e, primeiro, os
            toques que passaram do tempo e ainda esperam uma decisao. */}
        {queueOpen && (
          <Panel role="dialog" aria-label="Notificações">
            <PanelHead label="Notificações">
              {/* Limpar leva so os recados: pedido esperando decisao nao se
                  apaga, se decide. */}
              {plain.length > 0 && (
                <Button variant="ghost" size="xs" onClick={() => onClearMessages?.()}>
                  {pending.length > 0 ? 'Limpar recados' : 'Limpar'}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setQueueOpen(false)}
                aria-label="Fechar as notificações"
              >
                <XIcon />
              </Button>
            </PanelHead>

            <Separator />

            <ScrollArea className="max-h-100">
              {pending.length > 0 && (
                <ItemGroup className="p-1">
                  {pending.map((item) => (
                    <LateCallItem
                      key={item.id}
                      item={item}
                      agentName={nameOf(item.agentSlug)}
                      color={colorOf(item.agentSlug)}
                      avatar={avatarOf?.(item.agentSlug)}
                      onResolve={onResolveLate}
                    />
                  ))}
                </ItemGroup>
              )}

              {pending.length > 0 && plain.length > 0 && <Separator />}

              {plain.length > 0 && (
                <ItemGroup className="p-1">
                  {plain.map((message) => (
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
              )}
            </ScrollArea>
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
                do mouse pelo `i`. Fica DENTRO do card, mas fora da caixa
                cinza do campo — cada uma com o fundo que e dela. */}
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

            Ou aparece, ou nao aparece: animar o TAMANHO do chip era o que
            fazia a barra piscar, no tempo em que a janela corria atras dele.

            A ALTURA nao muda nunca (`h-11`), mesmo com o chip vazio.

            O chip inteiro e a alca (`data-drag-handle`): segurou e andou, e
            arrasto — ate em cima das barrinhas ou do avatar. Clicou sem andar,
            e o clique de sempre. E ele e a ancora (`data-anchor`): o ponto que
            fica parado na tela quando o resto troca de lado. */}
        <div
          data-surface=""
          data-anchor=""
          data-drag-handle=""
          className={cn(
            'relative flex h-11 cursor-move items-center rounded-full border px-3 transition-colors',
            open || active || messages.length > 0 ? 'border-border' : 'border-transparent',
            open
              ? 'bg-popover/90 shadow-2xl backdrop-blur-sm'
              : active || messages.length > 0
                ? 'bg-muted/60'
                : 'bg-transparent',
          )}
          style={{ '--agent': currentColor } as CSSProperties}
        >
          {/* O SINO FICA DE PE ENQUANTO HOUVER NOTIFICACAO.
              Antes era um ponto que sumia assim que a fila era aberta — e com
              ele sumia a lembranca de que havia coisa ali, inclusive pedido
              esperando decisao. Agora ele so sai quando a fila esvazia: aceso
              na cor de quem pede atencao (recado novo ou toque pendente), apagado
              quando tudo ja foi visto. Um clique abre as notificacoes. */}
          {messages.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="relative mr-1.5 -ml-1.5 rounded-full"
                  style={alertFrom ? { color: colorOf(alertFrom.agentSlug) } : undefined}
                  onClick={toggleQueue}
                  aria-expanded={queueOpen}
                  aria-label={
                    unread > 0
                      ? `Notificações (${unread} ${unread === 1 ? 'nova' : 'novas'})`
                      : 'Notificações'
                  }
                >
                  <BellIcon />
                  {unread > 0 && (
                    <Badge
                      className="absolute -top-1 -right-1 size-3.5 justify-center rounded-full p-0 text-[0.5rem] tabular-nums"
                      style={{
                        background: colorOf(alertFrom?.agentSlug ?? messages[0].agentSlug),
                        color: 'var(--primary-foreground)',
                      }}
                    >
                      {unread > 9 ? '9+' : unread}
                    </Badge>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {pending.length > 0
                  ? `Notificações · ${pending.length} esperando você`
                  : 'Notificações'}
              </TooltipContent>
            </Tooltip>
          )}

          {/* AS BARRINHAS SAO O BOTAO.
              Elas sao a unica coisa que existe com a barra fechada, entao sao
              elas que abrem — e fecham. */}
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

          {/* O NOME (e o cronometro) ficam EM FLUXO, dentro do chip. */}
          {(open || active) && (
            <span
              className="text-muted-foreground ml-2 max-w-38 truncate text-xs"
              aria-live="off"
            >
              {label}
            </span>
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

                  Na ligacao viva ele nao muda de ideia: ali ele desliga — e
                  o disco continua ele mesmo, sempre. So o telefone cortado
                  no canto (pequeno, sempre vermelho) diz o que o clique faz;
                  o fundo vermelho, contido no circulo, e so do hover — nao
                  fica tudo vermelho o tempo inteiro da ligacao. */}
              <button
                type="button"
                className="group focus-visible:ring-ring relative rounded-full transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:outline-none"
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
                {active && (
                  /* Por CIMA do disco, nao atras: o `AgentAvatar` e opaco de
                     proposito (para nao vazar um disco por tras do outro nas
                     pilhas), entao um veu atras dele nunca apareceria. */
                  <span
                    aria-hidden="true"
                    className="bg-destructive/25 absolute inset-0 rounded-full opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                  />
                )}
                {active && (
                  <span
                    className="bg-background text-destructive absolute -right-0.5 -bottom-0.5 grid size-3.5 place-items-center rounded-full"
                    aria-hidden="true"
                  >
                    <PhoneOffIcon className="size-2" />
                  </span>
                )}
              </button>

              {/* O CHEVRON ABRE NO CLIQUE, E SO NO CLIQUE.
                  Abrir no hover transformava qualquer passagem do mouse — um
                  arrasto da janela, o caminho ate a engrenagem — em uma lista
                  aberta que ninguem pediu. E era ele que exigia os tres
                  remendos que sairam daqui: a marca de "abri no hover", o
                  guarda de 600ms contra reabrir e o relogio de intencao.

                  (Ele virava a bolinha do recado quando havia coisa nova; o
                  aviso agora e do sino, e o V volta a ser so o V.) */}
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
