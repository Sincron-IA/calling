import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { AgentEntry } from './agents.js'

/**
 * A CARA DO AGENTE MORA COM O AGENTE.
 *
 * Nome de exibicao, cor e imagem ficam num arquivo dentro do workspace dele, e
 * nao no `agents.json`. Essa escolha e o que faz as duas direcoes funcionarem
 * com uma peca so:
 *
 *   - o agente muda a si mesmo escrevendo NESTE arquivo — ele ja tem permissao
 *     ali, entao nao precisa de rota, de token nem de API;
 *   - o app muda pelo bridge, que escreve NESTE MESMO arquivo.
 *
 * O `agents.json` continua sendo o REGISTRO — slug, workspace, enabled — e o
 * `slug` continua sendo a chave estavel: trocar o nome de exibicao nao quebra
 * ligacao, toque nem sessao de texto em curso.
 *
 * Arquivo faltando, quebrado ou com campo de tipo errado nao e erro: cai no
 * valor de partida do `agents.json` e segue. Um agente nunca some da lista por
 * causa da propria configuracao.
 */

/** O nome do arquivo, dentro do workspace do agente. */
export const IDENTITY_FILE = 'calling-identity.json'

/** Cor so entra como hex de 6 digitos: e o que a UI sabe pintar. */
const HEX = /^#[0-9a-fA-F]{6}$/

/** Teto do nome de exibicao — acima disso ele empurra o layout da lista. */
export const MAX_NAME_LENGTH = 40

/**
 * Formatos que o bridge aceita guardar e servir de volta. Nada que o navegador
 * possa EXECUTAR entra aqui: um SVG e um documento, nao uma figura.
 */
export const AVATAR_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

export interface AgentIdentity {
  /** Nome de exibicao. Sempre preenchido (cai no `agents.json`). */
  name: string
  /** Cor em hex, ou `undefined` se nem o arquivo nem o registro trouxeram uma. */
  color?: string
  /**
   * Quando a imagem mudou pela ultima vez (mtime em ms), ou `0` se nao ha
   * imagem. A UI usa isso para nao ficar com a figura velha em cache.
   */
  avatarVersion: number
}

/**
 * O nome do arquivo de imagem, tal como o arquivo de identidade declarou.
 *
 * So aceita um NOME, nunca um caminho: `/`, `\` e `..` estao fora. A imagem de
 * um agente vive dentro do workspace dele e em nenhum outro lugar — sem isso,
 * um arquivo de identidade (que o proprio agente escreve) poderia apontar para
 * qualquer coisa no disco da VPS.
 */
function safeAvatarName(value: unknown): string {
  if (typeof value !== 'string') return ''
  const name = value.trim()
  if (!name || name !== basename(name) || name.startsWith('.')) return ''
  if (!(extname(name).toLowerCase() in AVATAR_EXTENSIONS)) return ''
  return name
}

interface RawIdentity {
  name?: unknown
  color?: unknown
  avatar?: unknown
}

function readRaw(agent: AgentEntry): RawIdentity {
  const file = join(agent.workspace, IDENTITY_FILE)
  if (!existsSync(file)) return {}
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.warn(`[calling] ${agent.slug}: ${IDENTITY_FILE} nao e um objeto; ignorando.`)
      return {}
    }
    return parsed as RawIdentity
  } catch (err) {
    console.warn(
      `[calling] ${agent.slug}: ${IDENTITY_FILE} ilegivel (${(err as Error).message}); ignorando.`,
    )
    return {}
  }
}

/** O caminho da imagem do agente, ou `''` se ele nao tem uma valida. */
export function avatarPath(agent: AgentEntry): string {
  const name = safeAvatarName(readRaw(agent).avatar)
  if (!name) return ''
  const file = join(agent.workspace, name)
  return existsSync(file) ? file : ''
}

/**
 * A identidade efetiva de um agente: o arquivo dele por cima do `agents.json`.
 *
 * Lida na hora, sem cache: o agente pode reescrever o arquivo a qualquer
 * momento e a proxima pergunta tem que ver a mudanca. Sao seis arquivos
 * minusculos.
 */
export function agentIdentity(agent: AgentEntry): AgentIdentity {
  const raw = readRaw(agent)

  let name = agent.name
  if (typeof raw.name === 'string') {
    const candidate = raw.name.trim()
    if (candidate && candidate.length <= MAX_NAME_LENGTH) name = candidate
    else if (candidate) {
      console.warn(`[calling] ${agent.slug}: nome longo demais em ${IDENTITY_FILE}; ignorando.`)
    }
  }

  let color = agent.color
  if (typeof raw.color === 'string') {
    const candidate = raw.color.trim()
    if (HEX.test(candidate)) color = candidate
    else console.warn(`[calling] ${agent.slug}: cor invalida em ${IDENTITY_FILE}; ignorando.`)
  }

  let avatarVersion = 0
  const file = avatarPath(agent)
  if (file) {
    try {
      avatarVersion = Math.floor(statSync(file).mtimeMs)
    } catch {
      avatarVersion = 0
    }
  }

  return { name, color, avatarVersion }
}


/* ======================================================================== */
/*  ESCRITA                                                                 */
/*                                                                          */
/*  Daqui para baixo e a outra ponta da mesma coisa: o app editando o        */
/*  arquivo que o agente tambem edita. Uma gravacao so, nome + cor +         */
/*  imagem juntos — nunca metade da mudanca no disco.                        */
/* ======================================================================== */

/** O nome que a imagem tem dentro do workspace, qualquer que seja a extensao. */
const AVATAR_STEM = 'calling-avatar'

export interface IdentityPatch {
  name: string
  color: string
  /**
   * `Buffer` grava uma imagem nova, `null` apaga a que houver, `undefined`
   * deixa como esta.
   */
  avatar?: { data: Buffer; ext: string } | null
}

function tmpNeighbour(file: string): string {
  return `${file}.tmp-${process.pid}-${Date.now()}`
}

/** Escreve por vizinho + rename: ninguem le um arquivo pela metade. */
function writeAtomic(file: string, data: Buffer | string): void {
  const tmp = tmpNeighbour(file)
  try {
    writeFileSync(tmp, data, { mode: 0o644 })
    renameSync(tmp, file)
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
}

/** Apaga qualquer imagem do agente, em qualquer das extensoes aceitas. */
function clearAvatarFiles(agent: AgentEntry): void {
  for (const ext of Object.keys(AVATAR_EXTENSIONS)) {
    rmSync(join(agent.workspace, `${AVATAR_STEM}${ext}`), { force: true })
  }
}

/**
 * Grava a identidade do agente.
 *
 * A ORDEM importa: a imagem entra primeiro e o JSON depois. Se o JSON falhar,
 * o que ficou no disco e um arquivo que ninguem aponta — inofensivo. Se fosse
 * ao contrario, o JSON apontaria para uma imagem que nao existe.
 *
 * O `slug` nao esta aqui de proposito: ele e a chave estavel do agente e nao se
 * muda por esta porta.
 */
export function writeIdentity(agent: AgentEntry, patch: IdentityPatch): void {
  const name = patch.name.trim()
  if (!name) {
    throw Object.assign(new Error('O nome nao pode ficar vazio.'), { status: 400 })
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw Object.assign(
      new Error(`O nome passa de ${MAX_NAME_LENGTH} caracteres.`),
      { status: 400 },
    )
  }
  if (!HEX.test(patch.color.trim())) {
    throw Object.assign(new Error('A cor precisa ser um hex de 6 digitos, como #4ade80.'), {
      status: 400,
    })
  }

  // O que ja estava la manda no campo que nao veio nesta edicao.
  let avatarName = safeAvatarName(readRaw(agent).avatar)

  if (patch.avatar === null) {
    clearAvatarFiles(agent)
    avatarName = ''
  } else if (patch.avatar) {
    const { data, ext } = patch.avatar
    if (!(ext in AVATAR_EXTENSIONS)) {
      throw Object.assign(new Error('Formato de imagem nao aceito.'), { status: 415 })
    }
    // Trocar de formato nao pode deixar a figura antiga para tras.
    clearAvatarFiles(agent)
    avatarName = `${AVATAR_STEM}${ext}`
    writeAtomic(join(agent.workspace, avatarName), data)
  }

  writeAtomic(
    join(agent.workspace, IDENTITY_FILE),
    `${JSON.stringify({ name, color: patch.color.trim(), avatar: avatarName || undefined }, null, 2)}\n`,
  )
}
