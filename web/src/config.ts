/**
 * Onde o app descobre PARA ONDE ligar e COM QUAL chave.
 *
 * Dois mundos convivem aqui, e e de proposito:
 *
 *  - No navegador (o jeito de sempre, que o Codex esta testando agora), os
 *    valores vem das variaveis do Vite: `VITE_BRIDGE_URL` e
 *    `VITE_CALLING_SHARED_SECRET`, lidas do `.env`. Nada muda.
 *
 *  - Dentro do Electron, o app tem uma tela de conexao: o Luiz digita o
 *    endereco e a chave uma vez, e o processo principal guarda (a chave
 *    cifrada). Esses valores entram aqui em tempo de execucao.
 *
 * Por isso o resto do codigo pergunta por FUNCAO (`bridgeUrl()`), nunca por
 * constante: a constante congelaria o valor do `.env` no momento do import,
 * antes da tela de conexao existir.
 */

export interface CallingConfig {
  bridgeUrl: string
  sharedSecret: string
}

/** Tira a barra final: todo o codigo monta caminho com `${base}/api/...`. */
export function normalizeBridgeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/** O que o `.env` mandou — o padrao do navegador, e o fallback de tudo. */
const fromEnv: CallingConfig = {
  bridgeUrl: normalizeBridgeUrl(import.meta.env.VITE_BRIDGE_URL || 'http://localhost:8787'),
  sharedSecret: import.meta.env.VITE_CALLING_SHARED_SECRET || '',
}

let current: CallingConfig = { ...fromEnv }

/** Endereco do bridge em uso agora. */
export function bridgeUrl(): string {
  return current.bridgeUrl
}

/** Chave do app em uso agora. Nunca logue isto. */
export function sharedSecret(): string {
  return current.sharedSecret
}

/** Troca a configuracao viva (caminho do Electron). */
export function setConfig(next: CallingConfig): void {
  current = {
    bridgeUrl: normalizeBridgeUrl(next.bridgeUrl),
    sharedSecret: next.sharedSecret,
  }
}

/** Volta ao que veio do `.env` (usado quando a config salva e apagada). */
export function resetConfig(): void {
  current = { ...fromEnv }
}

/** Sugestao inicial da tela de conexao quando nao ha nada salvo. */
export const DEFAULT_BRIDGE_URL =
  fromEnv.bridgeUrl && fromEnv.bridgeUrl !== 'http://localhost:8787'
    ? fromEnv.bridgeUrl
    : 'https://calling-bridge.sincronia.digital'
