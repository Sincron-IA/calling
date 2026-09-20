/**
 * Chamadas RECEBIDAS — quando um agente e que liga para o Luiz.
 *
 * O canal e real: o bridge mantem um fluxo SSE (`GET /api/incoming/stream`) e
 * empurra cada toque assim que ele chega. Escolhemos SSE e nao websocket
 * porque o transito aqui e de mao unica (servidor -> browser), o EventSource
 * reconecta sozinho e um stream HTTP comum atravessa o tunel/Access sem
 * upgrade de protocolo.
 *
 * As acoes (aprovar, atender, recusar) voltam em POST normal, e e o SERVIDOR
 * que solta a chamada HTTP que o agente deixou pendurada no `/api/ring`.
 */

import { BRIDGE_URL, SHARED_SECRET } from './bridge'

export interface IncomingCall {
  /** Id da chamada, gerado pelo bridge. E por ele que a acao volta. */
  id: string
  /** Slug do agente que esta ligando (o bridge deduz do segredo dele). */
  agentSlug: string
  /**
   * Uma linha escrita pelo agente dizendo POR QUE ligou
   * (ex.: "Decisao pendente: adiar o compromisso das 15h?").
   *
   * A UI trata isso como texto opaco: renderiza como veio, sem interpretar.
   */
  reason: string
  /** Quando a chamada chegou (ms). */
  receivedAt: number
  /** Instante (ms) em que o toque expira no SERVIDOR. Manda quem manda. */
  expiresAt?: number
  /** Nome do agente ja resolvido pelo bridge (fallback se a lista falhar). */
  agentName?: string
}

/** Por que a chamada foi recusada: no dedo do Luiz ou por tempo esgotado. */
export type DeclineCause = 'manual' | 'timeout'

/**
 * Quanto tempo o toque fica de pe antes de virar recusa por falta de resposta.
 *
 * ATENCAO: o valor de verdade e o do servidor (RING_TIMEOUT_MS em
 * `server/src/ring.ts`), que chega em cada toque no campo `expiresAt`. Esta
 * constante e so o fallback de quando o campo nao vier.
 */
export const INCOMING_CALL_TIMEOUT_MS = 30_000

type Listener = (calls: IncomingCall[]) => void

let calls: IncomingCall[] = []
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) listener(calls)
}

function setCalls(next: IncomingCall[]): void {
  calls = next
  emit()
}

/** Remove uma chamada da fila local (a UI ja resolveu o que fazer com ela). */
export function dismissIncoming(id: string): void {
  const next = calls.filter((call) => call.id !== id)
  if (next.length === calls.length) return
  setCalls(next)
}

function push(call: IncomingCall): void {
  if (calls.some((existing) => existing.id === call.id)) return
  setCalls([...calls, call])
}

/* --------------------------------------------------------------- stream -- */

let source: EventSource | null = null

/**
 * Liga (uma vez) o fluxo do bridge. O EventSource ja reconecta sozinho quando
 * a conexao cai; no `hello` da reconexao o servidor reenvia a fila inteira,
 * entao a tela volta ao estado certo mesmo depois de uma queda de rede.
 */
function ensureStream(): void {
  if (source || typeof EventSource === 'undefined') return

  // EventSource nao aceita cabecalho: o segredo vai na query (o bridge aceita
  // os dois jeitos). E o mesmo segredo que o app ja carrega.
  const url = `${BRIDGE_URL}/api/incoming/stream?token=${encodeURIComponent(SHARED_SECRET)}`
  // O EventSource nao aceita `credentials`: o equivalente dele e o
  // `withCredentials` do init, que manda o cookie do Access na conexao SSE.
  const es = new EventSource(url, { withCredentials: true })
  source = es

  es.addEventListener('hello', (event) => {
    const data = JSON.parse((event as MessageEvent).data) as { pending: IncomingCall[] }
    // A fila do servidor e a verdade: adota ela inteira.
    setCalls(data.pending ?? [])
  })

  es.addEventListener('ring', (event) => {
    push(JSON.parse((event as MessageEvent).data) as IncomingCall)
  })

  es.addEventListener('resolved', (event) => {
    const data = JSON.parse((event as MessageEvent).data) as { id: string }
    // Resolvida em outra aba, por voz, ou por tempo no servidor: some daqui.
    dismissIncoming(data.id)
  })

  es.onerror = () => {
    // Nao fechamos: o proprio EventSource tenta de novo sozinho.
    console.warn('[calling] fluxo de chamadas caiu; tentando reconectar…')
  }
}

/** Assina a fila de chamadas recebidas. */
export function subscribeIncomingCalls(listener: Listener): () => void {
  listeners.add(listener)
  listener(calls)
  ensureStream()
  return () => {
    listeners.delete(listener)
  }
}

/* --------------------------------------------------------------- acoes --- */

/**
 * Manda a decisao para o bridge, que solta o `/api/ring` que o agente deixou
 * pendurado. 404 aqui e normal: quer dizer que o toque ja tinha sido resolvido
 * (timeout do servidor, outra aba) — nao e erro para mostrar na tela.
 */
function resolveOnBridge(call: IncomingCall, action: 'approve' | 'decline' | 'answer' | 'timeout') {
  void fetch(`${BRIDGE_URL}/api/incoming/${encodeURIComponent(call.id)}/${action}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${SHARED_SECRET}` },
    keepalive: true,
    // Cookie do Cloudflare Access junto, como nas demais chamadas ao bridge.
    credentials: 'include',
  }).catch((err: Error) => {
    console.warn(`[calling] nao consegui avisar o bridge (${action}):`, err.message)
  })
}

/** O Luiz aprovou o item sem abrir voz nenhuma. */
export function approveIncoming(call: IncomingCall): void {
  resolveOnBridge(call, 'approve')
}

/** Ele vai atender por voz: o agente ja pode parar de esperar. */
export function answerIncoming(call: IncomingCall): void {
  resolveOnBridge(call, 'answer')
}

/**
 * Recusa. No dedo vira `declined`; por tempo esgotado vira `no_answer` — o
 * agente que ligou e quem decide o que fazer com isso (inclusive avisar no
 * Telegram, que e trabalho dele, nao do Calling).
 */
export function declineIncoming(call: IncomingCall, cause: DeclineCause): void {
  resolveOnBridge(call, cause === 'timeout' ? 'timeout' : 'decline')
}

/**
 * STUB — comando de voz "manda no Telegram" no meio da ligacao.
 *
 * Isso vai chegar como tool call da Gemini para o bridge, nao por clique; a
 * funcao existe so para o dia em que a UI precisar disparar o mesmo caminho.
 * TODO(bridge): rota de envio no canal de texto.
 */
export function sendToTelegram(agentSlug: string, text: string): void {
  console.warn('[calling] sendToTelegram ainda nao tem bridge.', { agentSlug, text })
}
