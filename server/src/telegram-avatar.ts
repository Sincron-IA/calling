/**
 * A CARA DO AGENTE JA EXISTE — ELA SO ESTAVA NO TELEGRAM.
 *
 * Cada um dos seis agentes tem um bot proprio, e cada bot ja tem uma foto de
 * perfil posta pelo BotFather. Ate aqui, para essa mesma figura aparecer no
 * Calling, alguem tinha que baixar a imagem na mao e subir pelo app (ou editar
 * o `calling-identity.json` a unha). Duas verdades para a mesma cara, e a
 * segunda sempre atrasada em relacao a primeira.
 *
 * Entao o bridge vai buscar. Sao quatro chamadas a Bot API, com o token que o
 * agente JA tem configurado para o eco na thread (`CALLING_TELEGRAM_TOKEN_
 * <SLUG>`): nenhum segredo novo, nenhuma variavel nova no `.env`.
 *
 *   1. getMe                 -> o id numerico do proprio bot
 *   2. getUserProfilePhotos  -> o `file_id` da maior versao da foto mais recente
 *   3. getFile               -> o `file_path` daquele arquivo
 *   4. /file/bot<token>/...  -> os bytes
 *
 * Escopo, de proposito estreito: isto e um BACKFILL DE PARTIDA. So preenche
 * quem esta SEM imagem. Avatar posto na mao — pelo dono no app, ou pelo proprio
 * agente escrevendo no workspace dele — nunca e sobrescrito por este caminho.
 * Quem quiser TROCAR uma imagem que ja existe continua passando pelo
 * `PUT /api/agents/:slug/identity`, que e a unica porta que substitui e a unica
 * que apaga.
 *
 * Nada aqui lanca. A foto de perfil de um bot e um acabamento: o Telegram fora
 * do ar, um token revogado ou uma resposta estranha viram UMA linha no log e o
 * bridge segue exatamente como seguiria antes desta funcionalidade existir.
 */

import type { AgentEntry } from './agents.js'
import { MAX_AVATAR_BYTES, prepareAvatar } from './avatar.js'
import { agentIdentity, avatarPath, writeIdentity } from './identity-file.js'
import { logEvent } from './logger.js'
import { tokenFor } from './telegram.js'

/** Mesmo teto de tempo do eco: uma chamada pendurada nao segura o boot. */
const TIMEOUT_MS = 8000

/** Cor de partida, se nem o arquivo nem o `agents.json` trouxerem uma. */
const FALLBACK_COLOR = '#4ade80'

/**
 * O `file_path` volta do Telegram e vira URL. Ele e sempre algo como
 * `photos/file_12.jpg`, mas ele vem de FORA — entao passa por um crivo antes de
 * ser concatenado: so o alfabeto de um caminho simples, e nada de subir de
 * diretorio.
 */
const SAFE_FILE_PATH = /^[A-Za-z0-9._\-/]+$/

export interface BotAvatar {
  data: Buffer
  ext: string
}

/** Uma leitura JSON da Bot API, com teto de tempo e sem nunca lancar. */
async function getJson(token: string, method: string, query = ''): Promise<unknown | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/${method}${query}`,
      { signal: controller.signal },
    )
    if (!res.ok) return null

    const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: unknown } | null
    if (!data || data.ok !== true) return null
    return data.result ?? null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Os bytes do arquivo, ou `null`. Corta cedo o que nao caberia mesmo assim. */
async function download(token: string, filePath: string): Promise<Buffer | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(
      `https://api.telegram.org/file/bot${token}/${filePath}`,
      { signal: controller.signal },
    )
    if (!res.ok) return null

    // O `prepareAvatar` recusaria depois, mas ler 50 MB para joga-los fora seria
    // trabalho a toa: quando o Telegram declara o tamanho, desistimos antes.
    const declared = Number(res.headers.get('content-length') || 0)
    if (declared > MAX_AVATAR_BYTES) return null

    return Buffer.from(await res.arrayBuffer())
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** So para o log: por onde a busca parou. Nunca carrega token nem bytes. */
function fail(slug: string, reason: string): null {
  logEvent(
    'warn',
    'avatar_fetch_failed',
    { agent: slug, reason },
    `nao consegui a foto de perfil de ${slug} no Telegram (${reason})`,
  )
  return null
}

/**
 * A foto de perfil do bot daquele agente, ja validada e pronta para o disco.
 *
 * @returns `{ data, ext }`, ou `null` se faltou token, se o bot nao tem foto, se
 *          o Telegram nao respondeu, ou se o que voltou nao e uma imagem que o
 *          bridge aceita guardar.
 */
export async function fetchBotAvatar(slug: string): Promise<BotAvatar | null> {
  const token = tokenFor(slug)
  if (!token) return fail(slug, 'sem_token')

  // 1. Quem e este bot. A Bot API nao tem "minha propria foto": precisa do id.
  const me = (await getJson(token, 'getMe')) as { id?: unknown } | null
  const botId = Number(me?.id ?? 0)
  if (!Number.isFinite(botId) || botId <= 0) return fail(slug, 'getMe')

  // 2. A foto mais recente. Dentro de uma foto, o Telegram lista as resolucoes
  //    da menor para a maior — a ultima e a melhor que existe.
  const photos = (await getJson(
    token,
    'getUserProfilePhotos',
    `?user_id=${botId}&limit=1`,
  )) as { total_count?: unknown; photos?: unknown } | null

  const sizes = Array.isArray(photos?.photos) ? photos.photos[0] : null
  if (!Array.isArray(sizes) || sizes.length === 0) return fail(slug, 'sem_foto')

  const fileId = (sizes[sizes.length - 1] as { file_id?: unknown } | null)?.file_id
  if (typeof fileId !== 'string' || !fileId) return fail(slug, 'sem_file_id')

  // 3. O caminho do arquivo, que vale por uma hora.
  const file = (await getJson(
    token,
    'getFile',
    `?file_id=${encodeURIComponent(fileId)}`,
  )) as { file_path?: unknown } | null

  const filePath = typeof file?.file_path === 'string' ? file.file_path : ''
  if (!filePath || filePath.includes('..') || !SAFE_FILE_PATH.test(filePath)) {
    return fail(slug, 'file_path')
  }

  // 4. Os bytes.
  const buf = await download(token, filePath)
  if (!buf || buf.length === 0) return fail(slug, 'download')

  // A extensao sai da ASSINATURA, nunca do nome que veio no `file_path`: e o
  // mesmo crivo por onde passa uma imagem que o dono sobe pelo app. Download
  // truncado, ou uma pagina de erro no lugar da figura, morre aqui.
  try {
    const ready = prepareAvatar(buf)
    return { data: ready.data, ext: ready.ext }
  } catch (err) {
    return fail(slug, `imagem_invalida: ${(err as Error).message}`)
  }
}

/** Preenche a imagem de UM agente, se ele estiver sem uma. */
async function backfillOne(agent: AgentEntry): Promise<void> {
  // Quem ja tem cara fica com a que tem. A lista chega aqui ja filtrada; esta
  // linha e o cinto de seguranca de quem escrever outro chamador amanha.
  if (avatarPath(agent)) return

  const avatar = await fetchBotAvatar(agent.slug)
  if (!avatar) return

  // Nome e cor sao os que JA valem — este caminho existe para preencher a
  // imagem que falta, e para mais nada. A cor tem que ser um hex valido ou o
  // `writeIdentity` recusa; os seis tem cor no `agents.json`, mas um registro
  // futuro sem cor nao pode fazer o backfill explodir.
  const identity = agentIdentity(agent)

  try {
    writeIdentity(agent, {
      name: identity.name,
      color: identity.color ?? FALLBACK_COLOR,
      avatar,
    })
  } catch (err) {
    logEvent(
      'warn',
      'avatar_fetch_failed',
      { agent: agent.slug, reason: `gravacao: ${(err as Error).message}` },
      `a foto de ${agent.slug} veio do Telegram mas nao foi gravada: ${(err as Error).message}`,
    )
    return
  }

  logEvent(
    'info',
    'avatar_fetched',
    { agent: agent.slug, bytes: avatar.data.length, ext: avatar.ext },
    `${agent.slug} ganhou a foto do proprio bot (${avatar.data.length} bytes, ${avatar.ext})`,
  )
}

/**
 * O backfill de partida, para a lista inteira.
 *
 * Chamado DEPOIS de o bridge ja estar escutando, e nunca esperado: seis idas ao
 * Telegram nao podem ficar entre o `listen` e o primeiro request atendido. As
 * seis correm juntas (`allSettled`), e uma que falhe nao encosta nas outras.
 */
export async function backfillAvatars(agents: AgentEntry[]): Promise<void> {
  const missing = agents.filter((agent) => !avatarPath(agent))
  if (missing.length === 0) return

  logEvent(
    'info',
    'avatar_backfill_started',
    { agents: missing.map((a) => a.slug) },
    `buscando no Telegram a foto de: ${missing.map((a) => a.slug).join(', ')}`,
  )

  await Promise.allSettled(missing.map((agent) => backfillOne(agent)))
}
