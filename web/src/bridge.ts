/**
 * Cliente do bridge — o servidor que fala com os agentes de verdade.
 */

import { bridgeUrl, sharedSecret } from './config'
import { isDesktop } from './desktop'

// Endereco e chave sao PERGUNTADOS a cada chamada, nao congelados no import:
// no navegador vem do `.env` (como sempre), no app de desktop vem da tela de
// conexao. Ver `config.ts`.

/**
 * A chamada NEM CHEGOU no bridge.
 *
 * O `fetch` do navegador levanta um `TypeError` seco — "Failed to fetch" — para
 * tudo que morre antes de virar resposta HTTP: rede fora, TLS, DNS e, o caso
 * que morde aqui, resposta cross-origin SEM os cabecalhos de CORS. E isso que o
 * Cloudflare Access devolve quando barra a chamada antes de ela chegar no Node:
 * a pagina de login dele, que nao libera a origem do app.
 *
 * Erro NOSSO tem status e corpo ("Bridge respondeu 401"); este nao tem nada. Por
 * isso ele vira uma classe propria: a tela precisa poder dizer o que fazer em
 * vez de repetir um "Failed to fetch" que nao ajuda ninguem.
 */
export class BridgeUnreachableError extends Error {
  /** O erro cru do `fetch`, para quem for depurar pelo console. */
  readonly reason: unknown

  constructor(reason?: unknown) {
    super(
      isDesktop
        ? 'Não consegui falar com o bridge — a chamada nem chegou lá. Pode ser a sessão do Cloudflare: abra a engrenagem e conecte de novo.'
        : 'Não consegui falar com o bridge — a chamada nem chegou lá. Confira a conexão e o acesso ao Cloudflare.',
    )
    this.name = 'BridgeUnreachableError'
    this.reason = reason
  }
}

/**
 * Um `fetch` so, com a falha de rede ja traduzida.
 *
 * Todo mundo aqui passa por esta porta: assim nenhuma rota nova esquece de
 * tratar o caso, e a mensagem do Cloudflare e a MESMA em qualquer tela.
 */
async function call(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${bridgeUrl()}${path}`, {
      ...init,
      // Leva o cookie do Cloudflare Access junto; sem ele o Access barra a
      // chamada antes de ela chegar no bridge.
      credentials: 'include',
    })
  } catch (err) {
    throw new BridgeUnreachableError(err)
  }
}

export interface AgentSummary {
  slug: string
  name: string
  /**
   * Cor que o BRIDGE decidiu: o arquivo de identidade do agente, com o
   * `agents.json` como valor de partida. Sem nenhum dos dois, a UI cai na
   * paleta fixa.
   */
  color?: string
  /**
   * Quando a imagem do agente mudou (mtime em ms). Zero ou ausente = ele nao
   * tem imagem e o avatar continua sendo a inicial.
   */
  avatarVersion?: number
}

export interface LiveTokenResponse {
  value: string
  model: string
  config: Record<string, unknown>
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await call(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${sharedSecret()}`,
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
  const res = await call('/api/agents', {
    headers: { authorization: `Bearer ${sharedSecret()}` },
  })
  if (!res.ok) throw new Error(`Nao consegui listar os agentes (${res.status})`)
  const data = (await res.json()) as { agents: AgentSummary[] }
  return data.agents
}

/** Pede ao bridge um token efemero da Gemini Live, ja com a config da sessao. */
export function createLiveToken(agentSlug: string): Promise<LiveTokenResponse> {
  return post<LiveTokenResponse>('/api/gemini-live-token', { agent: agentSlug })
}

/** O mesmo teto do bridge — recusar aqui evita subir 2 MB para levar 413. */
export const MAX_AVATAR_BYTES = 512 * 1024

export interface IdentityInput {
  name: string
  color: string
  /**
   * Data URL com a imagem nova, `null` para remover, `undefined` para deixar a
   * que ja esta la.
   */
  avatar?: string | null
}

/**
 * Grava nome, cor e imagem de um agente — os tres de uma vez.
 *
 * A imagem viaja NO MESMO corpo de proposito: e uma mudanca so, e mandar a
 * figura por fora abriria a porta para metade dela ficar gravada. Devolve a
 * lista ja atualizada, para a UI nao ter que perguntar de novo.
 */
export async function saveIdentity(
  agentSlug: string,
  input: IdentityInput,
): Promise<AgentSummary[]> {
  const res = await call(`/api/agents/${encodeURIComponent(agentSlug)}/identity`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${sharedSecret()}`,
    },
    body: JSON.stringify(input),
  })

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}) as { error?: string })
    throw new Error(detail.error || `Bridge respondeu ${res.status}`)
  }

  const data = (await res.json()) as { agents: AgentSummary[] }
  return data.agents
}

/**
 * Baixa a imagem de um agente e devolve uma URL local para o `<img>`.
 *
 * Nao da para apontar o `src` direto para o bridge: a rota exige o cabecalho
 * `Authorization`, que uma tag `<img>` nao sabe mandar. Entao buscamos com
 * `fetch` (que leva a chave e o cookie do Access) e viramos um blob.
 *
 * Quem chama e dono da URL: precisa soltar com `URL.revokeObjectURL`.
 */
export async function fetchAvatar(agentSlug: string, version: number): Promise<string> {
  const res = await call(
    `/api/agents/${encodeURIComponent(agentSlug)}/avatar?v=${version}`,
    { headers: { authorization: `Bearer ${sharedSecret()}` } },
  )
  if (!res.ok) throw new Error(`Sem imagem para ${agentSlug} (${res.status})`)
  return URL.createObjectURL(await res.blob())
}

/**
 * Recado escrito para um agente.
 *
 * Rota propria, nao a `/api/ask`: aquela e do caminho de voz e amarra a sessao
 * ao `callId` da ligacao. Aqui a sessao e do agente e dura entre mensagens.
 */
export interface MessageResult {
  reply: string
  /** O recado tambem chegou na thread do agente no Telegram. */
  echoed: boolean
}

export async function sendMessage(agentSlug: string, text: string): Promise<MessageResult> {
  const data = await post<{ reply: string; echoed?: boolean }>('/api/message', {
    agent: agentSlug,
    text,
  })
  // Bridge antigo nao manda `echoed`: sem a informacao, nao afirmamos nada.
  return { reply: data.reply, echoed: data.echoed === true }
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
