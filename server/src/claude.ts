import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { findAgent, type AgentEntry } from './agents.js'
import { buildTextIdentity, buildVoiceIdentity } from './identity.js'

const CLAUDE_BIN = process.env.CLAUDE_BIN || '/home/massari/.local/bin/claude'
const MODEL = process.env.CALLING_AGENT_MODEL || 'sonnet'
const TIMEOUT_MS = Number(process.env.CALLING_AGENT_TIMEOUT_MS || 120_000)

/**
 * Uma sessao headless do Claude Code por ESCOPO e por agente.
 *
 * Sao dois escopos, e a diferenca entre eles e o tempo de vida:
 *
 *   - VOZ: o escopo e o `callId`. A sessao nasce com a ligacao e morre com ela
 *     (`endCall`), porque uma ligacao e um assunto com comeco e fim.
 *   - TEXTO: o escopo e o proprio agente. Nao ha "chamada" num recado escrito;
 *     se a sessao morresse a cada mensagem, cada frase comecaria do zero e o
 *     dono teria que recontar o contexto toda vez.
 *
 * Voz e texto do MESMO agente compartilham a sessao de texto — e por isso que
 * dá para ligar continuando um assunto escrito dez minutos antes.
 *
 * O primeiro turno cria a sessao com --session-id; os seguintes continuam com
 * --resume.
 */
interface CallSession {
  sessionId: string
  started: boolean
  /** Fila: impede dois --resume simultaneos na mesma sessao. */
  chain: Promise<unknown>
  lastUsed: number
}

const sessions = new Map<string, CallSession>()

/**
 * O escopo do recado escrito. Nao pode colidir com um `callId`, que e sempre um
 * UUID — dai o prefixo.
 */
const TEXT_SCOPE = 'thread'

/** Ligacao esquecida some em 1h. */
const CALL_TTL_MS = 60 * 60 * 1000

/**
 * A conversa escrita dura o dia: e a memoria de curto prazo do agente com o
 * dono. Passado isso, a proxima mensagem simplesmente abre uma sessao nova —
 * sem erro, so sem o contexto de ontem.
 */
const TEXT_TTL_MS = 24 * 60 * 60 * 1000

function sessionKey(scope: string, agentSlug: string) {
  return `${scope}:${agentSlug}`
}

function getSession(scope: string, agentSlug: string): CallSession {
  const key = sessionKey(scope, agentSlug)
  let session = sessions.get(key)
  if (!session) {
    session = {
      sessionId: randomUUID(),
      started: false,
      chain: Promise.resolve(),
      lastUsed: Date.now(),
    }
    sessions.set(key, session)
  }
  session.lastUsed = Date.now()
  return session
}

/**
 * Encerra as sessoes de uma ligacao.
 *
 * A sessao de TEXTO nao entra nisso de proposito: desligar o telefone nao apaga
 * a conversa escrita. Ela vive no escopo `thread:`, que nunca casa com um
 * `callId` (UUID), mas a guarda explicita fica aqui para quem vier depois nao
 * precisar deduzir isso.
 */
export function endCall(callId: string) {
  if (!callId || callId === TEXT_SCOPE) return
  for (const key of sessions.keys()) {
    if (key.startsWith(`${callId}:`)) sessions.delete(key)
  }
}

/** Limpeza preguicosa: cada escopo com o seu prazo. */
function reapStaleSessions() {
  const now = Date.now()
  for (const [key, session] of sessions) {
    const ttl = key.startsWith(`${TEXT_SCOPE}:`) ? TEXT_TTL_MS : CALL_TTL_MS
    if (session.lastUsed < now - ttl) sessions.delete(key)
  }
}

export interface AskAgentInput {
  agentSlug: string
  message: string
  callId: string
}

export interface SendTextInput {
  agentSlug: string
  text: string
}

/** Teto do recado escrito. Acima disso nao e recado, e documento. */
export const MAX_TEXT_LENGTH = 2000

export interface AskAgentResult {
  reply: string
  agent: string
  durationMs: number
}

/**
 * Chama o agente de verdade, em modo headless, dentro do workspace dele.
 *
 * Nao e a mesma sessao interativa que roda no Telegram (ver docs/AGENT-BRIDGE.md):
 * e uma sessao propria, carregada com a MESMA identidade (AGENT.md), o MESMO
 * CLAUDE.md e os MESMOS arquivos de memoria, no mesmo diretorio.
 */
export async function askAgent(input: AskAgentInput): Promise<AskAgentResult> {
  const agent = findAgent(input.agentSlug)
  if (!agent) {
    throw Object.assign(new Error(`Agente desconhecido: ${input.agentSlug}`), {
      status: 400,
    })
  }

  const message = input.message?.trim()
  if (!message) {
    throw Object.assign(new Error('Mensagem vazia'), { status: 400 })
  }

  reapStaleSessions()
  const session = getSession(input.callId, agent.slug)

  // Enfileira: um turno por vez por ligacao/agente.
  const run = session.chain.then(() => runClaude(agent, session, message, 'voice'))
  session.chain = run.catch(() => undefined)
  return run
}

/**
 * Recado escrito pela barra do Calling.
 *
 * Mesmo agente, mesmo workspace, mesma maquinaria da voz — muda o escopo da
 * sessao (o agente, nao a ligacao) e as regras do canal.
 */
export async function sendText(input: SendTextInput): Promise<AskAgentResult> {
  const agent = findAgent(input.agentSlug)
  if (!agent) {
    throw Object.assign(new Error(`Agente desconhecido: ${input.agentSlug}`), {
      status: 400,
    })
  }

  const text = input.text?.trim()
  if (!text) {
    throw Object.assign(new Error('Mensagem vazia'), { status: 400 })
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw Object.assign(
      new Error(`Mensagem longa demais (limite de ${MAX_TEXT_LENGTH} caracteres).`),
      { status: 400 },
    )
  }

  reapStaleSessions()
  const session = getSession(TEXT_SCOPE, agent.slug)

  // A mesma fila da voz: dois --resume ao mesmo tempo na mesma sessao quebram.
  const run = session.chain.then(() => runClaude(agent, session, text, 'text'))
  session.chain = run.catch(() => undefined)
  return run
}

function runClaude(
  agent: AgentEntry,
  session: CallSession,
  message: string,
  channel: 'voice' | 'text',
): Promise<AskAgentResult> {
  const identity = channel === 'voice' ? buildVoiceIdentity(agent) : buildTextIdentity(agent)
  const startedAt = Date.now()

  const args = [
    '-p',
    '--output-format',
    'json',
    '--model',
    MODEL,
    '--permission-mode',
    'bypassPermissions',
    '--append-system-prompt-file',
    identity.file,
    ...(session.started
      ? ['--resume', session.sessionId]
      : ['--session-id', session.sessionId]),
  ]

  return new Promise<AskAgentResult>((resolvePromise, reject) => {
    const child = spawn(CLAUDE_BIN, args, {
      cwd: agent.workspace,
      env: {
        ...process.env,
        // O launcher do DG Claw faz o mesmo: sem isto o claude recusa
        // bypassPermissions rodando como root.
        IS_SANDBOX: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(
        Object.assign(new Error('O agente demorou demais para responder.'), {
          status: 504,
        }),
      )
    }, TIMEOUT_MS)

    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)

      if (code !== 0) {
        // stderr pode conter caminhos internos; mantemos so no log do servidor.
        console.error(`[calling] claude saiu com codigo ${code}: ${stderr.slice(0, 500)}`)
        reject(
          Object.assign(new Error('Nao consegui falar com o agente agora.'), {
            status: 502,
          }),
        )
        return
      }

      try {
        const parsed = JSON.parse(stdout) as {
          result?: string
          is_error?: boolean
          session_id?: string
        }
        if (parsed.is_error || typeof parsed.result !== 'string') {
          reject(
            Object.assign(new Error('O agente devolveu um erro.'), { status: 502 }),
          )
          return
        }

        // A sessao existe a partir daqui: os proximos turnos usam --resume.
        session.started = true
        if (parsed.session_id) session.sessionId = parsed.session_id

        resolvePromise({
          reply: parsed.result.trim(),
          agent: agent.slug,
          durationMs: Date.now() - startedAt,
        })
      } catch {
        reject(
          Object.assign(new Error('Resposta do agente veio em formato invalido.'), {
            status: 502,
          }),
        )
      }
    })

    // O texto do usuario vai por stdin, nunca por argv: assim uma mensagem que
    // comece com "-" nunca e interpretada como flag.
    child.stdin.write(message)
    child.stdin.end()
  })
}
