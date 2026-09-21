import { timingSafeEqual } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { loadAgents, ringTokenEnvName, type AgentEntry } from './agents.js'

const SECRET = process.env.CALLING_SHARED_SECRET || ''

if (!SECRET) {
  console.warn(
    '[calling] CALLING_SHARED_SECRET nao definido — o bridge vai recusar todas as chamadas.',
  )
}

export function bearerOf(req: Request): string {
  const header = req.get('authorization') || ''
  return header.startsWith('Bearer ') ? header.slice(7) : ''
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * Autenticacao deliberadamente simples: um segredo compartilhado.
 * Isto e uma ferramenta pessoal (Luiz e Matheus), nao um produto multiusuario.
 */
export function requireSecret(req: Request, res: Response, next: NextFunction) {
  if (!SECRET) {
    res.status(503).json({ error: 'Bridge sem segredo configurado.' })
    return
  }

  const token = bearerOf(req)

  if (!token || !safeEqual(token, SECRET)) {
    res.status(401).json({ error: 'Nao autorizado.' })
    return
  }

  next()
}

/** O segredo do app (browser <-> bridge) confere? Usado fora de middleware. */
export function isSharedSecret(token: string): boolean {
  return Boolean(SECRET) && Boolean(token) && safeEqual(token, SECRET)
}

/* ------------------------------------------- credencial POR AGENTE (ring) -- */

/**
 * Cada agente que pode TOCAR o Calling tem um segredo so dele, vindo do
 * ambiente (`CALLING_RING_TOKEN_<SLUG>`, carregado pelo EnvironmentFile do
 * systemd — nunca do agents.json, que e publico no GitHub).
 *
 * A identidade sai do SEGREDO, nunca de um nome que a chamada afirme ter: o
 * bridge descobre quem esta ligando procurando de qual agente e o token
 * apresentado. Nao ha como um agente se passar por outro sem ter a chave dele.
 */
interface RingCredential {
  agent: AgentEntry
  token: string
}

let credentialsCache: RingCredential[] | null = null

function ringCredentials(): RingCredential[] {
  if (credentialsCache) return credentialsCache
  const creds: RingCredential[] = []
  for (const agent of loadAgents()) {
    const token = process.env[ringTokenEnvName(agent.slug)] || ''
    // Token curto demais e erro de configuracao, nao credencial.
    if (token.length >= 32) creds.push({ agent, token })
  }
  credentialsCache = creds
  return creds
}

/** So os slugs — para o log de boot dizer quem pode tocar, sem vazar segredo. */
export function agentsAbleToRing(): string[] {
  return ringCredentials().map((c) => c.agent.slug)
}

/**
 * Identifica o agente pelo token apresentado. Percorre TODAS as credenciais
 * (sem sair no primeiro acerto) para nao dar pista de tempo sobre qual bateu.
 */
export function identifyRingingAgent(token: string): AgentEntry | null {
  if (!token) return null
  let found: AgentEntry | null = null
  for (const cred of ringCredentials()) {
    if (safeEqual(token, cred.token)) found = cred.agent
  }
  return found
}

declare module 'express-serve-static-core' {
  interface Request {
    /** Preenchido por `requireAgentToken`. */
    ringAgent?: AgentEntry
  }
}

/** Porta de entrada do `/api/ring`: credencial do agente, nao a do app. */
export function requireAgentToken(req: Request, res: Response, next: NextFunction) {
  if (ringCredentials().length === 0) {
    console.warn('[calling] nenhum CALLING_RING_TOKEN_* configurado — /api/ring esta fechado.')
    res.status(503).json({ error: 'Nenhum agente habilitado a ligar.' })
    return
  }

  const agent = identifyRingingAgent(bearerOf(req))
  if (!agent) {
    res.status(401).json({ error: 'Credencial de agente invalida.' })
    return
  }

  req.ringAgent = agent
  next()
}
