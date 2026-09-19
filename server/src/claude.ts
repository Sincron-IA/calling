import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { findAgent, type AgentEntry } from './agents.js'
import { buildVoiceIdentity } from './identity.js'

const CLAUDE_BIN = process.env.CLAUDE_BIN || '/home/massari/.local/bin/claude'
const MODEL = process.env.CALLING_AGENT_MODEL || 'sonnet'
const TIMEOUT_MS = Number(process.env.CALLING_AGENT_TIMEOUT_MS || 120_000)

/**
 * Uma ligacao = uma sessao headless do Claude Code por agente.
 *
 * O primeiro turno cria a sessao com --session-id; os seguintes continuam com
 * --resume, entao o agente lembra do que foi dito ANTES na mesma ligacao.
 * Quando a ligacao termina, a entrada e descartada (a proxima ligacao comeca
 * uma sessao nova).
 */
interface CallSession {
  sessionId: string
  started: boolean
  /** Fila: impede dois --resume simultaneos na mesma sessao. */
  chain: Promise<unknown>
  lastUsed: number
}

const sessions = new Map<string, CallSession>()

function sessionKey(callId: string, agentSlug: string) {
  return `${callId}:${agentSlug}`
}

function getSession(callId: string, agentSlug: string): CallSession {
  const key = sessionKey(callId, agentSlug)
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

/** Encerra as sessoes de uma ligacao. */
export function endCall(callId: string) {
  for (const key of sessions.keys()) {
    if (key.startsWith(`${callId}:`)) sessions.delete(key)
  }
}

/** Limpeza preguicosa de ligacoes esquecidas (1h). */
function reapStaleSessions() {
  const cutoff = Date.now() - 60 * 60 * 1000
  for (const [key, session] of sessions) {
    if (session.lastUsed < cutoff) sessions.delete(key)
  }
}

export interface AskAgentInput {
  agentSlug: string
  message: string
  callId: string
}

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
  const run = session.chain.then(() => runClaude(agent, session, message))
  session.chain = run.catch(() => undefined)
  return run
}

function runClaude(
  agent: AgentEntry,
  session: CallSession,
  message: string,
): Promise<AskAgentResult> {
  const identity = buildVoiceIdentity(agent)
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
