import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import cors from 'cors'
import { publicAgentList, findAgent } from './agents.js'
import { logEvent, logDestination } from './logger.js'
import { buildAllowlist } from './origins.js'
import {
  agentsAbleToRing,
  bearerOf,
  isSharedSecret,
  requireAgentToken,
  requireSecret,
} from './auth.js'
import { askAgent, endCall } from './claude.js'
import { createLiveToken } from './gemini.js'
import {
  attachStream,
  finish,
  listPending,
  ring,
  RING_TIMEOUT_MS,
  streamCount,
  type RingOutcome,
} from './ring.js'

const PORT = Number(process.env.PORT || 8787)

// O bridge so deve ser alcancado por localhost (tunel SSH ou proxy reverso na
// mesma maquina). Sem host explicito, o Node escutaria em todas as interfaces.
const HOST = process.env.CALLING_BIND_HOST || '127.0.0.1'

const allowlist = buildAllowlist(process.env.CALLING_ALLOWED_ORIGINS)

const app = express()

/**
 * Uma linha por request que termina. Sem corpo, sem cabecalho, sem query
 * (o SSE leva o segredo em `?token=`, entao usamos `req.path`, nunca a URL
 * inteira). So o esqueleto: o que foi pedido, o que voltou, quanto demorou.
 *
 * Vai so para o arquivo, nao para o journal: e volume demais para o olho.
 */
app.use((req: Request, res: Response, next: NextFunction) => {
  const startedAt = process.hrtime.bigint()

  res.on('finish', () => {
    logEvent('info', 'http_request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      origin: req.headers.origin ?? null,
      durationMs: Number((process.hrtime.bigint() - startedAt) / 1000n) / 1000,
    })
  })

  next()
})

/**
 * A porta de origem, com a recusa DITA EM VOZ ALTA.
 *
 * Antes isto vivia dentro do callback do `cors`, que so enxerga a origem e so
 * sabia lancar um Error generico: o journal recebia uma pilha de stack sem a
 * informacao que interessava — QUAL origem, em QUAL rota. Uma ligacao morreu
 * exatamente assim e nao deu para saber por que. Agora a recusa vira um evento
 * `cors_rejected` com origem, metodo e caminho, e o cliente recebe um 403 com
 * texto, em vez de um 500 com pilha.
 */
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin

  // Sem Origin = chamada nao-browser (curl, Electron em file://). Liberado:
  // quem protege de verdade e o segredo compartilhado.
  if (!origin || allowlist.isAllowed(origin)) return next()

  logEvent(
    'warn',
    'cors_rejected',
    {
      origin,
      method: req.method,
      path: req.path,
      preflight: req.method === 'OPTIONS',
      requestedMethod: req.headers['access-control-request-method'] ?? null,
      allowedOrigins: allowlist.effective,
    },
    `origem recusada: ${origin} em ${req.method} ${req.path}`,
  )

  res.status(403).json({ error: 'Origem nao permitida.' })
})

app.use(
  cors({
    origin(origin, callback) {
      // O gate acima ja barrou quem nao presta; aqui so se escolhe o cabecalho.
      callback(null, !origin || allowlist.isAllowed(origin))
    },
    // O browser so entrega a resposta ao JS se ela vier com este cabecalho —
    // e o fetch do front manda `credentials: 'include'` para o cookie do
    // Cloudflare Access (CF_Authorization) acompanhar cada chamada.
    credentials: true,
  }),
)
app.use(express.json({ limit: '128kb' }))

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/agents', requireSecret, (_req, res) => {
  res.json({ agents: publicAgentList() })
})

/** Token efemero da Gemini Live, ja com a config da sessao daquele agente. */
app.post('/api/gemini-live-token', requireSecret, async (req, res) => {
  const slug = String(req.body?.agent || '')
  const agent = findAgent(slug)
  if (!agent) {
    logEvent(
      'warn',
      'live_token_unknown_agent',
      { agent: slug, origin: req.headers.origin ?? null },
      `token pedido para agente desconhecido: "${slug}"`,
    )
    res.status(400).json({ error: 'Agente desconhecido.' })
    return
  }

  try {
    const token = await createLiveToken(agent)
    // O valor do token NAO entra no log: e credencial, ainda que efemera.
    logEvent(
      'info',
      'live_token_issued',
      { agent: agent.slug, model: token.model },
      `token efemero emitido para ${agent.slug} (${token.model})`,
    )
    res.json(token)
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500
    logEvent(
      'error',
      'live_token_failed',
      { agent: agent.slug, status, error: (err as Error).message },
      `falha ao emitir token: ${(err as Error).message}`,
    )
    res.status(status).json({ error: 'Nao consegui iniciar a ligacao.' })
  }
})

/**
 * Implementacao da tool ask_agent.
 * Nao logamos a pergunta nem a resposta — e conversa do dono.
 */
app.post('/api/ask', requireSecret, async (req, res) => {
  const { agent, message, callId } = req.body ?? {}

  if (typeof agent !== 'string' || typeof message !== 'string' || typeof callId !== 'string') {
    res.status(400).json({ error: 'Parametros invalidos.' })
    return
  }

  try {
    const result = await askAgent({ agentSlug: agent, message, callId })
    // Nem a pergunta nem a resposta entram no log — so que houve e quanto levou.
    logEvent(
      'info',
      'ask_answered',
      { agent, callId, durationMs: result.durationMs },
      `${agent} respondeu em ${result.durationMs}ms`,
    )
    res.json({ reply: result.reply })
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500
    logEvent(
      'error',
      'ask_failed',
      { agent, callId, status, error: (err as Error).message },
      `ask_agent falhou: ${(err as Error).message}`,
    )
    res.status(status).json({ error: (err as Error).message })
  }
})

app.post('/api/end-call', requireSecret, (req, res) => {
  const callId = String(req.body?.callId || '')
  if (callId) endCall(callId)
  res.json({ ok: true })
})

/* ====================================================================== */
/*  CHAMADAS RECEBIDAS — um agente liga para o dono                       */
/* ====================================================================== */

/**
 * O agente TOCA o Calling e fica na linha.
 *
 * Autenticado pela credencial propria do agente (nao pelo segredo do app): o
 * bridge descobre QUEM esta ligando pelo token, nao por um nome declarado.
 *
 * A resposta so sai quando o dono decide (ou o tempo estoura) — quem chama so
 * precisa de um `await`, sem polling.
 */
app.post('/api/ring', requireAgentToken, async (req, res) => {
  const agent = req.ringAgent!
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : ''

  if (!reason) {
    res.status(400).json({ error: 'Informe "reason": uma linha dizendo por que voce ligou.' })
    return
  }
  if (reason.length > 500) {
    res.status(400).json({ error: 'O motivo precisa caber num cartao: no maximo 500 caracteres.' })
    return
  }

  const handle = ring({ agentSlug: agent.slug, agentName: agent.name, reason })
  // Nao logamos o motivo: e recado do agente para o dono.
  logEvent(
    'info',
    'ring_created',
    { agent: agent.slug, callId: handle.call.id, listeners: streamCount() },
    `toque de ${agent.slug} (${handle.call.id}) — ${streamCount()} tela(s) ouvindo`,
  )

  // O agente desistiu antes da decisao: tira o cartao da tela.
  // (Tem de ser `res`: desde o Node 16 o `close` do `req` dispara assim que o
  // corpo termina de ser lido, o que aconteceria na hora e mataria o toque.)
  res.on('close', () => handle.abandon())

  const resolution = await handle.outcome
  logEvent(
    'info',
    'ring_resolved',
    {
      agent: agent.slug,
      callId: handle.call.id,
      outcome: resolution.outcome,
      resolvedAt: resolution.resolvedAt,
    },
    `toque ${handle.call.id}: ${resolution.outcome}`,
  )

  if (res.writableEnded || res.destroyed) return
  res.json({
    callId: handle.call.id,
    outcome: resolution.outcome,
    resolvedAt: resolution.resolvedAt,
  })
})

/**
 * Fluxo de chamadas recebidas para o browser (SSE).
 *
 * `EventSource` nao deixa mandar cabecalho, entao aceitamos tambem `?token=`
 * com o MESMO segredo compartilhado das outras rotas do app. O bridge so
 * escuta em 127.0.0.1 e nao loga URL; quem chega de fora passa antes pelo
 * Cloudflare Access.
 */
app.get('/api/incoming/stream', (req, res) => {
  const token = bearerOf(req) || String(req.query.token || '')
  if (!isSharedSecret(token)) {
    logEvent('warn', 'sse_unauthorized', { origin: req.headers.origin ?? null })
    res.status(401).json({ error: 'Nao autorizado.' })
    return
  }
  attachStream(res)
  logEvent('info', 'sse_attached', {
    origin: req.headers.origin ?? null,
    listeners: streamCount(),
  })
})

/** Fallback sem stream (e util para depurar): a fila neste instante. */
app.get('/api/incoming', requireSecret, (_req, res) => {
  res.json({ calls: listPending(), timeoutMs: RING_TIMEOUT_MS })
})

/**
 * O dedo do Luiz chegando de volta. Uma rota so, com o desfecho no corpo:
 *   approve  -> resolvido na hora, sem voz
 *   decline  -> recusado no dedo
 *   answer   -> ele vai atender por voz
 *   timeout  -> o relogio da UI estourou (vale como ninguem atendeu)
 *
 * Idempotente de proposito: clique e timeout podem se cruzar, e duas abas
 * podem clicar. O primeiro desfecho vale e os outros recebem o mesmo de volta.
 */
const ACTIONS: Record<string, RingOutcome> = {
  approve: 'approved',
  decline: 'declined',
  answer: 'answered',
  timeout: 'no_answer',
}

app.post('/api/incoming/:id/:action', requireSecret, (req, res) => {
  const outcome = ACTIONS[String(req.params.action)]
  if (!outcome) {
    res.status(400).json({ error: 'Acao desconhecida.' })
    return
  }

  const resolution = finish(String(req.params.id), outcome)
  if (!resolution) {
    logEvent('warn', 'incoming_action_stale', {
      callId: String(req.params.id),
      action: String(req.params.action),
    })
    res.status(404).json({ error: 'Essa chamada nao existe mais.' })
    return
  }

  logEvent('info', 'incoming_action', {
    callId: String(req.params.id),
    action: String(req.params.action),
    outcome: resolution.outcome,
    // `applied: false` = o desfecho ja estava decidido e este clique so ecoou.
    applied: resolution.applied,
  })

  res.json({ ok: true, outcome: resolution.outcome, applied: resolution.applied })
})

/**
 * Ultima rede. Erro que escapou de uma rota vira UMA linha no log com o
 * caminho e o tipo — nao uma pilha solta no journal sem contexto.
 */
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logEvent(
    'error',
    'unhandled_error',
    { method: req.method, path: req.path, error: err.message, type: err.name },
    `erro nao tratado em ${req.method} ${req.path}: ${err.message}`,
  )
  if (res.headersSent) return
  res.status(500).json({ error: 'Erro interno.' })
})

app.listen(PORT, HOST, () => {
  const ringers = agentsAbleToRing()

  logEvent(
    'info',
    'bridge_started',
    {
      host: HOST,
      port: PORT,
      agents: publicAgentList().map((a) => a.slug),
      ringers,
      ringTimeoutMs: RING_TIMEOUT_MS,
      allowedOrigins: allowlist.effective,
      configuredOrigins: allowlist.configured,
      logFile: logDestination,
    },
    `bridge ouvindo em http://${HOST}:${PORT}`,
  )

  console.log(`[calling] agentes: ${publicAgentList().map((a) => a.slug).join(', ')}`)
  console.log(
    ringers.length > 0
      ? `[calling] podem tocar (credencial propria): ${ringers.join(', ')}`
      : '[calling] nenhum agente com credencial de toque — /api/ring desativado.',
  )
  console.log(`[calling] toque expira em ${RING_TIMEOUT_MS}ms`)
  console.log(`[calling] origens liberadas: ${allowlist.effective.join(', ')}`)
  console.log(`[calling] log em ${logDestination} (NDJSON, 5 arquivos x 5MB)`)
})
