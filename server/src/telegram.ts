/**
 * O RECADO — E A RESPOSTA — TAMBEM APARECEM NA THREAD DO AGENTE.
 *
 * Quem manda e o BRIDGE, nao o agente — e isso e deliberado. Dentro da sessao
 * headless a tool de reply do Telegram NAO EXISTE; as regras de canal em
 * `identity.ts` dizem isso com todas as letras, e elas nasceram justamente
 * porque o agente tentava chama-la e a resposta saia errada.
 *
 * Sao DOIS momentos, na MESMA mensagem:
 *
 * 1. o pedido sai assim que chega, antes de o agente pensar — quem le a thread
 *    fica sabendo na hora;
 * 2. quando a resposta fica pronta, a mesma mensagem e EDITADA e ganha a
 *    resposta embaixo, num bloco recolhivel.
 *
 * Editar, e nao mandar outra: a thread fica com uma mensagem por troca, em vez
 * de duas soltas, e a resposta fica junto do pedido que a gerou — que e
 * exatamente o que faltava quando o agente voltava na thread e so encontrava
 * "To cuidando disso".
 *
 * Escopo: recado de TEXTO. Turno de voz nao ecoa; encheria a thread.
 *
 * NADA disso derruba ou atrasa a resposta ao dono: a falha do Telegram e um
 * aviso no log, nunca um erro na tela.
 */

import { logEvent } from './logger.js'

/** Quanto tempo esperamos o Telegram antes de desistir em silencio. */
const TIMEOUT_MS = 8000

/** Teto de uma mensagem na Bot API. */
const TELEGRAM_MAX = 4096

/** Teto do PEDIDO dentro da mensagem: o resto do espaco e da resposta. */
const ASK_MAX = 1200

const HEAD = '📞 Pedido pelo Calling'

/** Enquanto o agente pensa. Sai quando a resposta chega. */
const PENDING = '<i>respondendo…</i>'

/** Depois que a resposta entrou (ou que ela ficou so no Calling). */
const DONE = '<i>respondido pelo Calling</i>'

/**
 * O que o eco sabe sobre si mesmo.
 *
 * `messageId` e o que permite EDITAR depois; sem ele (eco pulado, ou recusado
 * pelo Telegram) a segunda parte simplesmente nao acontece.
 */
export interface EchoMark {
  ok: boolean
  chatId: string
  messageId: number
}

const NO_ECHO: EchoMark = { ok: false, chatId: '', messageId: 0 }

function envName(prefix: string, slug: string): string {
  return `${prefix}${slug.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
}

/**
 * O token do bot daquele agente.
 *
 * Cada agente pode ter o seu (`CALLING_TELEGRAM_TOKEN_<SLUG>`); na falta dele,
 * vale um token comum a todos (`CALLING_TELEGRAM_BOT_TOKEN`). Segredo nunca
 * mora no `agents.json`, que e publico no GitHub — mesma regra dos tokens de
 * toque que ja existem.
 */
function tokenFor(slug: string): string {
  return (
    process.env[envName('CALLING_TELEGRAM_TOKEN_', slug)] ||
    process.env.CALLING_TELEGRAM_BOT_TOKEN ||
    ''
  )
}

/** A conversa em que aquele agente fala. Sem ela nao ha para onde mandar. */
function chatFor(slug: string): string {
  return process.env[envName('CALLING_TELEGRAM_CHAT_', slug)] || ''
}

/**
 * Escapa o que o Telegram interpreta como marcacao em `parse_mode: HTML`.
 *
 * Sao exatamente estes tres. Sem isso, um recado que contenha `<b>` (ou
 * qualquer coisa parecida) sairia formatado — ou quebraria a mensagem inteira.
 */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Corta no texto ORIGINAL, antes do escape: cortar depois poderia partir uma
 * entidade (`&amp;`) no meio e deixar lixo na thread.
 */
function clamp(text: string, room: number): string {
  const body = text.trim()
  if (room <= 1) return ''
  return body.length > room ? `${body.slice(0, room - 1)}…` : body
}

/**
 * Monta o texto da mensagem, nos dois momentos, ja dentro do teto do Telegram.
 *
 * O PEDIDO tem prioridade no espaco: ele e curto por natureza e e a ancora da
 * troca. A resposta fica com o que sobrar — resposta longa nao pode empurrar o
 * pedido para fora da mensagem.
 */
export function buildEcho(text: string, reply?: string): string {
  const tail = reply === undefined ? PENDING : DONE
  const asked = clamp(text, Math.min(ASK_MAX, TELEGRAM_MAX - HEAD.length - tail.length - 30))
  const head = `${HEAD}\n<blockquote>${escapeHtml(asked)}</blockquote>`

  if (reply === undefined) return `${head}\n${tail}`

  // O que sobra depois do cabecalho, do pedido ja escapado, das tags do bloco
  // recolhivel e da linha final.
  const spent = `${head}\n<blockquote expandable></blockquote>\n${tail}`.length
  const answered = clamp(reply, TELEGRAM_MAX - spent - 1)

  if (!answered) return `${head}\n${tail}`
  return `${head}\n<blockquote expandable>${escapeHtml(answered)}</blockquote>\n${tail}`
}

/** Uma chamada a Bot API, com teto de tempo e sem nunca lancar. */
async function callApi(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; messageId: number }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) return { ok: false, messageId: 0 }

    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; result?: { message_id?: number } }
      | null
    return { ok: data?.ok === true, messageId: Number(data?.result?.message_id ?? 0) }
  } catch {
    return { ok: false, messageId: 0 }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Manda o pedido para a thread. Nao lanca: o pior caso e uma linha no log.
 *
 * Agente sem credencial configurada simplesmente nao ecoa — e o recado dele
 * segue normalmente para a sessao. Isso e o que permite ligar o Telegram de um
 * agente por vez, sem parar os outros.
 */
export async function echoToThread(agentSlug: string, text: string): Promise<EchoMark> {
  const token = tokenFor(agentSlug)
  const chatId = chatFor(agentSlug)

  if (!token || !chatId) {
    logEvent(
      'debug',
      'telegram_skipped',
      { agent: agentSlug, hasToken: Boolean(token), hasChat: Boolean(chatId) },
      `${agentSlug} nao tem Telegram configurado; eco pulado`,
    )
    return NO_ECHO
  }

  const sent = await callApi(token, 'sendMessage', {
    chat_id: chatId,
    text: buildEcho(text),
    parse_mode: 'HTML',
    disable_notification: true,
  })

  if (!sent.ok) {
    // O corpo do erro do Telegram nunca repete o token, mas a URL repetiria:
    // so o fato entra no log.
    logEvent(
      'warn',
      'telegram_failed',
      { agent: agentSlug, step: 'send' },
      `Telegram recusou o eco de ${agentSlug}`,
    )
    return NO_ECHO
  }

  // O TEXTO do pedido nao entra no log — so que o eco saiu.
  logEvent('info', 'telegram_echoed', { agent: agentSlug }, `eco de ${agentSlug} na thread`)
  return { ok: true, chatId, messageId: sent.messageId }
}

/**
 * A resposta do agente entra na MESMA mensagem do pedido.
 *
 * Chamada DEPOIS de o dono ja ter sido respondido: isto aqui e acabamento da
 * thread e nao pode segurar a tela de ninguem. Sem `messageId` (eco que nao
 * saiu) nao ha o que editar, e a funcao termina calada.
 *
 * `reply` vazio = o agente falhou. A mensagem fecha mesmo assim, em vez de
 * ficar com um "respondendo…" eterno.
 */
export async function completeEcho(
  agentSlug: string,
  mark: EchoMark,
  text: string,
  reply: string,
): Promise<void> {
  if (!mark.ok || !mark.messageId) return

  const token = tokenFor(agentSlug)
  if (!token) return

  const edited = await callApi(token, 'editMessageText', {
    chat_id: mark.chatId,
    message_id: mark.messageId,
    text: buildEcho(text, reply),
    parse_mode: 'HTML',
  })

  if (!edited.ok) {
    logEvent(
      'warn',
      'telegram_failed',
      { agent: agentSlug, step: 'edit' },
      `nao consegui juntar a resposta ao eco de ${agentSlug}`,
    )
    return
  }

  logEvent(
    'info',
    'telegram_completed',
    { agent: agentSlug },
    `a resposta de ${agentSlug} entrou no eco da thread`,
  )
}
