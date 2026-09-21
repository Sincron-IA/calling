/**
 * O que o bridge aceita guardar como imagem de agente.
 *
 * Este arquivo existe porque a imagem chega de FORA (o dono manda do app) e
 * depois volta a ser SERVIDA pelo proprio bridge. Arquivo que faz esse caminho
 * nao pode ser gravado sem ser olhado: o que decide o que ele e sao os
 * primeiros bytes dele, nunca a extensao que veio no nome nem o `content-type`
 * que o cliente declarou.
 *
 * Limitacao honesta: aqui nao ha recodificacao de pixel (isso exigiria um
 * codec no servidor). O que ha e:
 *
 *   - assinatura conferida byte a byte, contra uma lista fechada de formatos;
 *   - PNG REESCRITO so com os pedacos essenciais — todo metadado (EXIF,
 *     comentario, perfil de cor, e o que mais alguem tenha enfiado la) e
 *     descartado;
 *   - teto de tamanho;
 *   - e, na volta, `content-type` fixo da lista + `nosniff`.
 *
 * SVG nao entra de proposito: e um documento que executa, nao uma figura.
 */

/** Teto do arquivo. Um avatar de 28px nao precisa de mais que isso. */
export const MAX_AVATAR_BYTES = 512 * 1024

export interface SniffResult {
  /** Extensao canonica, com ponto. */
  ext: string
  /** O `content-type` que o bridge usa ao servir de volta. */
  type: string
}

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false
  return bytes.every((byte, i) => buf[offset + i] === byte)
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * O que estes bytes sao de verdade, ou `null` se nao forem nada que aceitamos.
 */
export function sniffImage(buf: Buffer): SniffResult | null {
  if (startsWith(buf, PNG_SIGNATURE)) return { ext: '.png', type: 'image/png' }
  // JPEG: SOI, e o ultimo par de bytes e sempre EOI.
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { ext: '.jpg', type: 'image/jpeg' }
  // GIF87a / GIF89a
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return { ext: '.gif', type: 'image/gif' }
  // RIFF....WEBP
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { ext: '.webp', type: 'image/webp' }
  }
  return null
}

/**
 * Os unicos pedacos de um PNG que precisam sobreviver para ele continuar sendo
 * a mesma figura. Tudo o que nao esta aqui e metadado, e metadado nao entra.
 */
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'])

/**
 * Reescreve um PNG so com os pedacos essenciais.
 *
 * Tambem serve de validacao estrutural: um arquivo que comeca com a assinatura
 * de PNG mas nao caminha como PNG (tamanho de pedaco impossivel, sem IHDR, sem
 * IEND) nao chega ao fim daqui.
 *
 * @returns o PNG limpo, ou `null` se o arquivo nao for um PNG coerente.
 */
export function sanitizePng(buf: Buffer): Buffer | null {
  if (!startsWith(buf, PNG_SIGNATURE)) return null

  const keep: Buffer[] = [Buffer.from(PNG_SIGNATURE)]
  let offset = PNG_SIGNATURE.length
  let sawHeader = false
  let sawEnd = false

  while (offset + 12 <= buf.length) {
    const length = buf.readUInt32BE(offset)
    // 2^31-1 e o teto do formato; alem disso o arquivo esta mentindo.
    if (length > 0x7fffffff) return null

    const end = offset + 12 + length
    if (end > buf.length) return null

    const name = buf.toString('ascii', offset + 4, offset + 8)
    if (name === 'IHDR') sawHeader = true
    if (name === 'IEND') sawEnd = true

    if (PNG_KEEP.has(name)) keep.push(buf.subarray(offset, end))

    offset = end
    if (name === 'IEND') break
  }

  if (!sawHeader || !sawEnd) return null
  return Buffer.concat(keep)
}

/**
 * Valida os bytes recebidos e devolve o que deve ir para o disco.
 *
 * @returns `{ data, ext, type }`, ou uma `Error` com `status` para a rota
 *          devolver a mensagem pronta.
 */
export function prepareAvatar(buf: Buffer): { data: Buffer; ext: string; type: string } {
  if (buf.length === 0) {
    throw Object.assign(new Error('A imagem chegou vazia.'), { status: 400 })
  }
  if (buf.length > MAX_AVATAR_BYTES) {
    throw Object.assign(
      new Error(`A imagem passa de ${Math.round(MAX_AVATAR_BYTES / 1024)} kB.`),
      { status: 413 },
    )
  }

  const kind = sniffImage(buf)
  if (!kind) {
    throw Object.assign(new Error('Formato nao aceito. Use PNG, JPEG, WebP ou GIF.'), {
      status: 415,
    })
  }

  if (kind.ext === '.png') {
    const clean = sanitizePng(buf)
    if (!clean) {
      throw Object.assign(new Error('Esse PNG esta corrompido.'), { status: 400 })
    }
    return { data: clean, ext: kind.ext, type: kind.type }
  }

  return { data: buf, ext: kind.ext, type: kind.type }
}
