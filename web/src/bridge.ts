/**
 * Cliente do bridge — o servidor que fala com os agentes de verdade.
 */

const BRIDGE_URL = (import.meta.env.VITE_BRIDGE_URL || 'http://localhost:8787').replace(
  /\/$/,
  '',
)
const SECRET = import.meta.env.VITE_CALLING_SHARED_SECRET || ''

export interface AgentSummary {
  slug: string
  name: string
}

export interface LiveTokenResponse {
  value: string
  model: string
  config: Record<string, unknown>
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BRIDGE_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${SECRET}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}) as { error?: string })
    throw new Error(detail.error || `Bridge respondeu ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function fetchAgents(): Promise<AgentSummary[]> {
  const res = await fetch(`${BRIDGE_URL}/api/agents`, {
    headers: { authorization: `Bearer ${SECRET}` },
  })
  if (!res.ok) throw new Error(`Nao consegui listar os agentes (${res.status})`)
  const data = (await res.json()) as { agents: AgentSummary[] }
  return data.agents
}

/** Pede ao bridge um token efemero da Gemini Live, ja com a config da sessao. */
export function createLiveToken(agentSlug: string): Promise<LiveTokenResponse> {
  return post<LiveTokenResponse>('/api/gemini-live-token', { agent: agentSlug })
}

/** Implementacao remota da tool ask_agent. */
export async function askAgent(input: {
  agent: string
  message: string
  callId: string
}): Promise<string> {
  const data = await post<{ reply: string }>('/api/ask', input)
  return data.reply
}

/** Avisa o bridge que a ligacao acabou, para ele descartar a sessao. */
export function endCall(callId: string): void {
  // keepalive: costuma sair durante o unload da pagina.
  void fetch(`${BRIDGE_URL}/api/end-call`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${SECRET}`,
    },
    body: JSON.stringify({ callId }),
    keepalive: true,
  }).catch(() => undefined)
}
