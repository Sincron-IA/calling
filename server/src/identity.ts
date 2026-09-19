import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AgentEntry } from './agents.js'

/**
 * Regras do canal de VOZ.
 *
 * O launcher do DG Claw (bootstrap-identity.sh) monta a identidade como
 * AGENT.md + "REGRA ZERO DO TELEGRAM". Aqui trocamos essa segunda parte: numa
 * chamada headless nao existe tool de reply do Telegram, e o CLAUDE.md do
 * workspace manda usa-la. Sem este override o agente tenta chamar uma tool que
 * nao existe e a resposta sai errada.
 */
const VOICE_CHANNEL_RULES = `
---

# === REGRA ZERO DO CANAL DE VOZ (substitui a regra do Telegram) ===

Voce NAO esta no Telegram agora. Voce esta numa LIGACAO DE VOZ pelo app Calling.

- NAO existe tool de reply do Telegram nesta sessao. Nao tente chama-la.
- O texto que voce devolver como resposta final e exatamente o que sera FALADO
  em voz alta para o dono. E o unico canal: o que nao estiver na resposta final
  nao chega nele.
- Responda em portugues do Brasil, em texto corrido, do jeito que uma pessoa
  fala. Sem markdown, sem bullet, sem titulo, sem emoji, sem bloco de codigo,
  sem tabela: tudo isso soa pessimo quando lido em voz alta.
- Seja CURTO. Duas ou tres frases na maioria das vezes. Isto e uma conversa
  falada, nao um relatorio. Se o assunto for longo, resuma e ofereca detalhar.
- Numeros, datas e siglas: escreva por extenso quando ajudar a locucao.
- Voce continua sendo voce: mesma personalidade, mesma memoria, mesmas regras.
  Pode ler e escrever seus arquivos de memoria normalmente
  (working-memory.md, MEMORY.md) — so nao descreva o que esta fazendo, apenas
  faca e responda em uma frase.
- Se precisar de tempo para uma tarefa longa, diga em uma frase que vai cuidar
  disso e siga. Nao deixe o dono esperando em silencio.
`

export interface IdentityResult {
  /** Caminho do arquivo passado em --append-system-prompt-file. */
  file: string
}

const cache = new Map<string, IdentityResult>()

/**
 * Monta o arquivo de system prompt de um agente para uso em voz:
 * o AGENT.md dele (leis, personalidade, identidade) + as regras do canal de voz.
 *
 * O arquivo e criado uma vez por processo e reaproveitado entre as chamadas.
 */
export function buildVoiceIdentity(agent: AgentEntry): IdentityResult {
  const cached = cache.get(agent.slug)
  if (cached && existsSync(cached.file)) return cached

  const agentMdPath = join(agent.workspace, 'AGENT.md')
  let identity = ''

  if (existsSync(agentMdPath)) {
    identity += readFileSync(agentMdPath, 'utf8')
  } else {
    console.warn(`[calling] ${agent.slug}: AGENT.md nao encontrado em ${agentMdPath}`)
    identity += `# ${agent.name}\n\nVoce e ${agent.name}, um agente da Sincron.\n`
  }

  identity += VOICE_CHANNEL_RULES

  const dir = mkdtempSync(join(tmpdir(), 'calling-identity-'))
  const file = join(dir, `${agent.slug}.txt`)
  writeFileSync(file, identity, { mode: 0o600 })

  const result: IdentityResult = { file }
  cache.set(agent.slug, result)
  return result
}
