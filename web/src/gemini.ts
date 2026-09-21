import { GoogleGenAI, type LiveServerMessage, type Session } from '@google/genai'
import { createGeminiLiveAdapter, type GeminiLiveOrbAdapter } from 'orb-ui/adapters'
import { createLiveToken, askAgent } from './bridge'

export interface CallHooks {
  /** Texto que o agente respondeu (mostrado na tela enquanto e falado). */
  onAgentReply?: (text: string) => void
  /** Estamos esperando o agente pensar. */
  onWaitingChange?: (waiting: boolean) => void
  onError?: (message: string) => void
}

/**
 * Monta o adapter da Gemini Live para uma ligacao.
 *
 * O desenho todo esta aqui: a Gemini cuida do audio (microfone, transcricao,
 * deteccao de turno e fala) e o orb-ui cuida do audio no browser. Quando a
 * Gemini chama a tool `ask_agent`, nos interceptamos, perguntamos ao agente
 * DE VERDADE pelo bridge, e devolvemos a resposta para ela falar.
 */
export function createCallAdapter(
  agentSlug: string,
  callId: string,
  hooks: CallHooks = {},
): GeminiLiveOrbAdapter {
  // A sessao so existe depois do connect resolver, mas onmessage pode disparar
  // antes de atribuirmos a variavel — por isso guardamos numa ref.
  let sessionRef: Session | null = null

  return createGeminiLiveAdapter({
    // O orb-ui ja faz deteccao de turno no cliente (e o bridge desliga a
    // automatica do lado do servidor).
    activityDetection: 'client',

    connect: async (callbacks) => {
      const token = await createLiveToken(agentSlug)

      const ai = new GoogleGenAI({ apiKey: token.value })

      const handleToolCall = async (message: LiveServerMessage) => {
        const calls = message.toolCall?.functionCalls ?? []
        if (calls.length === 0) return

        hooks.onWaitingChange?.(true)

        const functionResponses = await Promise.all(
          calls.map(async (call) => {
            if (call.name !== 'ask_agent') {
              return {
                id: call.id,
                name: call.name,
                response: { error: `Tool desconhecida: ${call.name}` },
              }
            }

            const args = (call.args ?? {}) as { agent?: string; message?: string }
            try {
              const reply = await askAgent({
                // Ignoramos o agent sugerido pelo modelo: a ligacao ja sabe com
                // quem esta falando. Assim o modelo nao consegue trocar de agente.
                agent: agentSlug,
                message: String(args.message ?? ''),
                callId,
              })
              hooks.onAgentReply?.(reply)
              return { id: call.id, name: call.name, response: { output: reply } }
            } catch (err) {
              const text = err instanceof Error ? err.message : 'Falha no bridge.'
              hooks.onError?.(text)
              return { id: call.id, name: call.name, response: { error: text } }
            }
          }),
        )

        hooks.onWaitingChange?.(false)
        sessionRef?.sendToolResponse({ functionResponses })
      }

      const session = await ai.live.connect({
        model: token.model,
        config: token.config,
        callbacks: {
          ...callbacks,
          onmessage: (message: LiveServerMessage) => {
            // Interceptamos a tool call; todo o resto (audio, turnos) segue
            // direto para o orb-ui, que toca o som e anima o orb.
            if (message.toolCall?.functionCalls?.length) {
              void handleToolCall(message)
            }
            callbacks.onmessage(message)
          },
          onerror: (event) => {
            hooks.onError?.('A conexao de voz caiu.')
            callbacks.onerror?.(event)
          },
        },
      })

      sessionRef = session
      return session
    },
  })
}
