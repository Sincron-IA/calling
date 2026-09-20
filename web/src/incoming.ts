/**
 * Chamadas RECEBIDAS — quando um agente e que liga para o Luiz.
 *
 * ATENCAO: o bridge ainda NAO tem esse canal. Nao existe endpoint, SSE nem
 * websocket de chamada recebida em `server/` (as rotas de hoje sao
 * `/api/agents`, `/api/gemini-live-token`, `/api/ask` e `/api/end-call`).
 * Tudo aqui e a CASCA: os tipos, o contrato de assinatura e os callbacks que a
 * UI chama na hora certa. Quando o canal existir, so o miolo de
 * `subscribeIncomingCalls`, `approveIncoming` e `declineIncoming` muda — a UI
 * nao precisa saber.
 */

export interface IncomingCall {
  /** Id da chamada; vem do agente/bridge (aqui, do simulador de dev). */
  id: string
  /** Slug do agente que esta ligando. */
  agentSlug: string
  /**
   * Uma linha escrita pelo agente dizendo POR QUE ligou
   * (ex.: "Decisao pendente: adiar o compromisso das 15h?").
   *
   * A UI trata isso como texto opaco: renderiza como veio, sem interpretar.
   * Hoje e texto livre; se um dia virar rotulo de categoria, continua exibindo
   * do mesmo jeito — nao ha nada aqui que dependa do formato.
   */
  reason: string
  /** Quando a chamada chegou (ms). E daqui que sai o timeout do toque. */
  receivedAt: number
}

/** Por que a chamada foi recusada: no dedo do Luiz ou por tempo esgotado. */
export type DeclineCause = 'manual' | 'timeout'

/**
 * Quanto tempo o toque fica de pe antes de virar recusa implicita (e cair para
 * o Telegram).
 *
 * PLACEHOLDER: o Luiz ainda nao decidiu a duracao. 30s e um padrao de telefone
 * comum — trocar aqui e o suficiente, o resto da UI le esta constante.
 */
export const INCOMING_CALL_TIMEOUT_MS = 30_000

type Listener = (calls: IncomingCall[]) => void

let calls: IncomingCall[] = []
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) listener(calls)
}

/** Remove uma chamada da fila local (a UI ja resolveu o que fazer com ela). */
export function dismissIncoming(id: string): void {
  const next = calls.filter((call) => call.id !== id)
  if (next.length === calls.length) return
  calls = next
  emit()
}

/**
 * STUB — assina a fila de chamadas recebidas.
 *
 * Hoje a fila so enche pelo simulador de dev (veja abaixo). Quando o bridge
 * ganhar o canal, e aqui que entra o `EventSource('/api/incoming')` (ou
 * websocket), chamando `push`/`dismissIncoming` conforme os eventos chegam.
 */
export function subscribeIncomingCalls(listener: Listener): () => void {
  listeners.add(listener)
  listener(calls)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * STUB — o Luiz aprovou o item sem abrir voz nenhuma.
 * TODO(bridge): mandar a resolucao para o agente (`POST /api/incoming/:id/approve`).
 */
export function approveIncoming(call: IncomingCall): void {
  console.warn(
    '[calling] approveIncoming ainda nao tem bridge: o agente NAO foi avisado.',
    call,
  )
}

/**
 * STUB — recusa (no dedo ou por timeout).
 *
 * Quem recebe isso no servidor e responsavel pelo FALLBACK: mandar no Telegram
 * a mesma `reason`, no canal de sempre. O front nao manda Telegram nenhum.
 * TODO(bridge): `POST /api/incoming/:id/decline` com a causa.
 */
export function declineIncoming(call: IncomingCall, cause: DeclineCause): void {
  console.warn(
    `[calling] declineIncoming (${cause}) ainda nao tem bridge: o fallback para o Telegram NAO aconteceu.`,
    call,
  )
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

if (import.meta.env.DEV) {
  // Simulador de chamada recebida, so em dev, para dar para ver o estado na tela
  // enquanto o bridge nao existe:
  //   __calling.ring('ivo', 'Decisao pendente: adiar o compromisso das 15h?')
  //   __calling.clear()
  const debug = {
    ring(agentSlug: string, reason = 'Decisao pendente.') {
      const call: IncomingCall = {
        id: crypto.randomUUID(),
        agentSlug,
        reason,
        receivedAt: Date.now(),
      }
      calls = [...calls, call]
      emit()
      return call.id
    },
    clear() {
      calls = []
      emit()
    },
  }
  ;(window as unknown as { __calling: typeof debug }).__calling = debug
}
