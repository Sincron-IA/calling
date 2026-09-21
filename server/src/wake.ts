/**
 * ACORDAR A SESSAO VIVA — o Calling como segunda janela da MESMA conversa.
 *
 * O problema que isto resolve: quando o dono manda um recado pelo Calling, quem
 * responde e uma sessao HEADLESS do Claude Code (`server/src/claude.ts`), criada
 * so para aquela chamada de API. A sessao VIVA do agente — a mesma que atende o
 * Telegram, que tem a memoria de trabalho do dia na cabeca e que pode comecar
 * trabalho de verdade — nunca ficava sabendo que aquilo aconteceu. O dono
 * falava com o agente e o agente, do outro lado, nao lembrava de nada.
 *
 * O jeito de acordar NAO e invencao nova. E exatamente o mesmo mecanismo que os
 * agendamentos (self-crons) do DG Claw usam ha tempos, e que outros scripts
 * internos (`heartbeat.sh`) ja reconhecem como "isto nao e o dono falando
 * direto": `inject_session <slug> <tag>`, de
 * `<workspace>/.dgclaw/plugin/scripts/_lib/inject.sh`. Ele escreve um poke-file
 * em /tmp e injeta na sessao viva, por TIOCSTI, um aviso curto mandando ler
 * aquele arquivo. Passamos SEMPRE pelo symlink `.dgclaw/plugin` (nunca pela
 * pasta versionada), e o PROMPT vai por STDIN — nunca interpolado dentro do
 * `bash -c`, que seria injecao de shell com texto que o dono escreveu.
 *
 * Tres regras que valem para tudo aqui:
 *
 *  1. OPT-IN POR AGENTE. Sem o slug em `CALLING_WAKE_AGENTS`, nada disto roda e
 *     o comportamento do agente continua exatamente o de antes. Hoje so
 *     `automa` esta na lista; os outros cinco nao mudam de comportamento.
 *  2. FIRE-AND-FORGET, SEMPRE DEPOIS DA RESPOSTA. Acordar a sessao viva nao
 *     pode atrasar nem derrubar a resposta ao app. Toda falha vira uma linha de
 *     log e morre ali.
 *  3. O LOG DE OPERACAO NAO VE CONVERSA. `logger.ts` grava metadado e sempre
 *     gravou so isso. O texto do dono vai para um lugar SEPARADO — o log de
 *     conteudo abaixo, dentro do workspace do proprio agente.
 */

import { spawn } from 'node:child_process'
import { chmodSync, closeSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentEntry } from './agents.js'
import { logEvent } from './logger.js'

/* ------------------------------------------------------------- opt-in ----- */

/**
 * Quais agentes tem esse comportamento ligado.
 *
 * Config, nao codigo: uma linha no `.env` (`CALLING_WAKE_AGENTS=automa`) liga o
 * agente, e tirar a linha desliga. E deliberadamente uma lista, e nao um
 * booleano global, porque o dono foi explicito: por enquanto so a `automa` — os
 * outros cinco continuam como estao ate ele decidir o contrario.
 */
const WAKE_AGENTS = new Set(
  (process.env.CALLING_WAKE_AGENTS || '')
    .split(',')
    .map((slug) => slug.trim().toLowerCase())
    .filter(Boolean),
)

/** Este agente acorda a sessao viva (e tem log de conteudo)? */
export function wakesLiveSession(slug: string): boolean {
  return WAKE_AGENTS.has(slug.toLowerCase())
}

/** So para o log de boot dizer quem esta na lista. */
export function wakeAgents(): string[] {
  return [...WAKE_AGENTS]
}

/* -------------------------------------------------------------- injecao --- */

/**
 * O script que roda no filho. Repare que ele nao tem NENHUM texto do dono
 * dentro: workspace e tag entram como argumentos posicionais ($1 e $2) e o
 * prompt entra pelo stdin. Interpolar qualquer uma dessas coisas na string
 * seria dar um shell para quem escreve no app.
 */
const INJECT_SCRIPT =
  'source "$1/.dgclaw/config.sh" && ' +
  'source "$DGCLAW_PLUGIN_ROOT/scripts/_lib/inject.sh" && ' +
  'inject_session "$DGCLAW_SLUG" "$2"'

/**
 * Codigos de saida que NAO sao erro.
 *
 *   0  — injetado.
 *   2  — a sessao estava desligada (no-op gracioso), ou estava OCUPADA com um
 *        turno do dono em voo e o `inject.sh` adiou sozinho.
 *   75 — sessao ocupada, caso o `inject.py` devolva o codigo cru.
 *
 * Nenhum deles merece barulho: sao o mecanismo funcionando como foi desenhado.
 */
const QUIET_CODES = new Set([0, 2, 75])

/** Quanto tempo esperamos o bash antes de desistir em silencio. */
const INJECT_TIMEOUT_MS = 20_000

/**
 * Quantas vezes insistimos quando a sessao estava OCUPADA, e de quanto em
 * quanto tempo.
 *
 * Isto existe porque o `inject.sh` foi feito para CRON: quando a sessao esta no
 * meio de um turno do dono, ele descarta o poke e conta com o proximo disparo
 * do relogio para tentar de novo. Aqui nao ha proximo disparo — o dono falou
 * UMA vez, pelo Calling, e se esse recado cair no chao a sessao viva nunca fica
 * sabendo. Entao nos e que somos o relogio.
 *
 * Tres tentativas a meio minuto cobrem um turno normal do Telegram. Depois
 * disso desistimos e dizemos isso no log — o conteudo, esse, ja esta gravado no
 * log de conteudo de qualquer jeito, entao nada se perde de verdade.
 */
const BUSY_RETRIES = 3
const BUSY_RETRY_MS = 30_000

/** Como o `inject.sh` anuncia "adiei porque a sessao estava ocupada". */
const BUSY_MARK = 'ocupada'

interface InjectResult {
  code: number
  stderr: string
}

/** Uma tentativa. Nunca lanca. */
function runInject(agent: AgentEntry, tag: string, prompt: string): Promise<InjectResult> {
  return new Promise<InjectResult>((resolvePromise) => {
    let settled = false
    let stderr = ''
    const done = (code: number) => {
      if (settled) return
      settled = true
      resolvePromise({ code, stderr })
    }

    const child = spawn('bash', ['-c', INJECT_SCRIPT, 'bash', agent.workspace, tag], {
      stdio: ['pipe', 'ignore', 'pipe'],
    })

    child.stderr.on('data', (chunk) => {
      // O `inject.sh` fala pelo stderr mesmo quando da certo ("injetado ...").
      // E dali que sai a diferenca entre "sessao desligada" e "sessao ocupada",
      // que o codigo de saida sozinho (2 nos dois casos) nao conta.
      if (stderr.length < 2000) stderr += chunk
    })

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      done(-2)
    }, INJECT_TIMEOUT_MS)
    timer.unref?.()

    child.on('error', (err) => {
      clearTimeout(timer)
      stderr += String(err.message)
      done(-1)
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      done(code ?? -1)
    })

    // O prompt vai por STDIN, como o `inject_session` espera — e como manda o
    // bom senso: nada do que o dono escreveu passa perto da linha de comando.
    try {
      child.stdin.write(prompt)
      child.stdin.end()
    } catch {
      // Filho ja morreu; o handler de `error`/`close` resolve.
    }
  })
}

function wait(ms: number): Promise<void> {
  return new Promise((done) => {
    const timer = setTimeout(done, ms)
    timer.unref?.()
  })
}

/**
 * Acorda a sessao viva do agente com um recado escrito por nos.
 *
 * `tag` e o RÓTULO da familia do poke (`calling-msg`, `calling-call`); a
 * tag de verdade ganha um sufixo unico aqui dentro. Isso nao e detalhe: o
 * `inject.sh` carimba em todo poke um cabecalho de IDEMPOTENCIA no formato "se
 * voce JA executou '<tag>' em <hoje>, NAO repita". Para um cron diario isso e
 * exatamente o que se quer; para uma CONVERSA seria desastroso — a segunda
 * mensagem do dia seria lida como repeticao da primeira e a sessao viva a
 * descartaria. Com sufixo unico, cada recado e um evento proprio.
 *
 * Nunca lanca: a promessa sempre resolve. Quem chama nao precisa (e nao deve)
 * esperar por ela.
 */
export async function wakeLiveSession(
  agent: AgentEntry,
  tag: string,
  prompt: string,
): Promise<void> {
  const uniqueTag = `${tag}-${Date.now().toString(36)}`

  for (let attempt = 0; attempt <= BUSY_RETRIES; attempt += 1) {
    const { code, stderr } = await runInject(agent, uniqueTag, prompt)

    if (code === -2) {
      logEvent(
        'warn',
        'wake_timeout',
        { agent: agent.slug, tag: uniqueTag, timeoutMs: INJECT_TIMEOUT_MS },
        `nao consegui acordar a sessao viva de ${agent.slug} (tempo esgotado)`,
      )
      return
    }

    const busy = QUIET_CODES.has(code) && stderr.includes(BUSY_MARK)

    if (!busy) {
      if (QUIET_CODES.has(code)) {
        // Nem o prompt nem o recado do dono entram no log de operacao: so o
        // fato de que houve um toque na sessao viva e como ele terminou.
        logEvent('info', 'wake_sent', { agent: agent.slug, tag: uniqueTag, code, attempt })
      } else {
        logEvent(
          'warn',
          'wake_failed',
          { agent: agent.slug, tag: uniqueTag, code, stderr: stderr.slice(-400) },
          `injecao na sessao viva de ${agent.slug} saiu com codigo ${code}`,
        )
      }
      return
    }

    if (attempt === BUSY_RETRIES) {
      logEvent(
        'warn',
        'wake_gave_up',
        { agent: agent.slug, tag: uniqueTag, attempts: attempt + 1 },
        `sessao viva de ${agent.slug} ocupada em todas as tentativas — o recado do Calling ficou so no log de conteudo`,
      )
      return
    }

    logEvent('info', 'wake_deferred', { agent: agent.slug, tag: uniqueTag, attempt })
    await wait(BUSY_RETRY_MS)
  }
}

/* --------------------------------------------------------------- prompts -- */

/** Teto de um pedaco de conversa dentro do prompt de acordar. */
const PROMPT_EXCERPT_MAX = 1500

function excerpt(text: string): string {
  const clean = (text || '').trim()
  if (!clean) return '(vazio)'
  if (clean.length <= PROMPT_EXCERPT_MAX) return clean
  return `${clean.slice(0, PROMPT_EXCERPT_MAX)}… (cortado)`
}

const CLOSING =
  'Isso é uma conversa de verdade com o dono, mesmo peso de uma mensagem no Telegram. ' +
  'Decida se precisa agir e se vale avisar ele aqui no Telegram (rastro visível, curto) ' +
  'confirmando que você viu.'

/** Um turno de voz: o que o dono perguntou e o que o agente respondeu. */
export interface CallTurn {
  q: string
  a: string
}

/** O prompt de um recado ESCRITO. `reply` vazio = o agente nao conseguiu responder. */
export function messagePrompt(slug: string, text: string, reply: string): string {
  const answer = reply.trim()
    ? excerpt(reply)
    : '(não consegui responder — a chamada falhou antes de sair resposta)'

  return [
    `Recado chegou pelo Calling (texto), agente ${slug}.`,
    `Dono escreveu: ${excerpt(text)}`,
    `Você respondeu: ${answer}`,
    '',
    CLOSING,
  ].join('\n')
}

/** O prompt de uma LIGACAO de voz inteira, montado quando ela termina. */
export function callPrompt(slug: string, turns: CallTurn[]): string {
  const lines = turns.map(
    (turn, index) => `Turno ${index + 1} — dono: ${excerpt(turn.q)} | você: ${excerpt(turn.a)}`,
  )

  return [
    `Ligação pelo Calling encerrada, agente ${slug} (duração aproximada: ${turns.length} turnos).`,
    ...lines,
    '',
    'Mesma coisa: decida se precisa agir e se vale um rastro curto aqui no Telegram ' +
      'confirmando que você viu.',
  ].join('\n')
}

/* ---------------------------------------------------------- log de conteudo */

/**
 * O LOG DE CONTEUDO — autorizado explicitamente pelo dono em 2026-09-20
 * ("nao tenho objecao nenhuma quanto a gravar o que esta sendo falado para
 * analise pos").
 *
 * Por que NAO vai para `/var/log/calling-bridge/bridge.log`: aquele e o log de
 * OPERACAO e nunca teve texto de conversa — e a garantia que o projeto da de
 * que ninguem le a conversa do dono procurando um erro de CORS. Misturar as
 * duas coisas destruiria essa garantia de uma vez.
 *
 * Onde vai: `<workspace>/calling-log/<YYYY-MM-DD>.ndjson`, DENTRO do workspace
 * do proprio agente — o mesmo lugar onde ja moram a memoria e a identidade
 * dele. Diretorio 0700 e arquivos 0600: conversa privada nao e world-readable.
 *
 * A data e a do fuso do dono (o relogio da VPS ja e America/Sao_Paulo), e nao
 * UTC, senao o arquivo do dia viraria as 21h — no meio da noite dele.
 */

export interface ContentLogRecord {
  kind: 'message' | 'call'
  text?: string
  reply?: string
  callId?: string
  turns?: CallTurn[]
}

function localDay(): string {
  // `en-CA` formata como YYYY-MM-DD, que e o que se quer num nome de arquivo
  // que precisa ordenar sozinho.
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** Escreve uma linha no log de conteudo do agente. Nunca lanca. */
export function appendContentLog(agent: AgentEntry, record: ContentLogRecord): void {
  try {
    const dir = join(agent.workspace, 'calling-log')
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    // `mkdirSync` respeita o umask do processo, entao o modo pedido pode nao
    // ser o modo obtido — e o diretorio pode ja existir de antes. Firmamos.
    chmodSync(dir, 0o700)

    const file = join(dir, `${localDay()}.ndjson`)
    const line = `${JSON.stringify({ time: new Date().toISOString(), ...record })}\n`

    const fd = openSync(file, 'a', 0o600)
    try {
      writeSync(fd, line)
    } finally {
      closeSync(fd)
    }
    chmodSync(file, 0o600)
  } catch (err) {
    // O log de conteudo e testemunha, nao e o servico: se ele falhar, o dono
    // ainda tem a resposta na tela e a sessao viva ainda e acordada.
    logEvent(
      'warn',
      'content_log_failed',
      { agent: agent.slug, kind: record.kind, error: (err as Error).message },
      `nao consegui gravar o log de conteudo de ${agent.slug}: ${(err as Error).message}`,
    )
  }
}
