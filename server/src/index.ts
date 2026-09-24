import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import cors from 'cors'
import { extname } from 'node:path'
import { publicAgentList, findAgent, loadAgents } from './agents.js'
import {
  AVATAR_EXTENSIONS,
  agentIdentity,
  avatarPath,
  writeIdentity,
} from './identity-file.js'
import { MAX_AVATAR_BYTES, prepareAvatar } from './avatar.js'
import { logEvent, logDestination } from './logger.js'
import { buildAllowlist } from './origins.js'
import {
  agentsAbleToRing,
  bearerOf,
  isSharedSecret,
  requireAgentToken,
  requireSecret,
} from './auth.js'
import { askAgent, drainCallTurns, endCall, sendText } from './claude.js'
import { createLiveToken } from './gemini.js'
import { createLiveSession, isPlausibleSdp } from './openai-live.js'
import { completeEcho, echoToThread } from './telegram.js'
import { backfillAvatars } from './telegram-avatar.js'
import {
  attachStream,
  finish,
  listPending,
  notifyAgentMessage,
  notifyAgentsChanged,
  ring,
  RING_TIMEOUT_MS,
  streamCount,
  type RingOutcome,
} from './ring.js'
import {
  appendContentLog,
  callPrompt,
  messagePrompt,
  wakeAgents,
  wakeLiveSession,
  wakesLiveSession,
  type CallTurn,
} from './wake.js'

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
    // O watchdog bate em /health de minuto em minuto. No nivel normal isso
    // afogaria justamente o que se quer achar depois, entao essa batida fica
    // em `debug` — a um `CALLING_LOG_LEVEL=debug` de distancia quando o que
    // estiver em duvida for o proprio watchdog.
    const level = req.path === '/health' ? 'debug' : 'info'

    logEvent(level, 'http_request', {
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
/*
 * Duas medidas de JSON, e nao uma so.
 *
 * O teto de 128 kb protege todas as rotas — nenhuma delas precisa de mais que
 * isso. A excecao e a gravacao de identidade, que leva a IMAGEM do agente no
 * mesmo corpo, de proposito: nome, cor e figura sao UMA mudanca, e mandar a
 * figura por fora abriria a porta para metade dela ficar gravada.
 *
 * Base64 engorda o binario em cerca de um terco, entao o teto aqui e o da
 * imagem (512 kb) com folga.
 */
const jsonNormal = express.json({ limit: '128kb' })
const jsonWithImage = express.json({ limit: '1mb' })

app.use((req, res, next) => {
  const parse = req.path.endsWith('/identity') ? jsonWithImage : jsonNormal
  parse(req, res, next)
})

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/agents', requireSecret, (_req, res) => {
  res.json({ agents: publicAgentList() })
})

/** Token efemero da Gemini Live, ja com a config da sessao daquele agente. */
/**
 * A imagem do agente.
 *
 * Rota propria porque o binario nao pode viajar dentro do JSON da lista. Vem
 * com `nosniff` e com um tipo da allowlist: o que volta daqui e figura, e o
 * navegador nao pode ser convencido do contrario.
 */
app.get('/api/agents/:slug/avatar', requireSecret, (req, res) => {
  const agent = findAgent(String(req.params.slug || ''))
  if (!agent) {
    res.status(400).json({ error: 'Agente desconhecido.' })
    return
  }

  const file = avatarPath(agent)
  if (!file) {
    res.status(404).json({ error: 'Esse agente nao tem imagem.' })
    return
  }

  const type = AVATAR_EXTENSIONS[extname(file).toLowerCase()]
  if (!type) {
    res.status(404).json({ error: 'Esse agente nao tem imagem.' })
    return
  }

  res.setHeader('content-type', type)
  res.setHeader('x-content-type-options', 'nosniff')
  // O mtime ja viaja como `?v=` na URL; o cache do navegador pode confiar nela.
  res.setHeader('cache-control', 'private, max-age=300')
  res.sendFile(file)
})

/**
 * Grava a identidade de um agente: nome, cor e imagem, de uma vez.
 *
 * De uma vez de proposito — os tres sao UMA mudanca. Salvar duas vezes seguidas
 * nao pode deixar o nome novo com a cor velha.
 *
 * O `slug` nao esta no corpo: ele e a chave estavel do agente e nao se muda por
 * aqui. E cada agente so alcanca o proprio arquivo, porque o caminho sai do
 * `workspace` da allowlist, nunca de algo que o cliente mandou.
 */
app.put('/api/agents/:slug/identity', requireSecret, (req, res) => {
  const slug = String(req.params.slug || '')
  const agent = findAgent(slug)
  if (!agent) {
    res.status(400).json({ error: 'Agente desconhecido.' })
    return
  }

  const { name, color, avatar } = req.body ?? {}
  if (typeof name !== 'string' || typeof color !== 'string') {
    res.status(400).json({ error: 'Parametros invalidos.' })
    return
  }

  try {
    let patch: Parameters<typeof writeIdentity>[1]['avatar']
    if (avatar === null) {
      patch = null
    } else if (typeof avatar === 'string' && avatar) {
      // Data URL ou base64 puro: o que vale sao os BYTES, nunca o rotulo que
      // veio junto (`prepareAvatar` confere a assinatura).
      const base64 = avatar.includes(',') ? avatar.slice(avatar.indexOf(',') + 1) : avatar
      const buf = Buffer.from(base64, 'base64')
      const ready = prepareAvatar(buf)
      patch = { data: ready.data, ext: ready.ext }
    }

    writeIdentity(agent, { name, color, avatar: patch })
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500
    logEvent(
      'error',
      'identity_failed',
      { agent: slug, status, error: (err as Error).message },
      `identidade de ${slug} nao foi gravada: ${(err as Error).message}`,
    )
    res.status(status).json({ error: (err as Error).message })
    return
  }

  // Sem o tamanho da imagem no log, e sem o conteudo dela em lugar nenhum.
  logEvent('info', 'identity_saved', { agent: slug }, `identidade de ${slug} gravada`)
  notifyAgentsChanged()
  res.json({ agents: publicAgentList() })
})

/** Teto de um recado empurrado pelo agente. Acima disso nao e aviso, e texto. */
const NOTIFY_MAX_LENGTH = 2000

/**
 * O AGENTE EMPURRA UM RECADO PARA DENTRO DO APP.
 *
 * Quem chama isto e a sessao VIVA do agente (a mesma do Telegram), depois de
 * ter sido acordada — ou por conta propria, quando ela tem algo a dizer e o
 * dono nao perguntou nada. E a outra metade da "segunda janela": ate aqui o
 * Calling so sabia responder.
 *
 * Nao e o `/api/ring`: aquele TOCA e fica pendurado esperando uma decisao. Este
 * so fala e vai embora — um recado na tela, sem botao e sem resposta.
 *
 * Autenticado pela MESMA credencial do toque (`CALLING_RING_TOKEN_<SLUG>`), e
 * nao pelo segredo do app. A regra antiga dizia que "quem usa esta rota ja
 * esta dentro da maquina, com o `.env` na mao" — e isso nao e verdade nesta
 * arquitetura: cada agente roda isolado no seu proprio workspace e nao enxerga
 * o `.env` privado do bridge. Exigir o segredo do app obrigaria cada agente a
 * carregar uma SEGUNDA credencial so para isto, fazendo o mesmo papel da que
 * ele ja tem para tocar.
 *
 * E pior do que a friccao: o segredo do app nao diz QUEM esta falando, entao o
 * `:slug` da URL era um nome auto-declarado — qualquer portador do segredo
 * podia empurrar um recado no nome de qualquer agente. A credencial de toque
 * prova identidade de verdade (ela sai do segredo, nunca de um nome afirmado),
 * por isso quem fala aqui e `req.ringAgent`, e o `:slug` da URL so sobrevive
 * como conferencia.
 *
 * E NUNCA acorda ninguem. Se acordasse, um recado empurrado pela sessao viva
 * voltaria para ela mesma, e o ciclo nao teria fim.
 */
app.post('/api/agents/:slug/notify', requireAgentToken, (req, res) => {
  // A identidade vem do TOKEN, nunca do caminho da URL.
  const agent = req.ringAgent!
  const slug = String(req.params.slug || '')
  if (slug !== agent.slug) {
    res.status(400).json({ error: 'O slug na URL nao bate com o agente autenticado pelo token.' })
    return
  }

  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
  if (!text) {
    res.status(400).json({ error: 'Informe "text": o recado que vai aparecer no app.' })
    return
  }
  if (text.length > NOTIFY_MAX_LENGTH) {
    res
      .status(400)
      .json({ error: `Recado longo demais (limite de ${NOTIFY_MAX_LENGTH} caracteres).` })
    return
  }

  notifyAgentMessage(agent.slug, text)

  // O TEXTO NAO ENTRA NO LOG DE OPERACAO — so o fato e quantas telas ouviram.
  // (Zero telas nao e erro: e o app fechado. O recado simplesmente nao alcanca
  // ninguem, e quem chamou precisa saber disso pela resposta, nao pelo log.)
  logEvent(
    'info',
    'agent_notified',
    { agent: agent.slug, listeners: streamCount(), chars: text.length },
    `${agent.slug} empurrou um recado para o Calling (${streamCount()} tela(s) ouvindo)`,
  )

  res.json({ ok: true, listeners: streamCount() })
})

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
 * Sessao GPT-Live (OpenAI), a segunda opcao de camada de voz.
 *
 * O browser manda o SDP offer; o bridge cria a sessao com a OPENAI_API_KEY e
 * devolve so `{ session: { id }, transport: { type, sdp } }`. Nada de SDP,
 * chave ou transcricao entra no log — so agente, modelo e duracao.
 */
app.post('/api/openai-live-session', requireSecret, async (req, res) => {
  const slug = String(req.body?.agent || '')
  const agent = findAgent(slug)
  if (!agent) {
    logEvent(
      'warn',
      'openai_live_unknown_agent',
      { agent: slug, origin: req.headers.origin ?? null },
      `sessao GPT-Live pedida para agente desconhecido: "${slug}"`,
    )
    res.status(400).json({ error: 'Agente desconhecido.' })
    return
  }

  const sdp = req.body?.sdp
  if (!isPlausibleSdp(sdp)) {
    res.status(400).json({ error: 'SDP offer ausente ou invalido.' })
    return
  }

  const startedAt = Date.now()
  try {
    const session = await createLiveSession(agent, sdp)
    // O id da sessao nao e credencial, mas tambem nao ajuda ninguem no log.
    logEvent(
      'info',
      'openai_live_session_created',
      { agent: agent.slug, model: session.model, ms: Date.now() - startedAt },
      `sessao GPT-Live criada para ${agent.slug} (${session.model})`,
    )
    res.json({ session: session.session, transport: session.transport })
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500
    logEvent(
      'error',
      'openai_live_session_failed',
      { agent: agent.slug, status, error: (err as Error).message, ms: Date.now() - startedAt },
      `falha ao criar sessao GPT-Live: ${(err as Error).message}`,
    )
    res.status(status).json({ error: 'Nao consegui iniciar a ligacao (GPT-Live).' })
  }
})

/* ====================================================================== */
/*  A SEGUNDA JANELA — o Calling entra na conversa viva do agente         */
/* ====================================================================== */

/**
 * Grava a troca no log de conteudo do agente e ACORDA a sessao viva dele.
 *
 * Duas coisas que so acontecem para quem esta em `CALLING_WAKE_AGENTS`. Para
 * todo o resto (hoje: os outros cinco agentes) esta funcao e um `return` e nada
 * muda em relacao ao que o Calling sempre fez.
 *
 * Chamada SEMPRE depois de o app ja ter a resposta na mao, e sempre sem
 * `await`: acordar a sessao viva e consequencia do recado, nao pre-requisito
 * dele. Erro aqui vira log e para ali.
 */
function handOverToLiveSession(
  slug: string,
  tag: string,
  prompt: string,
  record: Parameters<typeof appendContentLog>[1],
): void {
  if (!wakesLiveSession(slug)) return

  const agent = findAgent(slug)
  if (!agent) return

  // O conteudo primeiro: o rastro em disco nao pode depender de a sessao viva
  // estar de pe. Sessao desligada ainda assim deixa o dia gravado.
  appendContentLog(agent, record)

  void wakeLiveSession(agent, tag, prompt).catch((err: Error) => {
    logEvent(
      'warn',
      'wake_failed',
      { agent: slug, tag, error: err.message },
      `nao consegui acordar a sessao viva de ${slug}: ${err.message}`,
    )
  })
}

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

/**
 * Recado escrito para um agente.
 *
 * Nao e `/api/ask`: aquele e a tool do caminho de VOZ e amarra a sessao ao
 * `callId` da ligacao. Aqui a sessao e do AGENTE e sobrevive entre mensagens,
 * senao cada frase comecaria do zero.
 *
 * Como em `/api/ask`, nem o texto do dono nem a resposta entram no log.
 */
app.post('/api/message', requireSecret, async (req, res) => {
  const { agent, text } = req.body ?? {}

  if (typeof agent !== 'string' || typeof text !== 'string') {
    res.status(400).json({ error: 'Parametros invalidos.' })
    return
  }

  // O eco sai ANTES de o agente pensar: quem le a thread fica sabendo do
  // pedido na hora, nao seis segundos depois. Nao esperamos por ele — Telegram
  // lento ou fora do ar nao pode atrasar a resposta ao dono: ele corre junto
  // com o agente e, quando a resposta chega, ja terminou (o eco tem teto de
  // tempo proprio). `echoToThread` nunca lanca.
  const echo = echoToThread(agent, text)

  try {
    const result = await sendText({ agentSlug: agent, text })
    logEvent(
      'info',
      'message_answered',
      { agent, durationMs: result.durationMs },
      `${agent} respondeu um recado em ${result.durationMs}ms`,
    )
    const mark = await echo
    res.json({ reply: result.reply, echoed: mark.ok })

    // Acabamento da thread, DEPOIS de o dono ja ter a resposta na tela: a
    // mesma mensagem do pedido ganha a resposta embaixo.
    void completeEcho(agent, mark, text, result.reply)

    // E a sessao VIVA do agente fica sabendo que essa conversa aconteceu.
    handOverToLiveSession(agent, 'calling-msg', messagePrompt(agent, text, result.reply), {
      kind: 'message',
      text,
      reply: result.reply,
    })
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500
    logEvent(
      'error',
      'message_failed',
      { agent, status, error: (err as Error).message },
      `mensagem falhou: ${(err as Error).message}`,
    )
    res.status(status).json({ error: (err as Error).message })

    // A thread nao pode ficar com um "respondendo…" eterno quando o agente
    // falha: a mensagem fecha sem resposta.
    void echo.then((mark) => completeEcho(agent, mark, text, ''))

    // O dono FALOU, mesmo que a resposta tenha morrido no caminho — e isso e
    // justamente quando a sessao viva mais precisa saber: ela pode ir atras.
    handOverToLiveSession(agent, 'calling-msg', messagePrompt(agent, text, ''), {
      kind: 'message',
      text,
      reply: '',
    })
  }
})

/**
 * A ligacao de voz acabou de verdade.
 *
 * Um turno de voz sozinho nao acorda ninguem — seria cutucar a sessao viva a
 * cada frase de uma conversa em andamento. O ponto certo e AQUI: a ligacao
 * inteira vira UM recado, com os turnos em ordem.
 *
 * `drainCallTurns` vem ANTES de `endCall`, que e quem joga as sessoes fora.
 */
app.post('/api/end-call', requireSecret, (req, res) => {
  const callId = String(req.body?.callId || '')

  let transcripts: { agentSlug: string; turns: CallTurn[] }[] = []
  if (callId) {
    transcripts = drainCallTurns(callId)
    endCall(callId)
  }

  res.json({ ok: true })

  for (const transcript of transcripts) {
    handOverToLiveSession(
      transcript.agentSlug,
      'calling-call',
      callPrompt(transcript.agentSlug, transcript.turns),
      { kind: 'call', callId, turns: transcript.turns },
    )
  }
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
      // Mesmo criterio do motivo: o recado do dono nao vai para o log.
      hasReply: Boolean(resolution.reply),
    },
    `toque ${handle.call.id}: ${resolution.outcome}`,
  )

  if (res.writableEnded || res.destroyed) return
  // `reply` so aparece quando existe texto: quem ja lia os tres campos de
  // sempre nao ve campo novo vazio nem `undefined` no JSON.
  res.json({
    callId: handle.call.id,
    outcome: resolution.outcome,
    resolvedAt: resolution.resolvedAt,
    ...(resolution.reply ? { reply: resolution.reply } : {}),
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
/*
 * O AGENTE MUDOU A SI MESMO.
 *
 * A outra direcao da US-009: ninguem chama rota nenhuma: o agente reescreve o
 * proprio `calling-identity.json` (ele tem permissao ali) e o bridge precisa
 * perceber.
 *
 * Por que uma volta de relogio, e nao `fs.watch`: sao seis arquivos minusculos,
 * e uma leitura a cada tres segundos custa menos do que manter um observador
 * por workspace vivo e correto em todo sistema de arquivos (o `fs.watch` erra
 * feio em rede e em bind mount). A assinatura e o que a UI veria; se ela nao
 * mudou, ninguem e acordado.
 */
const IDENTITY_POLL_MS = 3000
let identitySignature = ''

function identityFingerprint(): string {
  return loadAgents()
    .map((agent) => {
      const identity = agentIdentity(agent)
      return `${agent.slug}|${identity.name}|${identity.color ?? ''}|${identity.avatarVersion}`
    })
    .join('\n')
}

identitySignature = identityFingerprint()

setInterval(() => {
  // Ninguem olhando: nao ha a quem avisar, e o disco agradece.
  if (streamCount() === 0) return
  const next = identityFingerprint()
  if (next === identitySignature) return
  identitySignature = next
  logEvent('info', 'identity_changed', {}, 'a identidade de algum agente mudou na VPS')
  notifyAgentsChanged()
}, IDENTITY_POLL_MS).unref()

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
  const action = String(req.params.action)
  const outcome = ACTIONS[action]
  if (!outcome) {
    res.status(400).json({ error: 'Acao desconhecida.' })
    return
  }

  /*
   * Recado de volta, so no caminho SEM voz: aprovar/recusar no dedo nao tem
   * como o dono responder em palavras, entao o texto vem por aqui e sai no
   * JSON do `/api/ring` do agente que ligou.
   *
   * Em `answer` o dono responde falando (a ligacao de voz que comeca depois ja
   * leva a conversa inteira de volta pra sessao dele), e `timeout` e o relogio,
   * nao o dono — nos dois casos um `reply` que venha e ignorado em silencio.
   */
  const wantsReply = action === 'approve' || action === 'decline'
  const reply = typeof req.body?.reply === 'string' ? req.body.reply.trim() : ''
  if (wantsReply && reply.length > 500) {
    res.status(400).json({ error: 'O motivo precisa caber num cartao: no maximo 500 caracteres.' })
    return
  }

  const resolution = finish(String(req.params.id), outcome, wantsReply ? reply : undefined)
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
    action,
    outcome: resolution.outcome,
    // `applied: false` = o desfecho ja estava decidido e este clique so ecoou.
    applied: resolution.applied,
    // So o fato de ter recado: o texto e do dono para o agente, nao para o log.
    hasReply: Boolean(resolution.reply),
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
      wakeAgents: wakeAgents(),
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
  const waking = wakeAgents()
  console.log(
    waking.length > 0
      ? `[calling] acordam a sessao viva (+ log de conteudo): ${waking.join(', ')}`
      : '[calling] nenhum agente acorda a sessao viva — CALLING_WAKE_AGENTS vazio.',
  )
  console.log(`[calling] origens liberadas: ${allowlist.effective.join(', ')}`)
  console.log(`[calling] log em ${logDestination} (NDJSON, 5 arquivos x 5MB)`)

  /*
   * A CARA QUE FALTA VEM DO PROPRIO BOT.
   *
   * Agente sem imagem ganha, na subida, a foto de perfil do bot dele no
   * Telegram — pelo token que ele ja tem para o eco na thread. Quem ja tem
   * imagem nao e tocado.
   *
   * Sem `await`, e DEPOIS do `listen`: o bridge ja esta atendendo request
   * quando isto comeca, entao seis idas ao Telegram nao adiam nada. Quando uma
   * imagem entra no disco, a volta de relogio da identidade (`IDENTITY_POLL_MS`)
   * avisa a UI sozinha — e o `catch` existe so para que um erro que escape nao
   * vire uma rejeicao nao tratada no journal.
   */
  void backfillAvatars(loadAgents()).catch((err: Error) => {
    logEvent(
      'warn',
      'avatar_backfill_failed',
      { error: err.message },
      `o backfill de avatares parou: ${err.message}`,
    )
  })
})
