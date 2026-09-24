/**
 * O painel da engrenagem — a configuracao do tamanho de um menu.
 *
 * Roda numa janela sem moldura (`electron/config-panel.js`), carregando este
 * MESMO app com `#config`: por isso o painel tem as cores, as fontes e o
 * formulario de verdade, sem uma segunda copia de tela para manter.
 *
 * O caminho e o mesmo da primeira vez (endereco + chave + login do Cloudflare);
 * ao terminar, o painel se fecha e a janela da barra recarrega sozinha — quem
 * faz isso e o processo principal, ao salvar.
 *
 * As SAIDAS do painel tem peso diferente entre si, e agora o desenho diz isso:
 * "Abrir a barra" e um atalho comum, "Sair do Calling" encerra o app e por isso
 * pergunta antes. Antes os dois eram o mesmo botao de texto, lado a lado.
 */

import { useCallback, useEffect, useState } from 'react'
import { PanelTopOpenIcon, PowerIcon } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { ConnectScreen, ConnectingCard, type ConnectPhase } from './ConnectScreen'
import { fetchAgents } from './bridge'
import { DEFAULT_BRIDGE_URL, setConfig } from './config'
import { desktop, type AppPrefs } from './desktop'

const GENERIC_ERROR = 'Não consegui falar com o bridge. Confira o endereço e a chave.'

/**
 * A tela diz o que o bridge disse.
 *
 * Antes, toda falha de `fetchAgents` virava a MESMA frase generica — e ela
 * cobria tres problemas com saidas opostas: a chave errada, a sessao do
 * Cloudflare barrando a chamada antes de ela chegar no Node, e o bridge fora do
 * ar. Quem lia nao tinha como saber qual dos tres era, e o unico lugar onde a
 * diferenca importava era justamente este.
 *
 * O `BridgeUnreachableError` ja nasce com o texto certo; o resto traz o motivo
 * do proprio bridge. A frase generica fica so para o erro sem mensagem nenhuma.
 */
function explainFailure(err: unknown): string {
  const message = err instanceof Error ? err.message.trim() : ''
  return message || GENERIC_ERROR
}

export function ConfigPanel() {
  const api = desktop!

  const [loaded, setLoaded] = useState(false)
  const [phase, setPhase] = useState<ConnectPhase>('form')
  const [status, setStatus] = useState('sem chave')
  const [error, setError] = useState('')
  const [secretPersisted, setSecretPersisted] = useState(true)
  const [saved, setSaved] = useState({ bridgeUrl: DEFAULT_BRIDGE_URL, sharedSecret: '' })
  const [prefs, setPrefs] = useState<AppPrefs>({ alwaysOnTop: false, startWithWindows: false })

  const close = useCallback(() => void api.closeConfigPanel(), [api])

  /* ------------------------------------------------- o que ja esta salvo -- */

  useEffect(() => {
    let alive = true

    void (async () => {
      const stored = await api.getConfig().catch(() => null)
      if (!alive) return

      if (stored?.bridgeUrl || stored?.sharedSecret) {
        setSaved({ bridgeUrl: stored.bridgeUrl || DEFAULT_BRIDGE_URL, sharedSecret: stored.sharedSecret })
        setSecretPersisted(stored.secretPersisted)
      }

      if (!stored?.bridgeUrl || !stored.sharedSecret) {
        setLoaded(true)
        return
      }

      // Confere em silencio so para dizer no cabecalho como esta a conexao.
      //
      // O "Abrindo…" fica ate esta resposta chegar DE PROPOSITO: e ela que diz
      // se o painel mostra o formulario ou so o selo de conectado. Abrir antes
      // seria piscar o formulario na cara de quem esta com tudo funcionando.
      setConfig({ bridgeUrl: stored.bridgeUrl, sharedSecret: stored.sharedSecret })
      try {
        await fetchAgents()
        if (alive) setStatus('conectado')
      } catch {
        if (alive) setStatus('reconectar')
      }
      if (alive) setLoaded(true)
    })()

    return () => {
      alive = false
    }
  }, [api])

  /*
   * A janela acompanha a altura do conteudo.
   *
   * O alvo e o PRIMEIRO filho do `#root` (o cartao do painel), e nao uma classe
   * do CSS antigo: assim a medida continua certa enquanto a migracao troca o
   * que ha dentro dele.
   */
  useEffect(() => {
    const card = document.getElementById('root')?.firstElementChild
    if (!card) return
    const report = () => void api.resizeConfigPanel(Math.ceil(card.getBoundingClientRect().height))
    report()
    const observer = new ResizeObserver(report)
    observer.observe(card)
    return () => observer.disconnect()
  }, [api, loaded, phase])

  /* AS PREFERENCIAS.

     Quem grava e o processo principal — ele e quem aplica na janela. Ficamos
     ouvindo porque a mesma opcao existe no menu da bandeja: mudar por la com o
     painel aberto deixaria o interruptor daqui mostrando o contrario. */
  useEffect(() => {
    let alive = true
    void api
      .getPrefs()
      .then((value) => {
        if (alive && value) setPrefs(value)
      })
      .catch(() => undefined)

    const stop = api.onPrefs((value) => {
      if (value) setPrefs(value)
    })

    return () => {
      alive = false
      stop?.()
    }
  }, [api])

  const togglePref = useCallback(
    (patch: Partial<AppPrefs>) => {
      // O estado vem de volta do processo principal, ja aplicado: assim o
      // interruptor nunca diz uma coisa e a janela faz outra.
      void api.setPrefs(patch).then((next) => next && setPrefs(next))
    },
    [api],
  )

  // Esc fecha, como em qualquer menu.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [close])

  /* ---------------------------------------------------------- conectar --- */

  const connect = useCallback(
    async (bridgeUrl: string, sharedSecret: string) => {
      setError('')
      setStatus('login aberto')
      setConfig({ bridgeUrl, sharedSecret })
      setPhase('login')

      const login = await api.openCloudflareLogin(bridgeUrl).catch((err: Error) => ({
        status: 'error' as const,
        message: err.message,
      }))

      if (login.status === 'cancelled') {
        setStatus('reconectar')
        setPhase('form')
        return
      }

      if (login.status !== 'ok') {
        setError(login.message || 'Não consegui abrir o login do Cloudflare.')
        setStatus('reconectar')
        setPhase('form')
        return
      }

      setPhase('validating')
      try {
        await fetchAgents()
      } catch (err) {
        setError(explainFailure(err))
        setStatus('reconectar')
        setPhase('form')
        return
      }

      // Salvar avisa o processo principal, que recarrega a janela da barra com
      // o endereco e a chave novos. Aqui so fechamos.
      await api.saveConfig({ bridgeUrl, sharedSecret }).catch(() => undefined)
      close()
    },
    [api, close],
  )

  /*
   * Desconectar: esquece endereco, chave e a sessao do Cloudflare.
   *
   * O `clearConfig` ja existia na ponte com o Electron e nunca tinha sido
   * chamado por ninguem — nao havia como desfazer uma conexao pela interface.
   */
  const forget = useCallback(async () => {
    await api.clearConfig().catch(() => undefined)
    setSaved({ bridgeUrl: DEFAULT_BRIDGE_URL, sharedSecret: '' })
    setStatus('sem chave')
    setPhase('form')
    setError('')
  }, [api])

  if (!loaded) return <ConnectingCard label="Abrindo…" compact />

  return (
    <ConnectScreen
      defaultBridgeUrl={saved.bridgeUrl}
      defaultSecret={saved.sharedSecret}
      phase={phase}
      error={error}
      secretPersisted={secretPersisted}
      statusLabel={status}
      // So `conectado` esconde o formulario. `sem chave` (primeira vez) e
      // `reconectar` (sessao do Cloudflare vencida, ou chave errada) precisam
      // dele — e para isso que a pessoa abriu o painel.
      connected={status === 'conectado'}
      compact
      onConnect={(url, secret) => void connect(url, secret)}
      onForget={saved.sharedSecret ? () => void forget() : undefined}
      onCancel={close}
      cancelLabel="Fechar"
      preferences={
        <FieldGroup className="gap-3">
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="always-on-top">Sempre no topo</FieldLabel>
              <FieldDescription>A barra fica por cima das outras janelas.</FieldDescription>
            </FieldContent>
            <Switch
              id="always-on-top"
              checked={prefs.alwaysOnTop}
              onCheckedChange={(value) => togglePref({ alwaysOnTop: value })}
            />
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="start-with-windows">Iniciar com o Windows</FieldLabel>
              <FieldDescription>O Calling sobe sozinho quando a máquina liga.</FieldDescription>
            </FieldContent>
            <Switch
              id="start-with-windows"
              checked={prefs.startWithWindows}
              onCheckedChange={(value) => togglePref({ startWithWindows: value })}
            />
          </Field>
        </FieldGroup>
      }
      footer={
        <>
          <Button variant="ghost" size="sm" type="button" onClick={() => void api.showMainWindow()}>
            <PanelTopOpenIcon data-icon="inline-start" />
            Abrir a barra
          </Button>

          {/* Encerrar o app e a unica acao daqui que nao da para desfazer:
              ela pergunta antes, e nao divide o peso visual com o atalho ao
              lado. */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon-sm" type="button" aria-label="Sair do Calling">
                <PowerIcon />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Sair do Calling?</AlertDialogTitle>
                <AlertDialogDescription>
                  A barra fecha e os agentes deixam de conseguir chamar você por aqui. Os toques
                  continuam caindo no Telegram, como sempre.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Ficar</AlertDialogCancel>
                <AlertDialogAction onClick={() => void api.quit()}>Sair</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      }
    />
  )
}
