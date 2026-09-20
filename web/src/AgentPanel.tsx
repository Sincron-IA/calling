/**
 * A cara do agente, editavel daqui.
 *
 * O painel escreve no MESMO arquivo que o agente escreve quando muda a si
 * mesmo (`calling-identity.json`, no workspace dele). Nao ha "a versao do app"
 * e "a versao da VPS": ha um arquivo, e duas pessoas que mexem nele.
 *
 * Nome, cor e imagem vao juntos numa gravacao so — salvar nao pode deixar o
 * nome novo com a cor velha.
 */

import { useCallback, useRef, useState, type CSSProperties } from 'react'
import { saveIdentity, MAX_AVATAR_BYTES, type AgentSummary } from './bridge'

/** Paleta de atalho. O hex continua aberto para quem quiser outra cor. */
const SWATCHES = ['#4ade80', '#60a5fa', '#c084fc', '#fbbf24', '#f472b6', '#2dd4bf']

const HEX = /^#[0-9a-fA-F]{6}$/

/** O mesmo teto do bridge: melhor recusar aqui do que depois de subir. */
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

export interface AgentPanelProps {
  agent: AgentSummary
  /** Cor em vigor (ja resolvida pela paleta de partida, se for o caso). */
  color: string
  /** Imagem em vigor, se houver. */
  avatar: string
  onClose: () => void
  /** A gravacao comecou (antes de o bridge responder). */
  onSaving?: () => void
  /** A lista nova que o bridge devolveu depois de gravar. */
  onSaved: (agents: AgentSummary[]) => void
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Nao consegui ler esse arquivo.'))
    reader.readAsDataURL(file)
  })
}

export function AgentPanel({ agent, color, avatar, onClose, onSaving, onSaved }: AgentPanelProps) {
  const [name, setName] = useState(agent.name)
  const [hex, setHex] = useState(color)
  /** `undefined` = nao mexeu na imagem; `''` = removeu; data URL = trocou. */
  const [nextAvatar, setNextAvatar] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Tem um arquivo sendo arrastado por cima do topo do painel.
  const [dropping, setDropping] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // O que o disco mostra AGORA, que e o que vai ficar salvo.
  const preview = nextAvatar === undefined ? avatar : nextAvatar
  const colorOk = HEX.test(hex.trim())

  const pickFile = useCallback(async (file: File | null) => {
    if (!file) return
    setError('')
    if (file.size > MAX_AVATAR_BYTES) {
      setError(`A imagem passa de ${Math.round(MAX_AVATAR_BYTES / 1024)} kB.`)
      return
    }
    try {
      setNextAvatar(await readAsDataUrl(file))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao consegui ler esse arquivo.')
    }
  }, [])

  const save = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('O nome nao pode ficar vazio.')
      return
    }
    if (!colorOk) {
      setError('A cor precisa ser um hex de 6 digitos, como #4ade80.')
      return
    }

    setBusy(true)
    setError('')
    onSaving?.()
    try {
      const agents = await saveIdentity(agent.slug, {
        name: trimmed,
        color: hex.trim(),
        // `undefined` nao vai no corpo: o bridge mantem a imagem que ja existe.
        avatar: nextAvatar === undefined ? undefined : nextAvatar || null,
      })
      onSaved(agents)
      onClose()
    } catch (err) {
      // Nada se perde: o painel continua aberto com tudo o que foi digitado.
      setError(err instanceof Error ? err.message : 'Nao consegui salvar.')
      setBusy(false)
    }
  }, [agent.slug, name, hex, colorOk, nextAvatar, onSaving, onSaved, onClose])

  const liveColor = colorOk ? hex.trim() : color

  return (
    <div
      className="panel"
      role="dialog"
      aria-label={`Aparência de ${agent.name}`}
      style={{ '--panel-color': liveColor } as CSSProperties}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
      }}
    >
      <div className="panel__top">
        <span className="eyebrow">Aparência · {agent.slug}</span>
        <button type="button" className="panel__close" onClick={onClose} aria-label="Fechar">
          <svg
            viewBox="0 0 24 24"
            width="13"
            height="13"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      {/* O topo inteiro aceita uma imagem arrastada — e o disco ja mostra o
          que vai ficar salvo, antes de salvar. */}
      <div
        className={`panel__head${dropping ? ' is-drop' : ''}`}
        onDragOver={(event) => {
          if (busy) return
          event.preventDefault()
          setDropping(true)
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDropping(false)
          if (!busy) void pickFile(event.dataTransfer.files?.[0] ?? null)
        }}
      >
        <span
          className={`disc${preview ? ' disc--photo' : ''}`}
          style={
            {
              '--disc-color': liveColor,
              '--disc-size': '64px',
              borderWidth: '2px',
            } as CSSProperties
          }
          aria-hidden="true"
        >
          {preview ? <img className="disc__img" src={preview} alt="" /> : name.trim().slice(0, 1).toUpperCase() || '?'}
        </span>
        <div className="panel__pick">
          <div className="panel__pick-row">
            <button
              type="button"
              className="panel__ghost"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <svg
                viewBox="0 0 24 24"
                width="13"
                height="13"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <circle cx="9" cy="9" r="2" />
                <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
              </svg>
              {preview ? 'Trocar' : 'Imagem'}
            </button>
            {preview && (
              <button
                type="button"
                className="panel__ghost panel__ghost--quiet"
                disabled={busy}
                onClick={() => setNextAvatar('')}
              >
                Remover
              </button>
            )}
          </div>
          <span className="panel__hint">
            ou arraste aqui · até {Math.round(MAX_AVATAR_BYTES / 1024)} kB
          </span>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            hidden
            onChange={(event) => {
              void pickFile(event.target.files?.[0] ?? null)
              // Escolher o MESMO arquivo de novo tem que disparar de novo.
              event.target.value = ''
            }}
          />
        </div>
      </div>

      <label className="field">
        <span className="field__label">Nome</span>
        <input
          className="field__input"
          value={name}
          maxLength={40}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      <div className="field">
        <span className="field__label">Cor</span>
        <div className="swatches">
          {SWATCHES.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className={`swatch${swatch.toLowerCase() === hex.trim().toLowerCase() ? ' is-on' : ''}`}
              style={{ background: swatch, color: swatch }}
              disabled={busy}
              onClick={() => setHex(swatch)}
              aria-label={`Cor ${swatch}`}
              aria-pressed={swatch.toLowerCase() === hex.trim().toLowerCase()}
            />
          ))}
          <input
            className="field__input field__input--hex"
            value={hex}
            maxLength={7}
            disabled={busy}
            aria-label="Cor em hex"
            aria-invalid={!colorOk}
            onChange={(event) => setHex(event.target.value)}
          />
        </div>
      </div>

      {error && <p className="panel__error">{error}</p>}

      <div className="panel__rule" aria-hidden="true" />

      <div className="panel__foot">
        {/* O slug nao muda: ligacao, toque e sessao de texto continuam
            encontrando o agente mesmo com nome novo. */}
        <span className="panel__where">
          grava no
          <br />
          workspace
        </span>
        <div className="panel__pick-row">
          <button
            type="button"
            className="panel__ghost panel__ghost--quiet"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button type="button" className="panel__save" disabled={busy} onClick={() => void save()}>
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
