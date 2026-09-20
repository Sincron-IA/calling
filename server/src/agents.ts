import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { agentIdentity } from './identity-file.js'

export interface AgentEntry {
  slug: string
  name: string
  workspace: string
  enabled: boolean
  /** Cor do agente na UI (hex). Opcional: sem ela a web usa a paleta padrao. */
  color?: string
}

/**
 * Nome da variavel de ambiente com o segredo de TOQUE daquele agente.
 *
 * Segredo NUNCA mora no agents.json (que e publico no GitHub): mora no .env
 * privado carregado pelo EnvironmentFile do systemd. Adicionar um agente novo
 * ao Calling e, por isso, uma entrada aqui + uma linha no .env — sem codigo.
 */
export function ringTokenEnvName(slug: string): string {
  return `CALLING_RING_TOKEN_${slug.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
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

/**
 * Lista enxuta para a UI — sem expor caminhos do servidor.
 *
 * Nome e cor saem da IDENTIDADE (o arquivo no workspace do agente), com o
 * `agents.json` como valor de partida. `avatarVersion` e o mtime da imagem: e
 * o que impede a UI de ficar com a figura velha em cache depois que o agente
 * troca a propria cara. Zero = sem imagem.
 */
export function publicAgentList() {
  return loadAgents().map((agent) => {
    const identity = agentIdentity(agent)
    return {
      slug: agent.slug,
      name: identity.name,
      color: identity.color,
      avatarVersion: identity.avatarVersion,
    }
  })
}
