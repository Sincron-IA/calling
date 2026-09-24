/**
 * Qual camada de VOZ a proxima ligacao usa.
 *
 * Nas duas o cerebro e o mesmo — o agente DG Claw real, pelo `askAgent()` do
 * bridge. Muda so quem cuida de ouvir e falar. O padrao e SEMPRE a Gemini: quem
 * nunca mexer no seletor liga exatamente como antes.
 */

import { createCallAdapter, type CallHooks } from './gemini'
import { createOpenAICallAdapter } from './openai-live'

export type VoiceProvider = 'gemini' | 'openai-live'

export const DEFAULT_VOICE_PROVIDER: VoiceProvider = 'gemini'

export const VOICE_PROVIDER_LABEL: Record<VoiceProvider, string> = {
  gemini: 'Gemini',
  'openai-live': 'GPT-Live',
}

const STORAGE_KEY = 'calling.voiceProvider'

export function isVoiceProvider(value: unknown): value is VoiceProvider {
  return value === 'gemini' || value === 'openai-live'
}

export function readVoiceProvider(): VoiceProvider {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return isVoiceProvider(raw) ? raw : DEFAULT_VOICE_PROVIDER
  } catch {
    // Storage bloqueado (aba anonima etc.): fica no padrao.
    return DEFAULT_VOICE_PROVIDER
  }
}

export function saveVoiceProvider(provider: VoiceProvider): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, provider)
  } catch {
    // Sem storage a escolha vale so ate fechar o app — nao e erro.
  }
}

/** O que o `App` precisa de qualquer adapter de voz: ligar e desligar. */
export interface CallAdapter {
  start(): Promise<void>
  stop(): Promise<void>
}

export function createVoiceAdapter(
  provider: VoiceProvider,
  agentSlug: string,
  callId: string,
  hooks: CallHooks = {},
): CallAdapter {
  return provider === 'openai-live'
    ? createOpenAICallAdapter(agentSlug, callId, hooks)
    : createCallAdapter(agentSlug, callId, hooks)
}
