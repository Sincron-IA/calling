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

export function AgentPanel({ agent, color, avatar, onClose, onSaved }: AgentPanelProps) {
  const [name, setName] = useState(agent.name)
  const [hex, setHex] = useState(color)
  /** `undefined` = nao mexeu na imagem; `''` = removeu; data URL = trocou. */
  const [nextAvatar, setNextAvatar] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
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
  }, [agent.slug, name, hex, colorOk, nextAvatar, onSaved, onClose])

  return (
    <div
      className="panel"
      role="dialog"
      aria-label={`Aparência de ${agent.name}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
      }}
    >
      <div className="panel__head">
        <span
          className={`disc${preview ? ' disc--photo' : ''}`}
          style={
            {
              '--disc-color': colorOk ? hex.trim() : color,
              '--disc-size': '30px',
            } as CSSProperties
          }
          aria-hidden="true"
        >
          {preview ? <img className="disc__img" src={preview} alt="" /> : name.trim().slice(0, 1).toUpperCase() || '?'}
        </span>
        <span className="panel__who">
          <span className="panel__title">{name.trim() || agent.name}</span>
          {/* O slug fica a vista para deixar claro que ele NAO muda: ligacao,
              toque e sessao de texto em curso continuam encontrando o agente. */}
          <span className="panel__slug">slug {agent.slug} · não muda</span>
        </span>
      </div>

      <label className="field">
        <span className="field__label">Nome de exibição</span>
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

      <div className="field">
        <span className="field__label">Imagem</span>
        <div className="drop">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {preview ? 'Trocar' : 'Escolher'}
          </button>
          {preview && (
            <button type="button" className="btn" disabled={busy} onClick={() => setNextAvatar('')}>
              Remover
            </button>
          )}
          <span className="drop__hint">
            PNG, JPEG, WebP ou GIF · até {Math.round(MAX_AVATAR_BYTES / 1024)} kB
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

      {error && <p className="panel__error">{error}</p>}

      <div className="panel__actions">
        <button type="button" className="btn" disabled={busy} onClick={onClose}>
          Cancelar
        </button>
        <button type="button" className="btn btn--go" disabled={busy} onClick={() => void save()}>
          {busy ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </div>
  )
}
