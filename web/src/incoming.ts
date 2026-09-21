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

import { bridgeUrl, sharedSecret } from './config'

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

/** Quem quer saber que a identidade de um agente mudou. */
const agentsListeners = new Set<() => void>()

/**
 * Um recado que o AGENTE empurrou, sem ninguem ter perguntado nada.
 *
 * Vem de `POST /api/agents/:slug/notify` no bridge, pelo mesmo fluxo SSE das
 * chamadas. E o contrario do resto do app: aqui quem fala primeiro e ele.
 */
export interface AgentMessage {
  /** Slug do agente que mandou. */
  agent: string
  /** O texto, como ele escreveu. A UI trata como opaco. */
  text: string
  /** Quando o bridge empurrou (ms). */
  at: number
}

type AgentMessageListener = (message: AgentMessage) => void

const agentMessageListeners = new Set<AgentMessageListener>()

/** Assina os recados empurrados pelos agentes. Devolve o "parar de ouvir". */
export function subscribeAgentMessages(listener: AgentMessageListener): () => void {
  agentMessageListeners.add(listener)
  return () => {
    agentMessageListeners.delete(listener)
  }
}

/**
 * Avisa quando a cara de algum agente muda — do painel daqui ou do agente na
 * VPS. Devolve a funcao de parar de ouvir.
 */
export function subscribeAgentsChanged(listener: () => void): () => void {
  agentsListeners.add(listener)
  return () => {
    agentsListeners.delete(listener)
  }
}

/**
 * Liga (uma vez) o fluxo do bridge. O EventSource ja reconecta sozinho quando
 * a conexao cai; no `hello` da reconexao o servidor reenvia a fila inteira,
 * entao a tela volta ao estado certo mesmo depois de uma queda de rede.
 */
function ensureStream(): void {
  if (typeof EventSource === 'undefined') return
  // Um EventSource CLOSED nao tenta mais nada — e e exatamente nisso que ele
  // termina quando o Access vence: o bridge responde com um redirecionamento
  // para a tela de login, que chega como HTML e derruba o fluxo de vez. Tratar
  // como "nao existe" e o que faz a fila voltar depois de um novo login.
  if (source && source.readyState !== EventSource.CLOSED) return

  // EventSource nao aceita cabecalho: o segredo vai na query (o bridge aceita
  // os dois jeitos). E o mesmo segredo que o app ja carrega.
  const url = `${bridgeUrl()}/api/incoming/stream?token=${encodeURIComponent(sharedSecret())}`
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

  /* A identidade de algum agente mudou na VPS — ou porque o dono salvou pelo
     painel, ou porque o PROPRIO agente reescreveu o arquivo dele. Vem pelo
     mesmo fluxo das chamadas: um cano so. */
  es.addEventListener('agents', () => {
    agentsListeners.forEach((listener) => listener())
  })

  /* O agente falou primeiro. Mesmo cano, tipo de evento novo — como o
     `agents`. Nada aqui bloqueia a tela: e um recado que aparece e sai. */
  es.addEventListener('agent_message', (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data) as AgentMessage
      if (!data?.text) return
      agentMessageListeners.forEach((listener) => listener(data))
    } catch {
      // Evento malformado nao derruba o fluxo das chamadas.
    }
  })

  es.addEventListener('resolved', (event) => {
    const data = JSON.parse((event as MessageEvent).data) as { id: string }
    // Resolvida em outra aba, por voz, ou por tempo no servidor: some daqui.
    dismissIncoming(data.id)
  })

  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) {
      // Desistiu de vez (tipico de sessao do Access vencida). Solta a
      // referencia para nao segurar um fluxo morto e nao ficar batendo no
      // endpoint de login do Cloudflare enquanto o Luiz digita o codigo.
      if (source === es) source = null
      console.warn('[calling] fluxo de chamadas encerrado; reconecte para voltar.')
      return
    }
    // Queda comum: o proprio EventSource tenta de novo sozinho.
    console.warn('[calling] fluxo de chamadas caiu; tentando reconectar…')
  }
}

/**
 * Derruba o fluxo para ele nascer de novo com a configuracao nova.
 *
 * Existe por causa da tela de conexao do app de desktop: se o endereco do
 * bridge ou a chave mudarem com o app aberto, o EventSource antigo ainda
 * estaria pendurado no endereco velho. O proximo `subscribeIncomingCalls`
 * reabre com o endereco certo.
 */
export function resetIncomingStream(): void {
  source?.close()
  source = null
  setCalls([])
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
function resolveOnBridge(
  call: IncomingCall,
  action: 'approve' | 'decline' | 'answer' | 'timeout',
  reply?: string,
) {
  /* SEM RECADO, NADA MUDA.
     Sem texto a requisicao sai exatamente como sempre saiu: sem corpo e sem
     `content-type`. O campo novo so aparece quando o Luiz escreveu algo. */
  const text = reply?.trim()
  void fetch(`${bridgeUrl()}/api/incoming/${encodeURIComponent(call.id)}/${action}`, {
    method: 'POST',
    headers: text
      ? { authorization: `Bearer ${sharedSecret()}`, 'content-type': 'application/json' }
      : { authorization: `Bearer ${sharedSecret()}` },
    body: text ? JSON.stringify({ reply: text }) : undefined,
    keepalive: true,
    // Cookie do Cloudflare Access junto, como nas demais chamadas ao bridge.
    credentials: 'include',
  }).catch((err: Error) => {
    console.warn(`[calling] nao consegui avisar o bridge (${action}):`, err.message)
  })
}

/**
 * O Luiz aprovou o item sem abrir voz nenhuma.
 *
 * `reply` e o recado escrito que ele mandou junto, quando mandou: o bridge
 * devolve esse texto ao agente no JSON do `/api/ring` que ficou pendurado.
 */
export function approveIncoming(call: IncomingCall, reply?: string): void {
  resolveOnBridge(call, 'approve', reply)
}

/** Ele vai atender por voz: o agente ja pode parar de esperar. */
export function answerIncoming(call: IncomingCall): void {
  resolveOnBridge(call, 'answer')
}

/**
 * Recusa. No dedo vira `declined`; por tempo esgotado vira `no_answer` — o
 * agente que ligou e quem decide o que fazer com isso (inclusive avisar no
 * Telegram, que e trabalho dele, nao do Calling).
 *
 * `reply` so faz sentido na recusa no dedo: no tempo esgotado nao ha ninguem
 * escrevendo, e o bridge ignora o campo nesse caminho de qualquer jeito.
 */
export function declineIncoming(call: IncomingCall, cause: DeclineCause, reply?: string): void {
  resolveOnBridge(call, cause === 'timeout' ? 'timeout' : 'decline', reply)
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
