/**
 * GPT-Live (OpenAI) como SEGUNDA opcao de camada de voz, lado a lado com a
 * Gemini Live (`gemini.ts`). Nada aqui muda o caminho da Gemini.
 *
 * O desenho e o mesmo: a Live e ouvido e boca, o cerebro continua sendo o
 * agente DG Claw real, alcancado pelo MESMO `/api/ask` (contrato ask_agent:
 * `agent` + `message`).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * A DIFERENCA QUE IMPORTA EM RELACAO A GEMINI (confirmada na doc oficial e nos
 * tipos do SDK `openai@7.23.0`, `resources/live/live.d.ts`):
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A sessao GPT-Live NAO aceita declaracao de tools (`MediaSessionConfig` so tem
 * model, instructions, audio, delegation, client, input, store). Com
 * `delegation: { type: 'client' }` — o modo em que a NOSSA aplicacao executa o
 * trabalho, e nao um modelo da OpenAI —, quando o modelo decide delegar ele
 * emite `session.delegation.created` com SO metadados (id + offset_ms), sem o
 * texto do pedido. O texto sai da transcricao (`session.input_transcript.delta`)
 * e a resposta volta por `session.commentary.append` com o `delegation_id`.
 * Isso e feito no browser (`web/src/openai-live.ts`), que chama o mesmo
 * `askAgent()` do caminho da Gemini.
 *
 * Por isso NAO usamos Responses delegation (`delegation.type = 'responses'`):
 * ali um modelo da OpenAI viraria o cerebro, que e exatamente o que o Calling
 * nao quer (ver DECISIONS.md, 2026-09-19).
 *
 * A OPENAI_API_KEY fica SO aqui. O browser manda o SDP offer; o bridge cria a
 * sessao e devolve so o id da sessao + SDP answer.
 */

import type { AgentEntry } from './agents.js'

const MODEL = process.env.CALLING_OPENAI_LIVE_MODEL || 'gpt-live-1'
// `marin` e o padrao da propria API; deixamos explicito para ficar previsivel.
const VOICE = process.env.CALLING_OPENAI_LIVE_VOICE || 'marin'
const API_BASE = (process.env.CALLING_OPENAI_API_BASE || 'https://api.openai.com').replace(/\/+$/, '')
const CREATE_TIMEOUT_MS = 20_000

/** Teto do SDP que aceitamos do browser. Um offer real tem poucos kB. */
export const MAX_SDP_CHARS = 64 * 1024

/** Lida a cada chamada (e nao congelada no import) para o teste poder injetar. */
function apiKey(): string {
  return process.env.OPENAI_API_KEY || ''
}

/**
 * Instrucoes da camada de voz, adaptadas de `buildSystemInstruction` da Gemini.
 *
 * Em vez de "chame a tool ask_agent", aqui o verbo e DELEGAR: e o mecanismo que
 * a GPT-Live tem para passar trabalho a aplicacao (client delegation). O
 * resultado volta como commentary, e a regra e falar o que voltou.
 */
function buildInstructions(agent: AgentEntry): string {
  return [
    `Voce e a camada de VOZ de ${agent.name}. Voce NAO e ${agent.name}.`,
    '',
    'Sua unica funcao e ser o telefone: voce ouve o que o dono fala, delega o',
    `pedido para ${agent.name} (o backend desta sessao) e fala a resposta que voltar.`,
    '',
    'O BACKEND:',
    `- ${agent.name} e o agente de verdade do dono: tem a memoria, os projetos, a agenda,`,
    '  as ferramentas e a personalidade. Tudo que depende de conhecimento ou de acao',
    '  e trabalho do backend.',
    '',
    'REGRAS ABSOLUTAS:',
    '1. Para QUALQUER pedido, pergunta ou comentario do dono, DELEGUE ao backend',
    '   assim que ele terminar de falar. Delegue antes de dar qualquer resposta.',
    '2. NUNCA responda por conhecimento proprio. Voce nao sabe nada sobre o dono,',
    '   os projetos, a agenda ou a memoria dele. Quem sabe e o agente.',
    '3. Quando a resposta do backend chegar (commentary da delegacao), fale o que',
    '   voltou praticamente palavra por palavra, em tom natural de fala. NUNCA',
    '   invente, resuma demais nem "melhore" a resposta.',
    '4. Se o backend informar falha, diga em uma frase curta que nao conseguiu falar',
    `   com ${agent.name} agora e peca para repetir. Nao responda no lugar dele.`,
    '5. Enquanto espera o backend, fique em silencio, ou diga no maximo uma palavra',
    '   curta de espera. Nunca adivinhe o resultado enquanto espera.',
    '6. A unica excecao a regra 1: se o dono falar algo que nao e um pedido de verdade',
    '   (ruido, "alo", teste de audio), voce pode responder com uma palavra e seguir.',
    '',
    'Fale sempre em portugues do Brasil, com naturalidade, no ritmo de uma ligacao.',
  ].join('\n')
}

/**
 * Config de inicio da sessao (`MediaSessionConfig`).
 *
 * `client.data_channel.allowed_client_events` restringe o que o browser (que a
 * API trata como "frontend nao confiavel") pode mandar pelo data channel: so o
 * que o nosso fluxo usa. Sem isso, qualquer um com o app aberto poderia, por
 * exemplo, acrescentar instrucoes a sessao.
 */
export function buildSessionConfig(agent: AgentEntry) {
  return {
    model: MODEL,
    instructions: buildInstructions(agent),
    audio: { output: { voice: VOICE } },
    delegation: { type: 'client' as const },
    client: {
      data_channel: {
        allowed_client_events: [
          'session.commentary.append',
          'session.thinking.append',
          'session.close',
        ],
      },
    },
  }
}

/** O formato que o `createSession` do `createOpenAILiveAdapter` (orb-ui 0.9) espera. */
export interface LiveSessionPayload {
  session: { id: string }
  transport: { type: 'webrtc'; sdp: string }
}

function fail(message: string, status: number): Error {
  return Object.assign(new Error(message), { status })
}

/**
 * Cria a sessao GPT-Live com o SDP offer do browser e devolve o SDP answer.
 *
 * `POST /v1/live/sessions` com `{ session, transport: { type: 'webrtc', sdp } }`;
 * a resposta (201) e `{ session: { id }, transport: { type: 'webrtc', sdp } }`.
 */
export async function createLiveSession(
  agent: AgentEntry,
  sdp: string,
): Promise<LiveSessionPayload & { model: string }> {
  const key = apiKey()
  if (!key) throw fail('OPENAI_API_KEY nao configurada no bridge.', 503)

  let res: Response
  try {
    res = await fetch(`${API_BASE}/v1/live/sessions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        session: buildSessionConfig(agent),
        transport: { type: 'webrtc', sdp },
      }),
      signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
    })
  } catch (err) {
    const name = (err as Error)?.name
    throw fail(
      name === 'TimeoutError'
        ? 'A OpenAI nao respondeu a tempo ao criar a sessao Live.'
        : `Nao consegui alcancar a OpenAI: ${(err as Error)?.message ?? 'erro de rede'}`,
      502,
    )
  }

  const body = (await res.json().catch(() => null)) as
    | (Partial<LiveSessionPayload> & { error?: { message?: string; code?: string } })
    | null

  if (!res.ok) {
    // So o texto de erro da API (sem corpo nosso, sem SDP, sem chave).
    const detail = body?.error?.message || body?.error?.code || 'sem detalhe'
    throw fail(`OpenAI respondeu ${res.status}: ${String(detail).slice(0, 300)}`, 502)
  }

  const id = body?.session?.id
  const answer = body?.transport?.sdp
  if (typeof id !== 'string' || !id || typeof answer !== 'string' || !answer) {
    throw fail('A OpenAI respondeu sem id de sessao ou sem SDP answer.', 502)
  }

  return { session: { id }, transport: { type: 'webrtc', sdp: answer }, model: MODEL }
}

/** Checagem minima do offer: texto, tamanho razoavel, cara de SDP. */
export function isPlausibleSdp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_SDP_CHARS &&
    value.startsWith('v=0')
  )
}
