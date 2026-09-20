import { randomUUID } from 'node:crypto'
import type { Response } from 'express'

/**
 * Chamadas RECEBIDAS: um agente e que liga para o dono.
 *
 * O desenho e proposital: `POST /api/ring` SEGURA a resposta HTTP ate o dono
 * decidir (ou o tempo estourar). Assim o agente que ligou so precisa de um
 * `await` numa chamada HTTP comum para saber o que aconteceu — nao existe
 * polling, fila, nem webhook de volta. Quem avisa o browser e o SSE daqui.
 */

export type RingOutcome = 'approved' | 'declined' | 'answered' | 'no_answer'

/**
 * Quanto tempo o toque fica de pe antes de virar "ninguem atendeu".
 *
 * ATENCAO: precisa bater com INCOMING_CALL_TIMEOUT_MS em `web/src/incoming.ts`.
 * O servidor e a fonte da verdade — ele manda `expiresAt` em cada evento e a
 * UI respeita esse instante, entao mexer aqui (ou em CALLING_RING_TIMEOUT_MS,
 * que existe para os testes) nao deixa os dois lados fora de sincronia.
 */
export const RING_TIMEOUT_MS = Number(process.env.CALLING_RING_TIMEOUT_MS || 30_000)

/** O que a UI precisa saber sobre um toque. Nada de segredo mora aqui. */
export interface PendingRing {
  id: string
  agentSlug: string
  agentName: string
  /** Linha escrita pelo proprio agente dizendo por que ligou. Texto opaco. */
  reason: string
  receivedAt: number
  /** Instante em que o toque morre sozinho. A UI usa isto no relogio dela. */
  expiresAt: number
}

export interface Resolution {
  outcome: RingOutcome
  resolvedAt: number
}

interface Entry {
  call: PendingRing
  settle: (resolution: Resolution) => void
  timer: NodeJS.Timeout
}

const pending = new Map<string, Entry>()

/**
 * Lembranca curta do que ja foi resolvido: se o dedo do Luiz e o timeout
 * chegarem quase juntos (ou se duas abas clicarem), a segunda acao recebe o
 * mesmo desfecho em vez de um 404 confuso.
 */
const recent = new Map<string, Resolution>()
const RECENT_TTL_MS = 5 * 60_000

function rememberResolved(id: string, resolution: Resolution): void {
  recent.set(id, resolution)
  const cutoff = Date.now() - RECENT_TTL_MS
  for (const [key, value] of recent) {
    if (value.resolvedAt < cutoff) recent.delete(key)
  }
}

/* ------------------------------------------------------------------ SSE -- */

const streams = new Set<Response>()

function send(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

function broadcast(event: string, data: unknown): void {
  for (const res of streams) {
    try {
      send(res, event, data)
    } catch {
      // Conexao ja morreu; o handler de close limpa.
    }
  }
}

/** Fila atual, da mais antiga para a mais nova (a UI empilha nessa ordem). */
export function listPending(): PendingRing[] {
  return [...pending.values()]
    .map((entry) => entry.call)
    .sort((a, b) => a.receivedAt - b.receivedAt)
}

/**
 * Liga um browser ao fluxo de chamadas recebidas.
 *
 * Manda o estado atual de cara (`hello`): uma aba que abre no meio de um toque
 * ja nasce vendo o cartao, sem precisar esperar o proximo evento.
 */
export function attachStream(res: Response): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    // Desliga buffering de proxy (nginx e afins): SSE bufferizado nao chega.
    'x-accel-buffering': 'no',
  })
  res.flushHeaders?.()

  streams.add(res)
  send(res, 'hello', { pending: listPending(), timeoutMs: RING_TIMEOUT_MS })

  // Comentario periodico: mantem a conexao viva atraves do tunel/proxy.
  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch {
      /* idem */
    }
  }, 15_000)

  const cleanup = () => {
    clearInterval(heartbeat)
    streams.delete(res)
  }
  res.on('close', cleanup)
  res.on('error', cleanup)
}

export function streamCount(): number {
  return streams.size
}

/* ----------------------------------------------------------------- toque -- */

export interface RingInput {
  agentSlug: string
  agentName: string
  reason: string
}

export interface RingHandle {
  call: PendingRing
  /** Resolve quando o dono decidir ou o tempo acabar. */
  outcome: Promise<Resolution>
  /**
   * O agente que ligou desistiu (fechou a conexao HTTP). Tira o cartao da tela
   * — nao faz sentido o dono atender um toque que nao tem mais ninguem do
   * outro lado.
   */
  abandon: () => void
}

export function ring(input: RingInput): RingHandle {
  const receivedAt = Date.now()
  const call: PendingRing = {
    id: randomUUID(),
    agentSlug: input.agentSlug,
    agentName: input.agentName,
    reason: input.reason,
    receivedAt,
    expiresAt: receivedAt + RING_TIMEOUT_MS,
  }

  let settle!: (resolution: Resolution) => void
  const outcome = new Promise<Resolution>((resolveOutcome) => {
    settle = resolveOutcome
  })

  const timer = setTimeout(() => {
    finish(call.id, 'no_answer')
  }, RING_TIMEOUT_MS)
  // Um toque pendente nao deve segurar o processo de pe sozinho.
  timer.unref?.()

  pending.set(call.id, { call, settle, timer })
  broadcast('ring', call)

  return {
    call,
    outcome,
    abandon: () => {
      if (!pending.has(call.id)) return
      finish(call.id, 'no_answer')
    },
  }
}

/**
 * Resolve um toque. O PRIMEIRO desfecho ganha: se o timeout e o clique se
 * cruzarem, quem chegar depois recebe de volta o que ja valeu.
 */
export function finish(
  id: string,
  outcome: RingOutcome,
): (Resolution & { applied: boolean }) | null {
  const entry = pending.get(id)
  if (!entry) {
    const already = recent.get(id)
    // Chegou tarde: vale o que ja tinha valido, e dizemos que nao foi esta acao.
    return already ? { ...already, applied: false } : null
  }

  clearTimeout(entry.timer)
  pending.delete(id)

  const resolution: Resolution = { outcome, resolvedAt: Date.now() }
  rememberResolved(id, resolution)
  entry.settle(resolution)
  broadcast('resolved', { id, outcome })
  return { ...resolution, applied: true }
}

/** Ja foi resolvido antes? (para responder acao repetida sem erro) */
export function alreadyResolved(id: string): Resolution | undefined {
  return recent.get(id)
}
