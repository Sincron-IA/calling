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
import { ImageIcon, XIcon } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Item, ItemContent, ItemDescription, ItemMedia } from '@/components/ui/item'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
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
    reader.onerror = () => reject(new Error('Não consegui ler esse arquivo.'))
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

  /* Nada mudou -> nao ha o que salvar. Antes o botao ficava aceso sempre, e
     salvar sem mudanca escrevia no workspace do agente a toa. */
  const dirty =
    name.trim() !== agent.name || hex.trim().toLowerCase() !== color.toLowerCase() || nextAvatar !== undefined

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
      setError(err instanceof Error ? err.message : 'Não consegui ler esse arquivo.')
    }
  }, [])

  const save = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('O nome não pode ficar vazio.')
      return
    }
    if (!colorOk) {
      setError('A cor precisa ser um hex de 6 dígitos, como #4ade80.')
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
      setError(err instanceof Error ? err.message : 'Não consegui salvar.')
      setBusy(false)
    }
  }, [agent.slug, name, hex, colorOk, nextAvatar, onSaving, onSaved, onClose])

  const liveColor = colorOk ? hex.trim() : color
  const initial = name.trim().slice(0, 1).toUpperCase() || '?'

  return (
    <div
      data-surface=""
      className="bg-popover text-popover-foreground app-no-drag animate-in fade-in-0 slide-in-from-bottom-1 flex w-68 flex-col gap-3 rounded-xl border p-3 shadow-2xl duration-150 ease-out"
      role="dialog"
      aria-label={`Aparência de ${agent.name}`}
      style={{ '--agent': liveColor } as CSSProperties}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
      }}
    >
      <header className="flex items-center justify-between">
        <span className="text-muted-foreground font-mono text-[0.625rem] tracking-wider uppercase">
          Aparência · {agent.slug}
        </span>
        <Button variant="ghost" size="icon-xs" type="button" onClick={onClose} aria-label="Fechar">
          <XIcon />
        </Button>
      </header>

      {/* O topo inteiro aceita uma imagem arrastada — e o disco ja mostra o
          que vai ficar salvo, antes de salvar. */}
      <Item
        variant="muted"
        size="sm"
        className={cn(
          'border border-dashed transition-colors',
          dropping ? 'border-[var(--agent)] bg-[color-mix(in_oklch,var(--agent),transparent_88%)]' : 'border-border',
        )}
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
        <ItemMedia>
          <Avatar className="size-12 border-2" style={{ borderColor: liveColor }}>
            <AvatarImage src={preview || undefined} alt="" />
            <AvatarFallback
              className="font-medium"
              style={{ background: `color-mix(in oklch, ${liveColor}, transparent 80%)`, color: liveColor }}
            >
              {initial}
            </AvatarFallback>
          </Avatar>
        </ItemMedia>

        <ItemContent className="gap-1.5">
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="xs"
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <ImageIcon data-icon="inline-start" />
              {preview ? 'Trocar' : 'Imagem'}
            </Button>
            {preview && (
              <Button
                variant="ghost"
                size="xs"
                type="button"
                disabled={busy}
                onClick={() => setNextAvatar('')}
              >
                Remover
              </Button>
            )}
          </div>
          <ItemDescription className="text-xs">
            ou arraste aqui · até {Math.round(MAX_AVATAR_BYTES / 1024)} kB
          </ItemDescription>
        </ItemContent>

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
      </Item>

      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor="agent-name">Nome</FieldLabel>
          <Input
            id="agent-name"
            value={name}
            maxLength={40}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        {/* A paleta e o hex sao a MESMA decisao, mas nao o mesmo controle:
            antes o campo de texto morava dentro da fileira de cores, sem
            rotulo proprio. */}
        <Field data-invalid={!colorOk || undefined}>
          <FieldLabel htmlFor="agent-hex">Cor</FieldLabel>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            className="w-full justify-between border-0 bg-transparent p-0 shadow-none"
            value={SWATCHES.find((s) => s.toLowerCase() === hex.trim().toLowerCase()) ?? ''}
            onValueChange={(value) => value && setHex(value)}
            disabled={busy}
            aria-label="Cores de atalho"
          >
            {SWATCHES.map((swatch) => (
              <ToggleGroupItem
                key={swatch}
                value={swatch}
                aria-label={`Cor ${swatch}`}
                className="ring-offset-popover size-7 min-w-0 rounded-full border-0 p-0 data-[state=on]:ring-2 data-[state=on]:ring-offset-2"
                style={{ background: swatch, ['--tw-ring-color' as string]: swatch }}
              />
            ))}
          </ToggleGroup>
          {/* O hex fica embaixo, em linha propria: espremido ao lado da paleta
              ele nao cabia nem como campo nem como valor. */}
          <InputGroup>
            <InputGroupAddon>
              <span
                className="size-3.5 rounded-full border"
                style={{ background: liveColor }}
                aria-hidden="true"
              />
            </InputGroupAddon>
            <InputGroupInput
              id="agent-hex"
              value={hex}
              maxLength={7}
              disabled={busy}
              aria-invalid={!colorOk}
              spellCheck={false}
              className="font-mono text-xs"
              onChange={(event) => setHex(event.target.value)}
            />
          </InputGroup>
        </Field>
      </FieldGroup>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Separator />

      {/* O slug nao muda: ligacao, toque e sessao de texto continuam
          encontrando o agente mesmo com nome novo. Isto era um `<br/>` no meio
          da frase para caber ao lado dos botoes — agora tem a linha inteira. */}
      <FieldDescription>Grava no workspace do agente, em {agent.slug}.</FieldDescription>

      <div className="flex justify-end gap-1">
        <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={onClose}>
          Cancelar
        </Button>
        <Button size="sm" type="button" disabled={busy || !dirty} onClick={() => void save()}>
          {busy && <Spinner data-icon="inline-start" />}
          {busy ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </div>
  )
}
