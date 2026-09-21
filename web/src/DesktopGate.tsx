/**
 * O porteiro do app de desktop.
 *
 * Ele e quem decide o que a janela mostra:
 *
 *   1. primeira vez        -> a tela de conexao (endereco + chave)
 *   2. clicou no botao     -> a janela de login do Cloudflare abre por cima
 *   3. voltou do login     -> "Conectando…" enquanto conferimos com o bridge
 *   4. deu certo           -> o app de sempre, com a barra do Calling
 *
 * Depois disso a configuracao nao volta mais como tela cheia: a engrenagem no
 * canto abre o painel compacto (`ConfigPanel`, numa janela sem moldura).
 *
 * Nas vezes seguintes o passo 1 nem aparece: a configuracao esta salva e o
 * cookie do Cloudflare continua na sessao do Electron, entao o app confere em
 * silencio e cai direto no passo 4. So se a sessao do Access tiver expirado e
 * que a tela volta — ja preenchida, faltando so clicar no botao.
 *
 * Este arquivo NAO existe no navegador: o `main.tsx` so o monta quando
 * `window.callingDesktop` esta presente.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { App } from './App'
import { ConnectScreen, ConnectingCard, type ConnectPhase } from './ConnectScreen'
import { fetchAgents } from './bridge'
import { DEFAULT_BRIDGE_URL, setConfig } from './config'
import { resetIncomingStream } from './incoming'
import { desktop } from './desktop'
import { SettingsIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type Phase = 'boot' | ConnectPhase

const GENERIC_ERROR = 'Não consegui falar com o bridge. Confira o endereço e a chave.'

/**
 * Quanto tempo o conteudo precisa ficar parado antes de a janela encolher.
 *
 * Um pouco acima da transicao mais longa do CSS (240ms, o chip abrindo), para
 * que a janela so acompanhe o tamanho FINAL — nunca um quadro do meio.
 */
const SETTLE_MS = 280

export function DesktopGate() {
  const api = desktop!

  const [phase, setPhase] = useState<Phase>('boot')
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [secretPersisted, setSecretPersisted] = useState(true)
  const [saved, setSaved] = useState({ bridgeUrl: DEFAULT_BRIDGE_URL, sharedSecret: '' })
  // Muda a cada conexao bem-sucedida: forca o App a nascer de novo lendo a
  // configuracao nova (lista de agentes, fluxo de chamadas recebidas).
  const [session, setSession] = useState(0)
  // Recado do "conectou". So a conexao pelo BOTAO o preenche: a reconexao
  // silenciosa da abertura do app (cookie ainda valendo) nao avisa nada, senao
  // viraria ruido toda manha.
  const [readyNotice, setReadyNotice] = useState('')
  // A barra encostou na borda direita da tela? Entao a engrenagem desce.
  const [rightEdge, setRightEdge] = useState(false)
  const gearRef = useRef<HTMLButtonElement>(null)

  /* --------------------------------------------------- abertura do app ---- */

  useEffect(() => {
    let alive = true

    void (async () => {
      const stored = await api.getConfig().catch(() => null)
      if (!alive) return

      if (stored) {
        setSaved({ bridgeUrl: stored.bridgeUrl, sharedSecret: stored.sharedSecret })
        setSecretPersisted(stored.secretPersisted)
      }

      // Sem endereco ou sem chave nao ha o que tentar: e a primeira vez.
      if (!stored?.bridgeUrl || !stored.sharedSecret) {
        setPhase('form')
        return
      }

      setConfig({ bridgeUrl: stored.bridgeUrl, sharedSecret: stored.sharedSecret })
      try {
        // A mesma pergunta de sempre ao bridge: se ela passa, o cookie do
        // Access e a chave do app estao os dois valendo.
        await fetchAgents()
        if (!alive) return
        setConnected(true)
      } catch {
        if (!alive) return
        setNotice('A sessão do Cloudflare expirou. É só conectar de novo.')
        setPhase('form')
      }
    })()

    return () => {
      alive = false
    }
  }, [api])

  /* --------------------------------------------- a janela veste o conteudo */

  /**
   * A janela nao tem moldura nem tamanho proprio: ela e do tamanho do que esta
   * dentro dela. O `#root` e quem sabe isso (no desktop ele encolhe ate o
   * conteudo, ver `.desktop-main` no CSS) — aqui so contamos para o processo
   * principal, que reancora a janela no canto.
   *
   * Um observador basta para tudo: a tela de conexao, a barra, o chip que
   * cresce no hover e o cartao de chamada recebida passam todos por aqui.
   */
  useEffect(() => {
    const root = document.getElementById('root')
    if (!root) return

    let frame = 0
    let shrinkTimer = 0
    let applied = { width: 0, height: 0 }

    const send = (width: number, height: number) => {
      applied = { width, height }
      void api.resizeMainWindow({ width, height })
    }

    /*
     * Crescer e imediato; encolher espera a animacao terminar.
     *
     * O chip cresce e encolhe em 240ms de transicao CSS, e o observador dispara
     * a cada quadro dela. Mandando todos, a janela encolhia DEBAIXO do cursor no
     * meio do fechamento: o ponto onde o mouse estava saia da janela, o chip
     * recebia um `pointerleave`, e o proximo quadro devolvia um `pointerenter`
     * — a barra piscava aberta/fechada sem parar.
     *
     * Uma janela maior que o conteudo nao aparece (ela e transparente), entao
     * segurar o encolhimento por um instante nao custa nada visualmente.
     */
    const read = () => {
      const rect = root.getBoundingClientRect()
      return { width: Math.ceil(rect.width), height: Math.ceil(rect.height) }
    }

    /** Passado o tempo de calmaria, a janela veste o tamanho que sobrou. */
    const settle = () => {
      const { width, height } = read()
      if (width < 1 || height < 1) return
      if (width === applied.width && height === applied.height) return
      send(width, height)
    }

    const measure = () => {
      frame = 0
      const { width, height } = read()
      if (width < 1 || height < 1) return

      window.clearTimeout(shrinkTimer)
      // Encolher (ou um crescimento que ainda esta a caminho) espera a calmaria.
      shrinkTimer = window.setTimeout(settle, SETTLE_MS)

      // Crescer nao espera: o conteudo novo nao pode aparecer cortado.
      if (width > applied.width || height > applied.height) {
        send(Math.max(width, applied.width), Math.max(height, applied.height))
      }
    }

    // Um quadro por vez: o observador dispara varias vezes dentro do mesmo.
    const schedule = () => {
      if (frame) return
      frame = window.requestAnimationFrame(measure)
    }

    measure()
    const observer = new ResizeObserver(schedule)
    observer.observe(root)
    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame)
      window.clearTimeout(shrinkTimer)
    }
  }, [api])

  /* ------------------------------------ a engrenagem ao lado ou embaixo --- */

  /**
   * Quem sabe ONDE a janela esta e o processo principal (ele e quem a ancora no
   * canto). Perguntamos uma vez ao nascer e depois ficamos ouvindo: arrastar a
   * barra ate a borda direita, ou trocar a resolucao, muda a resposta.
   */
  useEffect(() => {
    let alive = true

    void api
      .getMainEdge()
      .then((state) => {
        if (alive && state) setRightEdge(state.rightEdge)
      })
      .catch(() => undefined)

    const stop = api.onMainEdge((state) => {
      if (state) setRightEdge(state.rightEdge)
    })

    return () => {
      alive = false
      stop?.()
    }
  }, [api])

  /* ------------------------------------------------ conectar de verdade -- */

  const connect = useCallback(
    async (bridgeUrl: string, sharedSecret: string) => {
      setError('')
      setNotice('')
      setConfig({ bridgeUrl, sharedSecret })
      setPhase('login')

      // SILENCIO NO BRIDGE ANTES DE COMECAR.
      //
      // O fluxo SSE das chamadas recebidas pode estar pendurado no endereco
      // antigo e, com a sessao do Access vencida, cada tentativa dele bate no
      // endpoint de login do Cloudflare — no MESMO pote de cookies da janela de
      // login, porque e tudo a sessao padrao do Electron. Se isso acontece
      // entre "me manda o codigo" e "aqui esta o codigo", o Access ja esta em
      // outra tentativa de login e responde que o codigo expirou. Fechamos o
      // fluxo aqui, ANTES de abrir a janela; ele volta sozinho no `setSession`
      // la embaixo, ja com a configuracao nova.
      resetIncomingStream()

      // Abre (ou reaproveita) a sessao do Cloudflare Access. Se o cookie ainda
      // estiver de pe, isso volta na hora e nenhuma janela chega a aparecer.
      const login = await api.openCloudflareLogin(bridgeUrl).catch((err: Error) => ({
        status: 'error' as const,
        message: err.message,
      }))

      if (login.status === 'cancelled') {
        // Fechou a janela de login: volta para o formulario, sem drama.
        setPhase('form')
        return
      }

      if (login.status !== 'ok') {
        setError(login.message || 'Não consegui abrir o login do Cloudflare.')
        setPhase('form')
        return
      }

      setPhase('validating')
      let list: Awaited<ReturnType<typeof fetchAgents>>
      try {
        list = await fetchAgents()
      } catch {
        setError(GENERIC_ERROR)
        setPhase('form')
        return
      }

      setReadyNotice(readyMessage(list.length))

      const result = await api
        .saveConfig({ bridgeUrl, sharedSecret })
        .catch(() => ({ secretPersisted: false }))

      setSecretPersisted(result.secretPersisted)
      setSaved({ bridgeUrl, sharedSecret })
      setSession((n) => n + 1)
      setConnected(true)
      setPhase('form')
    },
    [api],
  )

  /* -------------------------------------------------- painel da engrenagem */

  /**
   * A engrenagem manda o proprio retangulo junto: e a ancora do painel. Quem
   * decide se ele desce ou sobe e o processo principal, olhando o espaco que
   * sobra na tela (no Windows, com a barra de tarefas embaixo, ele sobe).
   */
  const openConfigPanel = useCallback(() => {
    const rect = gearRef.current?.getBoundingClientRect()
    void api.openConfigPanel(
      rect ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : null,
    )
  }, [api])

  /* ------------------------------------------------------------ desenho -- */

  if (!connected) {
    return phase === 'boot' ? (
      <ConnectingCard />
    ) : (
      <ConnectScreen
        defaultBridgeUrl={saved.bridgeUrl}
        defaultSecret={saved.sharedSecret}
        phase={phase}
        error={error}
        notice={notice}
        secretPersisted={secretPersisted}
        onConnect={(url, secret) => void connect(url, secret)}
      />
    )
  }

  /**
   * Barra e engrenagem moram no MESMO bloco de proposito: e nele que o `:hover`
   * (e o `:focus-within`, para quem anda de Tab) acende a engrenagem. Em repouso
   * ela fica invisivel — a barra sozinha, como o Luiz pediu.
   *
   * `shell--stacked` e a barra colada na borda direita: a engrenagem desce para
   * baixo da barra em vez de ficar espremida contra o canto da tela.
   */
  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          'group/shell flex',
          // Colada na borda direita: a engrenagem desce para baixo da barra em
          // vez de ficar espremida contra o canto da tela.
          rightEdge ? 'flex-col items-end gap-1.5' : 'flex-row items-end gap-1.5',
        )}
      >
        {rightEdge && <App key={session} readyNotice={readyNotice} />}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              ref={gearRef}
              variant="ghost"
              size="icon-sm"
              type="button"
              aria-label="Conexão"
              onClick={openConfigPanel}
              className={cn(
                'app-no-drag mb-1.5 rounded-full opacity-0 transition-opacity',
                'group-hover/shell:opacity-100 group-focus-within/shell:opacity-100 focus-visible:opacity-100',
              )}
            >
              <SettingsIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent side={rightEdge ? 'left' : 'top'}>Conexão</TooltipContent>
        </Tooltip>

        {!rightEdge && <App key={session} readyNotice={readyNotice} />}
      </div>
    </TooltipProvider>
  )
}

/**
 * O texto do "conectou". Diz o NUMERO que veio do bridge: se ele responder com
 * zero agentes, o recado fala isso em vez de inventar uma lista cheia e deixar
 * o Luiz descobrir sozinho na hora de ligar.
 */
function readyMessage(count: number): string {
  if (count === 0) return 'Conectado, mas nenhum agente disponível.'
  // O numero vai no pe do recado, junto dos discos de quem esta na linha.
  return 'Conectado · pronto para conversar'
}

