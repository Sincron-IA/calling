import express from 'express'
import cors from 'cors'
import { publicAgentList, findAgent } from './agents.js'
import { requireSecret } from './auth.js'
import { askAgent, endCall } from './claude.js'
import { createLiveToken } from './gemini.js'

const PORT = Number(process.env.PORT || 8787)

const allowedOrigins = (
  process.env.CALLING_ALLOWED_ORIGINS || 'http://localhost:5173'
)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

const app = express()

app.use(
  cors({
    origin(origin, callback) {
      // Sem Origin = chamada nao-browser (curl, Electron em file://). Liberado:
      // quem protege de verdade e o segredo compartilhado.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
      callback(new Error('Origem nao permitida'))
    },
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
    res.status(400).json({ error: 'Agente desconhecido.' })
    return
  }

  try {
    res.json(await createLiveToken(agent))
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500
    console.error('[calling] falha ao emitir token:', (err as Error).message)
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
    console.log(`[calling] ${agent} respondeu em ${result.durationMs}ms`)
    res.json({ reply: result.reply })
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500
    console.error('[calling] ask_agent falhou:', (err as Error).message)
    res.status(status).json({ error: (err as Error).message })
  }
})

app.post('/api/end-call', requireSecret, (req, res) => {
  const callId = String(req.body?.callId || '')
  if (callId) endCall(callId)
  res.json({ ok: true })
})

app.listen(PORT, () => {
  console.log(`[calling] bridge ouvindo em http://localhost:${PORT}`)
  console.log(`[calling] agentes: ${publicAgentList().map((a) => a.slug).join(', ')}`)
})
