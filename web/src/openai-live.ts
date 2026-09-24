import {
  createOpenAILiveAdapter,
  type OpenAILiveEvent,
  type OpenAILiveOrbAdapter,
} from 'orb-ui/adapters'
import { askAgent, createOpenAILiveSession } from './bridge'
import type { CallHooks } from './gemini'

/**
 * Adapter da GPT-Live (OpenAI) para uma ligacao — a segunda opcao de voz, par
 * do `gemini.ts`.
 *
 * O desenho e o mesmo: a Live cuida do audio e o agente DE VERDADE responde,
 * pelo MESMO `askAgent()` do bridge. O que muda e como o pedido chega ate nos.
 *
 * Na Gemini o pedido chega como tool call `ask_agent`, ja com o texto. Na
 * GPT-Live com client delegation nao existe tool: quando o modelo decide
 * delegar, ele emite `session.delegation.created` so com metadados (id e
 * `offset_ms`, a posicao na linha do tempo da sessao). O texto do pedido nos
 * montamos da transcricao do dono (`session.input_transcript.delta`, cada
 * pedaco com `start_ms`), e a resposta volta por `session.commentary.append`
 * com o `delegation_id` — que a Live entao fala.
 */

/**
 * Espera curta depois da delegacao para os ultimos pedacos da transcricao
 * chegarem — a delegacao pode sair antes do fim da transcricao do turno.
 */
const TRANSCRIPT_SETTLE_MS = 400

/**
 * `session.commentary.append` aceita ate 500 tokens. Resposta de voz do agente
 * e curta por regra (identity.ts), mas cortamos por seguranca: uma commentary
 * grande demais e recusada inteira.
 */
const MAX_COMMENTARY_CHARS = 1500

interface TranscriptPiece {
  startMs: number
  text: string
}

function clipForCommentary(text: string): string {
  if (text.length <= MAX_COMMENTARY_CHARS) return text
  const cut = text.slice(0, MAX_COMMENTARY_CHARS)
  // Corta no fim da ultima frase inteira, se houver uma razoavelmente longe.
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
  return lastStop > MAX_COMMENTARY_CHARS / 2 ? cut.slice(0, lastStop + 1) : `${cut}…`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createOpenAICallAdapter(
  agentSlug: string,
  callId: string,
  hooks: CallHooks = {},
): OpenAILiveOrbAdapter {
  // A transcricao do dono que ainda nao virou pedido.
  let pending: TranscriptPiece[] = []
  // Ate onde (na linha do tempo da sessao) a transcricao ja foi consumida.
  let consumedUntilMs = -Infinity
  // Os pedidos ao agente vao em FILA: a sessao do `claude --resume` daquela
  // ligacao nao aguenta dois turnos ao mesmo tempo. Full-duplex deixa o dono
  // corrigir no meio; a correcao entra depois do que ja estava andando.
  let queue: Promise<void> = Promise.resolve()
  let inFlight = 0
  let closed = false

  // O adapter so existe depois do `createOpenAILiveAdapter` voltar, mas o
  // `onEvent` so dispara depois do start — a ref chega a tempo.
  let adapterRef: OpenAILiveOrbAdapter | null = null

  const sendCommentary = (delegationId: string, content: string) => {
    if (closed || !adapterRef) return
    try {
      adapterRef.send({
        type: 'session.commentary.append',
        event_id: `ask_${delegationId}`.slice(0, 64),
        delegation_id: delegationId,
        content: clipForCommentary(content),
      })
    } catch {
      // Sessao ja fechando: nao ha a quem falar. Nao e erro para a tela.
    }
  }

  /** Tira da fila a transcricao que pertence a esta delegacao. */
  const takeRequestText = (offsetMs: number): string => {
    const mine = pending.filter((p) => p.startMs <= offsetMs)
    pending = pending.filter((p) => p.startMs > offsetMs)
    // Sem `offset_ms` (offset infinito) o cursor para no ultimo pedaco usado —
    // nunca no infinito, senao o resto da ligacao seria descartado.
    const reached = Number.isFinite(offsetMs)
      ? offsetMs
      : mine.reduce((max, p) => Math.max(max, p.startMs), consumedUntilMs)
    consumedUntilMs = Math.max(consumedUntilMs, reached)
    return mine
      .map((p) => p.text)
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
  }

  const handleDelegation = (delegationId: string, offsetMs: number) => {
    inFlight += 1
    hooks.onWaitingChange?.(true)

    queue = queue
      .then(async () => {
        await sleep(TRANSCRIPT_SETTLE_MS)
        if (closed) return
        const message = takeRequestText(offsetMs)

        if (!message) {
          sendCommentary(
            delegationId,
            'Falha: a transcricao do pedido nao chegou. Peca para o dono repetir.',
          )
          return
        }

        try {
          const reply = await askAgent({
            // Mesmo contrato do ask_agent da Gemini: quem responde e sempre o
            // agente desta ligacao — a Live nao escolhe com quem falar.
            agent: agentSlug,
            message,
            callId,
          })
          if (closed) return
          hooks.onAgentReply?.(reply)
          sendCommentary(delegationId, reply)
        } catch (err) {
          const text = err instanceof Error ? err.message : 'Falha no bridge.'
          hooks.onError?.(text)
          sendCommentary(delegationId, 'Falha: nao foi possivel falar com o agente agora.')
        }
      })
      .catch(() => undefined)
      .finally(() => {
        inFlight -= 1
        if (inFlight === 0) hooks.onWaitingChange?.(false)
      })
  }

  const onEvent = (event: OpenAILiveEvent) => {
    switch (event.type) {
      case 'session.input_transcript.delta': {
        const text = typeof event.delta === 'string' ? event.delta : ''
        if (!text) return
        const start = typeof event.start_ms === 'number' ? event.start_ms : consumedUntilMs + 1
        // Pedaco atrasado de um turno ja pedido: nao contamina o proximo.
        if (start <= consumedUntilMs) return
        pending.push({ startMs: start, text })
        return
      }

      case 'session.delegation.created': {
        const delegation = event.delegation as
          | { id?: unknown; target?: unknown }
          | undefined
        if (!delegation || delegation.target !== 'client' || typeof delegation.id !== 'string') {
          return
        }
        const offset = typeof event.offset_ms === 'number' ? event.offset_ms : Infinity
        handleDelegation(delegation.id, offset)
        return
      }

      case 'session.closed':
        closed = true
        return

      case 'error': {
        const error = event.error as { message?: unknown } | undefined
        hooks.onError?.(
          typeof error?.message === 'string' ? `GPT-Live: ${error.message}` : 'A conexao de voz caiu.',
        )
        return
      }
    }
  }

  const adapter = createOpenAILiveAdapter({
    createSession: (sdp, signal) => createOpenAILiveSession(agentSlug, sdp, signal),
    onEvent,
  })
  adapterRef = adapter

  return {
    ...adapter,
    // Marcamos antes de fechar para nenhuma resposta tardia tentar falar numa
    // sessao que ja esta indo embora.
    stop: () => {
      closed = true
      return adapter.stop()
    },
  }
}
