/**
 * O RECADO TAMBEM APARECE NA THREAD DO AGENTE.
 *
 * Quem manda e o BRIDGE, nao o agente — e isso e deliberado. Dentro da sessao
 * headless a tool de reply do Telegram NAO EXISTE; as regras de canal em
 * `identity.ts` dizem isso com todas as letras, e elas nasceram justamente
 * porque o agente tentava chama-la e a resposta saia errada.
 *
 * Entao o eco sai daqui, direto na Bot API, assim que a mensagem chega — antes
 * de o agente terminar de pensar. Quem le a thread ve o pedido citado e sabe
 * que alguem esta cuidando dele.
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

const HEAD = '📞 Pedido pelo Calling'
const TAIL = 'Tô cuidando disso.'

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
 * Monta o texto final, ja dentro do teto do Telegram.
 *
 * O corte acontece no texto ORIGINAL, antes do escape: cortar depois poderia
 * partir uma entidade (`&amp;`) no meio e deixar lixo na thread.
 */
export function buildEcho(text: string): string {
  const overhead = `${HEAD}\n<blockquote></blockquote>\n${TAIL}`.length
  const room = TELEGRAM_MAX - overhead - 1

  let body = text.trim()
  if (body.length > room) body = `${body.slice(0, room - 1)}…`

  return `${HEAD}\n<blockquote>${escapeHtml(body)}</blockquote>\n${TAIL}`
}

/**
 * Manda o eco. Nao lanca: o pior caso e uma linha no log. Devolve se o eco
 * chegou na thread — o app mostra isso como "na thread" no balao.
 *
 * Agente sem credencial configurada simplesmente nao ecoa — e o recado dele
 * segue normalmente para a sessao. Isso e o que permite ligar o Telegram de um
 * agente por vez, sem parar os outros.
 */
export async function echoToThread(agentSlug: string, text: string): Promise<boolean> {
  const token = tokenFor(agentSlug)
  const chatId = chatFor(agentSlug)

  if (!token || !chatId) {
    logEvent(
      'debug',
      'telegram_skipped',
      { agent: agentSlug, hasToken: Boolean(token), hasChat: Boolean(chatId) },
      `${agentSlug} nao tem Telegram configurado; eco pulado`,
    )
    return false
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: buildEcho(text),
        parse_mode: 'HTML',
        disable_notification: true,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      // O corpo do erro do Telegram nunca repete o token, mas a URL repetiria:
      // so o status entra no log.
      logEvent(
        'warn',
        'telegram_failed',
        { agent: agentSlug, status: res.status },
        `Telegram recusou o eco de ${agentSlug} (${res.status})`,
      )
      return false
    }

    // O TEXTO do pedido nao entra no log — so que o eco saiu.
    logEvent('info', 'telegram_echoed', { agent: agentSlug }, `eco de ${agentSlug} na thread`)
    return true
  } catch (err) {
    logEvent(
      'warn',
      'telegram_failed',
      { agent: agentSlug, error: (err as Error).name },
      `nao consegui ecoar para ${agentSlug}: ${(err as Error).name}`,
    )
    return false
  } finally {
    clearTimeout(timer)
  }
}
