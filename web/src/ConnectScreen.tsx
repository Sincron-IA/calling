/**
 * A tela da PRIMEIRA VEZ — e o painel da engrenagem, que e a mesma tela depois
 * que tudo ja esta de pe.
 *
 * Dois estados, e eles sao opostos:
 *
 *   sem conexao  -> um formulario: endereco, chave, e UM botao ("Conectar ao
 *                   Cloudflare"), que abre o login de verdade dentro do app.
 *   ja conectado -> nenhum formulario e nenhum botao de conectar. So o que
 *                   esta guardado (visivel, copiavel, a chave revelavel) e as
 *                   saidas, em ordem de peso.
 *
 * O botao "Conectar" existir com o selo "conectado" ao lado era a contradicao
 * que este arquivo passou a nao ter: conectado, refazer o login e uma acao
 * SECUNDARIA, e se chama "Refazer login" — nao "conectar".
 *
 * Esta tela so aparece dentro do app de desktop. No navegador o app continua
 * lendo o `.env`, como sempre.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  ShieldCheckIcon,
  PencilIcon,
  PlugZapIcon,
  RefreshCwIcon,
  ServerIcon,
  UnplugIcon,
} from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ButtonGroup } from '@/components/ui/button-group'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { isDesktopMainWindow } from './desktop'

/** Em que passo do caminho estamos (os quadros 1, 2 e 3 do desenho). */
export type ConnectPhase = 'form' | 'login' | 'validating'

export interface ConnectScreenProps {
  defaultBridgeUrl: string
  defaultSecret: string
  phase: ConnectPhase
  /** Erro em vermelho, com o formulario ainda ali para corrigir e tentar de novo. */
  error?: string
  /** Aviso calmo (ex.: a sessao do Cloudflare expirou). */
  notice?: string
  /** A maquina nao tem cofre: a chave nao sobrevive ao fechar do app. */
  secretPersisted?: boolean
  onConnect(bridgeUrl: string, sharedSecret: string): void
  /** So existe quando a tela foi aberta pela engrenagem, com o app ja ligado. */
  onCancel?: () => void
  /** Texto do botao de voltar (no painel ele fecha em vez de voltar). */
  cancelLabel?: string
  /** Dentro do painel da engrenagem: sem tela cheia, do tamanho de um menu. */
  compact?: boolean
  /** Uma palavra no canto do cabecalho: "conectado", "sem chave"… */
  statusLabel?: string
  /**
   * Ja esta tudo conectado — entao NAO ha formulario.
   *
   * Quem decide e quem chama: so o painel, e so quando a conferencia com o
   * bridge passou. Sessao vencida ou sem chave continuam vendo o formulario,
   * que e o que resolve o problema deles.
   */
  connected?: boolean
  /** Esquecer endereco, chave e a sessao do Cloudflare (so o painel oferece). */
  onForget?: () => void
  /** Linha de acoes no pe do cartao (so o painel usa). */
  footer?: ReactNode
  /**
   * O que o app lembra: "sempre no topo" e o que vier depois.
   *
   * So aparece com a conexao de pe — com ela quebrada, nao ha o que preferir
   * antes de resolver aquilo.
   */
  preferences?: ReactNode
}

/** So o hostname, para a linha recolhida nao virar um paragrafo. */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/* ------------------------------------------------------------------ peças -- */

/**
 * A casca.
 *
 * Tres situacoes, nao duas:
 *
 *   painel da engrenagem  -> o cartao E a janela (sem tela em volta).
 *   janela da barra       -> a janela e transparente e maior que o cartao,
 *                            entao aqui tambem nao pode haver tela em volta:
 *                            um `min-h-svh` pintaria a janela inteira.
 *   navegador             -> aí sim, tela cheia com o cartao no meio.
 */
function Shell({
  compact,
  children,
  ...rest
}: {
  compact: boolean
  children: ReactNode
} & React.ComponentProps<'form'>) {
  const boxed = compact || isDesktopMainWindow
  // Na janela da barra o cartao faz o papel do chip: e o que segura o clique
  // (a parte transparente em volta deixa passar) e o que fica parado na tela.
  const inMain = isDesktopMainWindow && !compact

  return (
    <TooltipProvider delayDuration={200}>
      <div
        data-surface={inMain ? '' : undefined}
        data-anchor={inMain ? '' : undefined}
        className={cn(
          'flex flex-col',
          boxed
            ? 'bg-card text-card-foreground app-no-drag rounded-xl border p-4 shadow-2xl'
            : 'bg-background min-h-svh items-center justify-center p-6',
          // No painel a largura vem da JANELA; na janela da barra ela vem
          // daqui, porque la a janela e maior que o cartao.
          boxed && (compact ? 'w-full' : 'w-86'),
        )}
      >
        <form
          {...rest}
          className={cn('flex w-full flex-col gap-4', !boxed && 'bg-card max-w-sm rounded-xl border p-5 shadow-2xl')}
        >
          {children}
        </form>
      </div>
    </TooltipProvider>
  )
}

/** "Calling" + como esta a conexao, num olhar. */
function Head({ status, compact }: { status?: string; compact: boolean }) {
  const ok = status === 'conectado'
  return (
    <header
      className={cn('flex items-center gap-2', compact && 'app-drag')}
      // Sem moldura de sistema, o cabecalho e a unica alca para arrastar. No
      // painel quem arrasta e o sistema (`app-drag`); na janela da barra, o
      // proprio app (`DesktopGate`).
      data-slot="panel-head"
      data-drag-handle={isDesktopMainWindow && !compact ? '' : undefined}
    >
      <span
        className={cn('size-1.5 rounded-full', ok ? 'bg-ok' : 'bg-muted-foreground')}
        aria-hidden="true"
      />
      <h1 className="text-sm font-semibold tracking-tight">Calling</h1>
      {status && (
        <Badge variant={ok ? 'outline' : 'secondary'} className="ml-auto font-mono text-[0.625rem] tracking-wider uppercase">
          {status}
        </Badge>
      )}
    </header>
  )
}

/** Um valor guardado: rotulo, o valor, e o que se pode fazer com ele. */
function SavedRow({
  icon: Icon,
  label,
  value,
  mono = false,
  children,
}: {
  icon: typeof ServerIcon
  label: string
  value: ReactNode
  mono?: boolean
  children?: ReactNode
}) {
  return (
    <Item size="sm" className="px-0">
      <ItemMedia variant="icon">
        <Icon />
      </ItemMedia>
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="text-muted-foreground font-mono text-[0.625rem] font-normal tracking-wider uppercase">
          {label}
        </ItemTitle>
        <ItemDescription className={cn('text-foreground truncate', mono && 'font-mono')}>
          {value}
        </ItemDescription>
      </ItemContent>
      {children}
    </Item>
  )
}

/** Um botao que confirma sozinho, sem virar estado do pai. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!done) return
    const id = window.setTimeout(() => setDone(false), 1400)
    return () => window.clearTimeout(id)
  }, [done])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          type="button"
          aria-label={label}
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(
              () => setDone(true),
              () => undefined,
            )
          }}
        >
          {done ? <CheckIcon className="text-ok" /> : <CopyIcon />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{done ? 'Copiado' : label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * O que esta guardado, a vista.
 *
 * Antes isto eram duas copias literais do mesmo bloco (uma no ramo "conectado"
 * e outra no ramo "trancado"), e a chave so existia como bolinhas — sem jeito
 * de conferir nem de copiar. Conferir e justamente o que quem abre a
 * engrenagem quer fazer na maior parte das vezes.
 */
function SavedConnection({
  url,
  secret,
  secretPersisted,
  onEdit,
  disabled,
}: {
  url: string
  secret: string
  secretPersisted: boolean
  onEdit: () => void
  disabled: boolean
}) {
  return (
    <ItemGroup className="border-border/60 bg-muted/30 rounded-lg border px-3">
      <SavedRow
        icon={ServerIcon}
        label="Endereço do bridge"
        value={
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block truncate text-left">{url}</span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs break-all">{url}</TooltipContent>
          </Tooltip>
        }
        mono
      >
        <CopyButton value={url} label="Copiar o endereço" />
      </SavedRow>

      <Separator />

      {/*
        A CHAVE NAO APARECE, E NAO SE COPIA.
        Ela vive cifrada no cofre do sistema (DPAPI no Windows, Keychain no
        macOS, libsecret no Linux) — mostrar ou copiar na tela desfaz o unico
        motivo de ela estar la. O que fica e a confirmacao de que existe uma, e
        onde ela esta guardada. Trocar a chave e pelo `Editar`, que pede uma
        nova em vez de devolver a antiga.
      */}
      <SavedRow
        icon={KeyRoundIcon}
        label="Chave do app"
        value={
          secretPersisted && secret ? (
            <span className="flex items-center gap-1.5">
              <span className="font-mono">••••••••••••</span>
              <ShieldCheckIcon className="text-ok size-3" aria-hidden="true" />
              <span className="text-muted-foreground font-sans text-[0.6875rem]">
                no cofre do sistema
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground font-sans italic">
              não fica guardada nesta máquina
            </span>
          )
        }
      />

      <Separator />

      <div className="flex justify-end py-1.5">
        <Button variant="ghost" size="xs" type="button" onClick={onEdit} disabled={disabled}>
          <PencilIcon data-icon="inline-start" />
          Editar
        </Button>
      </div>
    </ItemGroup>
  )
}

/* ------------------------------------------------------------------ telas -- */

/** O quadro 3 do desenho: uma linha e um girinho, nada mais. */
export function ConnectingCard({
  label = 'Conectando…',
  compact = false,
}: {
  label?: string
  compact?: boolean
}) {
  return (
    <div
      // Na janela da barra este cartao e tudo o que existe: segura o clique,
      // fica parado no canto e arrasta a janela.
      data-surface=""
      data-anchor=""
      data-drag-handle=""
      className={cn(
        'flex',
        compact
          ? 'bg-card text-card-foreground items-center gap-2.5 rounded-xl border px-4 py-5'
          : 'bg-background min-h-svh items-center justify-center p-6',
      )}
      role="status"
      aria-live="polite"
    >
      {compact ? (
        <>
          <Spinner className="text-muted-foreground" />
          <span className="text-muted-foreground text-sm">{label}</span>
        </>
      ) : (
        <div className="bg-card flex w-full max-w-sm items-center gap-2.5 rounded-xl border p-5 shadow-2xl">
          <Spinner className="text-muted-foreground" />
          <span className="text-muted-foreground text-sm">{label}</span>
        </div>
      )}
    </div>
  )
}

export function ConnectScreen({
  defaultBridgeUrl,
  defaultSecret,
  phase,
  error,
  notice,
  secretPersisted = true,
  onConnect,
  onCancel,
  cancelLabel = 'Voltar',
  compact = false,
  statusLabel,
  connected = false,
  onForget,
  footer,
  preferences,
}: ConnectScreenProps) {
  const [url, setUrl] = useState(defaultBridgeUrl)
  /* O campo da chave nasce VAZIO, mesmo com uma chave guardada: a antiga nunca
     volta para a tela. Em branco = mantem a que esta no cofre. */
  const [secret, setSecret] = useState('')
  const [showSecret, setShowSecret] = useState(false)

  /**
   * Endereco e chave JA salvos ficam trancados.
   *
   * Quem volta aqui quase sempre quer so refazer o login do Cloudflare — e um
   * campo aberto com a chave dentro e um jeito facil de estragar o que estava
   * funcionando (um clique, um Ctrl+A, um caractere a mais). Editar e uma
   * decisao explicita.
   */
  const [editing, setEditing] = useState(false)
  // A conexao comeca recolhida: com tudo de pe, ela nao e o assunto.
  const [showConnection, setShowConnection] = useState(false)
  const saved = defaultBridgeUrl.trim() !== '' && defaultSecret.trim() !== ''
  const locked = !editing && saved

  /**
   * O clique JA conta como "estou indo".
   *
   * Quem sabe que a janela do Cloudflare abriu e o pai (`phase`), e isso demora
   * o tempo de uma ida ao processo principal. Este estado local cobre esse vao.
   */
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (phase !== 'login') setSubmitting(false)
  }, [phase, error])

  // Enquanto validamos, a tela inteira vira o quadro 3 — nada para mexer.
  if (phase === 'validating') return <ConnectingCard compact={compact} />

  const waiting = phase === 'login'
  const busy = waiting || submitting
  /* Com uma chave ja guardada, o campo em branco vale: e o "deixa como esta".
     Sem nada guardado (primeira vez), ela e obrigatoria. */
  const ready = url.trim().length > 0 && (secret.trim().length > 0 || saved)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready || busy) return
    setSubmitting(true)
    onConnect(url.trim(), secret || defaultSecret)
  }

  const connectLabel = busy ? (waiting ? 'Esperando o login…' : 'Abrindo…') : 'Conectar ao Cloudflare'

  return (
    <Shell compact={compact} onSubmit={submit}>
      <Head status={statusLabel} compact={compact} />

      {connected && !editing ? (
        /* JA ESTA TUDO DE PE.

           E entao a conexao nao e mais o assunto: ela vira UMA LINHA que diz
           que esta tudo certo e com que endereco. Quem abriu a engrenagem com
           o app funcionando quase nunca veio mexer nela — veio ver ou mudar o
           resto. O endereco, a chave e as saidas continuam a um clique, dentro
           dessa linha. */
        <>
          <Collapsible open={showConnection} onOpenChange={setShowConnection}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="h-auto w-full justify-between gap-2 px-2 py-2"
                type="button"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <PlugZapIcon className="text-ok" />
                  <span className="flex min-w-0 flex-col items-start gap-0.5">
                    <span className="text-sm font-medium">Conexão</span>
                    <span className="text-muted-foreground max-w-44 truncate font-mono text-[0.6875rem]">
                      {hostOf(url)}
                    </span>
                  </span>
                </span>
                <ChevronDownIcon
                  className={cn('transition-transform', showConnection && 'rotate-180')}
                />
              </Button>
            </CollapsibleTrigger>

            <CollapsibleContent className="flex flex-col gap-3 pt-2">
              <SavedConnection
                url={url}
                secret={defaultSecret}
                secretPersisted={secretPersisted}
                onEdit={() => setEditing(true)}
                disabled={busy}
              />

              <ButtonGroup className="w-full [&>*]:flex-1">
                <Button variant="outline" size="sm" type="submit" disabled={busy}>
                  {busy ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <RefreshCwIcon data-icon="inline-start" />
                  )}
                  {busy ? connectLabel : 'Refazer login'}
                </Button>
                {onForget && (
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={onForget}
                    disabled={busy}
                  >
                    <UnplugIcon data-icon="inline-start" />
                    Desconectar
                  </Button>
                )}
              </ButtonGroup>
            </CollapsibleContent>
          </Collapsible>

          {preferences && (
            <>
              <Separator />
              {preferences}
            </>
          )}
        </>
      ) : locked ? (
        /* Guardado, mas a sessao caiu (ou e a chave que esta errada). O que
           falta e UMA coisa: refazer o login. Ela e a acao principal. */
        <>
          <SavedConnection
            url={url}
            secret={defaultSecret}
            secretPersisted={secretPersisted}
            onEdit={() => setEditing(true)}
            disabled={busy}
          />

          <Button type="submit" disabled={!ready || busy} aria-busy={busy || undefined}>
            {busy && <Spinner data-icon="inline-start" />}
            {connectLabel}
          </Button>
        </>
      ) : (
        <>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="bridge-url">Endereço do bridge</FieldLabel>
              <Input
                id="bridge-url"
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-xs"
                placeholder="https://calling-bridge.sincronia.digital"
                value={url}
                disabled={busy}
                onChange={(e) => setUrl(e.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="app-secret">Chave do app</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="app-secret"
                  type={showSecret ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-xs"
                  placeholder={saved ? 'Manter a chave atual' : '••••••••••••••••'}
                  value={secret}
                  disabled={busy}
                  onChange={(e) => setSecret(e.target.value)}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    type="button"
                    size="icon-xs"
                    aria-pressed={showSecret}
                    aria-label={showSecret ? 'Esconder a chave' : 'Mostrar a chave'}
                    onClick={() => setShowSecret((on) => !on)}
                  >
                    {showSecret ? <EyeOffIcon /> : <EyeIcon />}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription>
                {saved
                  ? 'Em branco mantém a chave que já está no cofre.'
                  : 'Fica cifrada no cofre do sistema — não volta para a tela depois.'}
              </FieldDescription>
            </Field>
          </FieldGroup>

          <Button type="submit" disabled={!ready || busy} aria-busy={busy || undefined}>
            {busy && <Spinner data-icon="inline-start" />}
            {connectLabel}
          </Button>
        </>
      )}

      {waiting && (
        <p className="text-muted-foreground text-xs leading-relaxed" role="status">
          Abri a janela do Cloudflare. Entre com o seu email por lá — quando terminar, eu sigo
          sozinho. Fechar aquela janela cancela.
        </p>
      )}

      {!busy && notice && <p className="text-muted-foreground text-xs leading-relaxed">{notice}</p>}

      {!busy && error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!secretPersisted && (
        <p className="text-muted-foreground text-xs leading-relaxed">
          Este sistema não tem cofre de senhas: a chave não fica guardada, vou pedir de novo na
          próxima vez. O endereço fica.
        </p>
      )}

      {(onCancel || footer) && (
        <>
          <Separator />
          <div className="flex items-center gap-1">
            {footer}
            {onCancel && (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                className="ml-auto"
                onClick={onCancel}
                disabled={busy}
              >
                {cancelLabel}
              </Button>
            )}
          </div>
        </>
      )}
    </Shell>
  )
}
