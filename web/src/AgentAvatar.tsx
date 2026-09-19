import { useMemo, type CSSProperties } from 'react'
import { Orb, defineOrbTheme } from 'orb-ui'
import type { OrbAdapter } from 'orb-ui'
import type { AgentSummary } from './bridge'

/** Estado visual de um avatar. Espelha a fase da ligacao, do ponto de vista dele. */
export type AvatarStatus = 'idle' | 'ringing' | 'in-call'

/**
 * Paleta fixa da casa. A cor de cada agente vem da POSICAO dele na lista que o
 * bridge devolve — o registro dos agentes continua sendo o `agents.json`.
 */
const AGENT_COLORS = ['#4ade80', '#60a5fa', '#c084fc', '#fbbf24', '#f472b6', '#2dd4bf']

export function agentColor(index: number): string {
  return AGENT_COLORS[((index % AGENT_COLORS.length) + AGENT_COLORS.length) % AGENT_COLORS.length]
}

interface AgentAvatarProps {
  agent: AgentSummary
  /** Cor do agente (veja `agentColor`). */
  color: string
  status: AvatarStatus
  /** Grande e em foco, ou pequeno na fila. */
  variant: 'main' | 'queued'
  /** Adapter da ligacao viva — so o avatar em `in-call` recebe um. */
  adapter?: OrbAdapter
  /** O agente esta pensando (o bridge foi consultado e ainda nao voltou). */
  waiting?: boolean
  disabled?: boolean
  onClick: () => void
}

const SIZES = { main: 176, queued: 64 } as const

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase()
}

function labelFor(agent: AgentSummary, status: AvatarStatus): string {
  if (status === 'in-call') return `Desligar a ligacao com ${agent.name}`
  if (status === 'ringing') return `Cancelar a chamada para ${agent.name}`
  return `Ligar para ${agent.name}`
}

export function AgentAvatar({
  agent,
  color,
  status,
  variant,
  adapter,
  waiting = false,
  disabled = false,
  onClick,
}: AgentAvatarProps) {
  // Bars no preset "calm": barras lentas, transicao longa. E o jeito de o orb-ui
  // reagir ao audio sem ficar agitado.
  const theme = useMemo(
    () =>
      defineOrbTheme({
        name: 'bars',
        preset: 'calm',
        appearance: {
          colors: {
            idle: '#8b95a3',
            connecting: color,
            listening: color,
            thinking: color,
            speaking: color,
            error: '#f87171',
          },
        },
        motion: { loadingTempo: 0.35 },
      }),
    [color],
  )

  const size = SIZES[variant]
  const active = status !== 'idle'

  return (
    <div
      className={`avatar avatar--${variant}${active ? ` is-${status === 'in-call' ? 'live' : 'ringing'}` : ''}`}
      style={{ '--avatar-color': color, '--avatar-size': `${size}px` } as CSSProperties}
    >
      <span className="avatar__stage">
        <button
          type="button"
          className="avatar__disc"
          onClick={onClick}
          disabled={disabled}
          aria-label={labelFor(agent, status)}
          aria-pressed={active}
          title={agent.name}
        >
          <span className="avatar__halo" aria-hidden="true" />
          <span className="avatar__mono" aria-hidden="true">
            {initialOf(agent.name)}
          </span>
        </button>
        {/* Fora do botao porque o orb-ui renderiza uma div; `pointer-events: none`
            deixa o clique atravessar ate o disco. */}
        {active && (
          <Orb
            className="avatar__orb"
            // Em `ringing` ainda nao ha audio: o estado `connecting` do orb-ui ja
            // e uma onda lenta de barras. Na ligacao, o adapter assume.
            adapter={status === 'in-call' ? adapter : undefined}
            state={status === 'ringing' ? 'connecting' : waiting ? 'thinking' : undefined}
            theme={theme}
            // O orb-ui escreve `position` no style do root; o resto da
            // centralizacao mora no CSS (.avatar__orb).
            style={{ position: 'absolute' }}
            interactive={false}
            size={Math.round(size * 0.66)}
            aria-hidden="true"
          />
        )}
      </span>
      <span className="avatar__name">{agent.name}</span>
    </div>
  )
}
