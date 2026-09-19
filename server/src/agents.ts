import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface AgentEntry {
  slug: string
  name: string
  workspace: string
  enabled: boolean
}

const here = dirname(fileURLToPath(import.meta.url))

/**
 * agents.json mora na raiz do repo. Em dev rodamos de server/src, no build de
 * server/dist — por isso procuramos subindo alguns niveis.
 */
function locateRegistry(): string {
  const candidates = [
    process.env.CALLING_AGENTS_FILE,
    resolve(here, '../../agents.json'),
    resolve(here, '../../../agents.json'),
    resolve(process.cwd(), 'agents.json'),
    resolve(process.cwd(), '../agents.json'),
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(
    'agents.json nao encontrado. Defina CALLING_AGENTS_FILE com o caminho absoluto.',
  )
}

let cache: AgentEntry[] | null = null

export function loadAgents(): AgentEntry[] {
  if (cache) return cache
  const file = locateRegistry()
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { agents?: AgentEntry[] }
  const agents = (parsed.agents ?? []).filter((a) => a.enabled)

  for (const agent of agents) {
    if (!existsSync(agent.workspace)) {
      console.warn(
        `[calling] aviso: workspace de "${agent.slug}" nao existe: ${agent.workspace}`,
      )
    }
  }

  cache = agents
  return agents
}

export function findAgent(slug: string): AgentEntry | undefined {
  // Comparacao estrita contra a allowlist: o slug vem de uma tool call do
  // modelo, entao nunca pode virar caminho de arquivo livremente.
  return loadAgents().find((a) => a.slug === slug)
}

/** Lista enxuta para a UI — sem expor caminhos do servidor. */
export function publicAgentList() {
  return loadAgents().map(({ slug, name }) => ({ slug, name }))
}
