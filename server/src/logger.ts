/**
 * Log do bridge — um JSON por linha (NDJSON), em arquivo, com rodizio.
 *
 * Por que isto existe: ate agora o unico rastro do bridge era o `journalctl`,
 * que mistura ruido do systemd com a saida do app e nao da para filtrar. Uma
 * ligacao morreu no CORS e nao havia como saber QUAL origem tinha sido
 * recusada, porque ninguem escrevia esse valor em lugar nenhum.
 *
 * Formato: NDJSON. Cada linha e um objeto com `event`, entao depois da para
 * achar as coisas com ferramenta comum, sem indexador nem stack de observabilidade:
 *
 *   grep '"event":"cors_rejected"' /var/log/calling-bridge/current.log | jq .
 *   jq -c 'select(.event=="ring_resolved")' /var/log/calling-bridge/*.log
 *
 * Onde mora: `/var/log/calling-bridge/` (mude com `CALLING_LOG_DIR`). E de
 * proposito FORA do worktree — o diretorio do agente em `.claude/worktrees/`
 * e descartavel, e o log precisa sobreviver a restart e a rebuild.
 *
 * Tamanho: limitado. 5 MB por arquivo, 5 arquivos no total (4 rodados + o
 * ativo) = 25 MB no teto. Nunca cresce para sempre.
 *
 * Segredo NUNCA entra aqui. Logamos metadado: origem, caminho, metodo, slug do
 * agente, desfecho, mensagem de erro. O `redact` abaixo e cinto de seguranca
 * para o caso de alguem passar um campo errado sem perceber.
 */

import pino from 'pino'

const LOG_DIR = process.env.CALLING_LOG_DIR || '/var/log/calling-bridge'
const LOG_FILE = `${LOG_DIR}/bridge.log`
const LOG_LEVEL = process.env.CALLING_LOG_LEVEL || 'info'

/** Tamanho maximo de um arquivo antes de rodar. */
const MAX_FILE_SIZE = process.env.CALLING_LOG_MAX_SIZE || '5m'
/** Quantos arquivos rodados guardar ALEM do ativo. 4 + 1 = 5 arquivos. */
const MAX_FILES = Number(process.env.CALLING_LOG_MAX_FILES || 4)

const baseFields = {
  service: 'calling-bridge',
}

const redactPaths = [
  'token',
  'secret',
  'apiKey',
  'authorization',
  'headers.authorization',
  'headers.cookie',
  'value',
]

function buildLogger(): pino.Logger {
  const options: pino.LoggerOptions = {
    level: LOG_LEVEL,
    base: baseFields,
    // ISO em vez do epoch em milissegundos: da para ler a linha crua sem
    // converter nada na hora do aperto.
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: redactPaths, censor: '[redacted]' },
    formatters: {
      // `"level":"warn"` em vez de `"level":40` — grep direto pelo nome.
      level: (label) => ({ level: label }),
    },
  }

  try {
    const transport = pino.transport({
      target: 'pino-roll',
      options: {
        file: LOG_FILE,
        size: MAX_FILE_SIZE,
        limit: { count: MAX_FILES, removeOtherLogFiles: true },
        mkdir: true,
        // `current.log` aponta sempre para o arquivo ativo: o caminho para
        // `tail -f` nao muda quando o arquivo roda.
        symlink: true,
      },
    })

    // Se o disco encher ou a permissao sumir, o bridge NAO pode cair junto:
    // o log e testemunha, nao e o servico.
    transport.on('error', (err: Error) => {
      console.error('[calling] log em arquivo falhou:', err.message)
    })

    return pino(options, transport)
  } catch (err) {
    console.error(
      `[calling] nao consegui abrir o log em ${LOG_FILE} (${(err as Error).message}) — seguindo so com stdout.`,
    )
    return pino(options, pino.destination(1))
  }
}

const logger = buildLogger()

export type LogLevel = 'info' | 'warn' | 'error'

/**
 * Registra um evento nos DOIS lugares que importam:
 *
 *  - no arquivo NDJSON, estruturado, para buscar depois;
 *  - no stdout/stderr em linguagem de gente, que e o que aparece no
 *    `journalctl -u calling-bridge -f` quando alguem esta olhando ao vivo.
 *
 * `human` e opcional: evento de alto volume (cada request HTTP) so vai para o
 * arquivo, para nao poluir o journal.
 */
export function logEvent(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
  human?: string,
): void {
  logger[level]({ event, ...fields }, human ?? event)

  if (!human) return
  const line = `[calling] ${human}`
  if (level === 'info') console.log(line)
  else console.error(line)
}

/** Onde o log esta sendo escrito — o bridge anuncia isso ao subir. */
export const logDestination = LOG_FILE

export default logger
