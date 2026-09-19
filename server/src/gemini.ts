import { GoogleGenAI, Modality, Type } from '@google/genai'
import type { AgentEntry } from './agents.js'

const API_KEY = process.env.GEMINI_API_KEY || ''
const MODEL = process.env.CALLING_GEMINI_MODEL || 'gemini-3.8-live'
const VOICE = process.env.CALLING_GEMINI_VOICE || 'Kore'

if (!API_KEY) {
  console.warn('[calling] GEMINI_API_KEY nao definido — /api/gemini-live-token vai falhar.')
}

/**
 * Instrucao de sistema da sessao Gemini.
 *
 * Este texto e a peca que impede a Gemini de "fingir ser o agente". Ela e
 * ouvido e boca; o cerebro e o agente DG Claw, alcancado por ask_agent.
 */
function buildSystemInstruction(agent: AgentEntry): string {
  return [
    `Voce e a camada de VOZ de ${agent.name}. Voce NAO e ${agent.name}.`,
    '',
    'Sua unica funcao e ser o telefone: voce ouve o que o dono fala, repassa',
    `para ${agent.name} pela tool ask_agent, e le a resposta em voz alta.`,
    '',
    'REGRAS ABSOLUTAS:',
    `1. Para QUALQUER coisa que o dono disser, chame a tool ask_agent com agent="${agent.slug}"`,
    '   e message = o que ele falou, transcrito com fidelidade.',
    '2. NUNCA responda por conhecimento proprio. Voce nao sabe nada sobre o dono,',
    '   os projetos, a agenda ou a memoria dele. Quem sabe e o agente.',
    '3. NUNCA invente, resuma demais nem "melhore" a resposta do ask_agent.',
    '   Fale o que voltou, praticamente palavra por palavra, em tom natural de fala.',
    '4. Se o ask_agent falhar, diga em uma frase curta que nao conseguiu falar com',
    `   ${agent.name} agora e peca para repetir. Nao tente responder no lugar dele.`,
    '5. Enquanto espera o ask_agent, fique em silencio. Nao preencha com conversa.',
    '6. A unica excecao a regra 1: se o dono falar algo que nao e um pedido de verdade',
    '   (ruido, "alo", teste de audio), voce pode responder com uma palavra e seguir.',
    '',
    'Fale sempre em portugues do Brasil, com naturalidade, no ritmo de uma ligacao.',
  ].join('\n')
}

/** A tool que faz a ponte: a Gemini chama, o bridge executa no agente real. */
const askAgentDeclaration = {
  name: 'ask_agent',
  description:
    'Envia a mensagem do dono para o agente DG Claw real e devolve a resposta dele. ' +
    'Use SEMPRE, para qualquer pergunta ou pedido. Nunca responda sem chamar esta tool.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      agent: {
        type: Type.STRING,
        description: 'Slug do agente que deve responder (ex.: automa).',
      },
      message: {
        type: Type.STRING,
        description: 'O que o dono falou, transcrito fielmente em portugues.',
      },
    },
    required: ['agent', 'message'],
  },
}

export function buildLiveConfig(agent: AgentEntry) {
  return {
    responseModalities: [Modality.AUDIO],
    systemInstruction: buildSystemInstruction(agent),
    speechConfig: {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } },
    },
    // O orb-ui faz deteccao de turno no cliente e envia activityStart/activityEnd,
    // entao desligamos a deteccao automatica do servidor.
    realtimeInputConfig: {
      automaticActivityDetection: { disabled: true },
    },
    tools: [{ functionDeclarations: [askAgentDeclaration] }],
  }
}

export interface LiveTokenPayload {
  value: string
  model: string
  config: ReturnType<typeof buildLiveConfig>
}

/**
 * Emite um token efemero para o browser. A GEMINI_API_KEY nunca sai daqui.
 */
export async function createLiveToken(agent: AgentEntry): Promise<LiveTokenPayload> {
  if (!API_KEY) {
    throw Object.assign(new Error('GEMINI_API_KEY nao configurada no bridge.'), {
      status: 503,
    })
  }

  const ai = new GoogleGenAI({ apiKey: API_KEY })
  const config = buildLiveConfig(agent)
  const now = Date.now()

  const token = await ai.authTokens.create({
    config: {
      uses: 1,
      // Janela curta: a ligacao precisa comecar logo e dura no maximo isso.
      expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
      newSessionExpireTime: new Date(now + 2 * 60 * 1000).toISOString(),
      // Trava modelo e config: um token vazado nao vira chave livre.
      liveConnectConstraints: { model: MODEL, config },
      lockAdditionalFields: [],
    },
  })

  if (!token.name) {
    throw Object.assign(new Error('Nao consegui emitir o token da Gemini Live.'), {
      status: 502,
    })
  }

  return { value: token.name, model: MODEL, config }
}
