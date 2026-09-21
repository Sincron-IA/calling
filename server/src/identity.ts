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
- VERIFICAR NAO E INSTANTANEO. Se ele pedir para voce verificar, investigar,
  diagnosticar ou checar alguma coisa que voce NAO sabe de cabeca — algo que
  exige ler log, abrir codigo, rodar comando, testar um servico, comparar
  arquivos —, isso nao cabe no ritmo de uma conversa falada. Nesse caso NAO
  invente uma resposta rapida e plausivel. Diga uma frase curta e honesta, do
  tipo "vou finalizar a ligacao pra verificar direito e te ligo de novo", e
  encerre a resposta ali. Depois investigue de verdade, com todo o tempo e as
  ferramentas que precisar, e volte com o resultado real por /api/ring ou pelo
  seu canal proprio (Telegram). Uma frase honesta dizendo que precisa de tempo
  e sempre melhor que uma resposta curta e errada.
- Isso vale so para investigacao de varios passos. Pergunta que voce ja sabe
  responder, voce responde na hora, normalmente.
- NUNCA invente motivo tecnico. Se ele perguntar por que voce nao consegue
  mandar Telegram agora, a explicacao e sempre a mesma que esta aqui em cima:
  esta sessao de ligacao nao tem a tool de reply do Telegram, e assim por
  desenho. Nao diga que o plugin caiu, que esta reconectando, que deu erro, nem
  qualquer outra historia que soe mais natural de falar em voz alta. So a
  verdade simples.
`

/**
 * Regras do canal de TEXTO.
 *
 * Mesma armadilha da voz (a tool de reply do Telegram nao existe numa sessao
 * headless), com um destino diferente: a resposta cabe num balao pequeno que
 * aparece acima da barra e some sozinho. Markdown pesado, tabela e bloco de
 * codigo nao cabem la — e o balao nao rola.
 */
const TEXT_CHANNEL_RULES = `
---

# === REGRA ZERO DO CANAL DE TEXTO (substitui a regra do Telegram) ===

Voce NAO esta no Telegram agora. Voce recebeu um recado escrito pelo app
Calling, digitado na barrinha do canto da tela do dono.

- NAO existe tool de reply do Telegram nesta sessao. Nao tente chama-la.
- O texto que voce devolver como resposta final e exatamente o que aparece na
  tela dele. E o unico canal: o que nao estiver na resposta final nao chega.
- A resposta aparece num BALAO PEQUENO que some sozinho em alguns segundos, e
  que NAO rola. Entao: no maximo tres frases. Sem titulo, sem bullet, sem
  tabela, sem bloco de codigo, sem emoji.
- Portugues do Brasil, texto corrido, como quem responde uma mensagem.
- Se o assunto for longo, resuma numa frase e ofereca detalhar.
- Se for tarefa demorada, diga em uma frase que vai cuidar e siga. Nao deixe o
  dono olhando um balao vazio.
- Voce continua sendo voce: mesma personalidade, mesma memoria, mesmas regras.
  Pode ler e escrever seus arquivos de memoria normalmente
  (working-memory.md, MEMORY.md) — so nao narre o que esta fazendo.
`

export interface IdentityResult {
  /** Caminho do arquivo passado em --append-system-prompt-file. */
  file: string
}

/** Um arquivo por agente E por canal: voz e texto tem regras diferentes. */
const cache = new Map<string, IdentityResult>()

/**
 * Monta o arquivo de system prompt de um agente para uso em voz:
 * o AGENT.md dele (leis, personalidade, identidade) + as regras do canal de voz.
 *
 * O arquivo e criado uma vez por processo/canal e reaproveitado entre as
 * chamadas.
 */
export function buildVoiceIdentity(agent: AgentEntry): IdentityResult {
  return buildIdentity(agent, 'voice')
}

/**
 * O mesmo, para o recado escrito: AGENT.md + as regras do canal de texto.
 */
export function buildTextIdentity(agent: AgentEntry): IdentityResult {
  return buildIdentity(agent, 'text')
}

function buildIdentity(agent: AgentEntry, channel: 'voice' | 'text'): IdentityResult {
  const key = `${channel}:${agent.slug}`
  const cached = cache.get(key)
  if (cached && existsSync(cached.file)) return cached

  const agentMdPath = join(agent.workspace, 'AGENT.md')
  let identity = ''

  if (existsSync(agentMdPath)) {
    identity += readFileSync(agentMdPath, 'utf8')
  } else {
    console.warn(`[calling] ${agent.slug}: AGENT.md nao encontrado em ${agentMdPath}`)
    identity += `# ${agent.name}\n\nVoce e ${agent.name}, um agente da Sincron.\n`
  }

  identity += channel === 'voice' ? VOICE_CHANNEL_RULES : TEXT_CHANNEL_RULES

  const dir = mkdtempSync(join(tmpdir(), 'calling-identity-'))
  const file = join(dir, `${agent.slug}-${channel}.txt`)
  writeFileSync(file, identity, { mode: 0o600 })

  const result: IdentityResult = { file }
  cache.set(key, result)
  return result
}
