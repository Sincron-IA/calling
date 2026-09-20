/**
 * Cliente do bridge — o servidor que fala com os agentes de verdade.
 */

import { bridgeUrl, sharedSecret } from './config'

// Endereco e chave sao PERGUNTADOS a cada chamada, nao congelados no import:
// no navegador vem do `.env` (como sempre), no app de desktop vem da tela de
// conexao. Ver `config.ts`.

export interface AgentSummary {
  slug: string
  name: string
  /** Cor vinda do `agents.json` — opcional; sem ela a UI usa a paleta padrao. */
  color?: string
}

export interface LiveTokenResponse {
  value: string
  model: string
  config: Record<string, unknown>
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${bridgeUrl()}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${sharedSecret()}`,
    },
    body: JSON.stringify(body),
    // Leva o cookie do Cloudflare Access junto; sem ele o Access barra a
    // chamada antes de ela chegar no bridge.
    credentials: 'include',
  })

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}) as { error?: string })
    throw new Error(detail.error || `Bridge respondeu ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function fetchAgents(): Promise<AgentSummary[]> {
  const res = await fetch(`${bridgeUrl()}/api/agents`, {
    headers: { authorization: `Bearer ${sharedSecret()}` },
    credentials: 'include',
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
  void fetch(`${bridgeUrl()}/api/end-call`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${sharedSecret()}`,
    },
    body: JSON.stringify({ callId }),
    keepalive: true,
    credentials: 'include',
  }).catch(() => undefined)
}
