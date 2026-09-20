/**
 * Coisas de agente do lado da UI: cor, inicial e o historico de quem mais foi
 * chamado. O registro dos agentes continua sendo o `agents.json` lido pelo
 * bridge — aqui so mora o que e visual/local do browser.
 */

import type { AgentSummary } from './bridge'

/**
 * Paleta fixa da casa, na ordem em que os agentes aparecem no `agents.json`:
 * Automa, Ivo, Theo, Bravo, Flow, Vetor.
 */
const AGENT_COLORS = ['#4ade80', '#60a5fa', '#c084fc', '#fbbf24', '#f472b6', '#2dd4bf']

/** Cor do agente pela POSICAO dele na lista que o bridge devolve. */
export function agentColor(index: number): string {
  return AGENT_COLORS[((index % AGENT_COLORS.length) + AGENT_COLORS.length) % AGENT_COLORS.length]
}

/** A letra que aparece dentro do disco do avatar. */
export function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '?'
}

const COUNTS_KEY = 'calling:agent-call-counts'

/** Agente preferido quando ainda nao ha historico nenhum. */
const DEFAULT_AGENT_SLUG = 'automa'

type CallCounts = Record<string, number>

function readCounts(): CallCounts {
  try {
    const raw = window.localStorage.getItem(COUNTS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const counts: CallCounts = {}
    for (const [slug, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) counts[slug] = value
    }
    return counts
  } catch {
    // Aba anonima, storage bloqueado: seguimos sem historico.
    return {}
  }
}

/** Marca mais uma ligacao para o agente (o "ultimo chamado" sai daqui). */
export function registerCall(slug: string): CallCounts {
  const counts = readCounts()
  counts[slug] = (counts[slug] ?? 0) + 1
  try {
    window.localStorage.setItem(COUNTS_KEY, JSON.stringify(counts))
  } catch {
    // Sem storage o historico vira so memoria da sessao — nao e motivo de erro.
  }
  return counts
}

/**
 * Quem fica no chip por padrao: o agente com mais ligacoes no historico;
 * empate ou historico vazio caem no Automa e, na falta dele, no primeiro da lista.
 */
export function pickPreferredAgent(agents: AgentSummary[]): string {
  if (agents.length === 0) return ''
  const counts = readCounts()
  let best = ''
  let bestCount = 0
  for (const agent of agents) {
    const count = counts[agent.slug] ?? 0
    if (count > bestCount) {
      best = agent.slug
      bestCount = count
    }
  }
  if (best) return best
  const fallback = agents.find((a) => a.slug === DEFAULT_AGENT_SLUG)
  return fallback?.slug ?? agents[0].slug
}
