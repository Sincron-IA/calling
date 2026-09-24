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
 * Depois disso a configuracao nao volta mais como tela cheia: a engrenagem na
 * lista de agentes abre o painel compacto (`ConfigPanel`, numa janela sem
 * moldura).
 *
 * Nas vezes seguintes o passo 1 nem aparece: a configuracao esta salva e o
 * cookie do Cloudflare continua na sessao do Electron, entao o app confere em
 * silencio e cai direto no passo 4. So se a sessao do Access tiver expirado e
 * que a tela volta — ja preenchida, faltando so clicar no botao.
 *
 * Este arquivo NAO existe no navegador: o `main.tsx` so o monta quando
 * `window.callingDesktop` esta presente.
 */

import { useCallback, useEffect, useState } from 'react'
import { App } from './App'
import { ConnectScreen, ConnectingCard, type ConnectPhase } from './ConnectScreen'
import { fetchAgents } from './bridge'
import { DEFAULT_BRIDGE_URL, setConfig } from './config'
import { resetIncomingStream } from './incoming'
import { desktop, type MainEdgeState } from './desktop'

type Phase = 'boot' | ConnectPhase

const GENERIC_ERROR = 'Não consegui falar com o bridge. Confira o endereço e a chave.'

/**
 * Quanto o cursor anda, com o botao apertado, antes de virar arrasto.
 *
 * Abaixo disso e clique: as barrinhas abrem a barra, o avatar escreve. Acima,
 * e a mao pegando o chip — e o clique que viria no fim e engolido.
 */
const DRAG_THRESHOLD_PX = 4

/** O que conta como "em cima de algo da pagina" para o clique nao atravessar. */
const SURFACE = '[data-surface]'

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

  /* ------------------------------------------ a janela da barra, por dentro */

  /*
   * A JANELA NAO VESTE MAIS O CONTEUDO.
   *
   * Ela media o `#root` e pedia um `setBounds` a cada coisa que abria — e o
   * Windows, ao redimensionar uma janela transparente, pinta um quadro com a
   * imagem velha fora do lugar antes de a pagina redesenhar. Era o "tchucho"
   * de toda abertura. Agora a janela tem tamanho fixo (ver `MAIN_SIZE`, no
   * processo principal) e o que abre, abre dentro dela, so com CSS.
   *
   * O preco de uma janela maior que o conteudo e a parte transparente: ela
   * engoliria o clique de quem esta embaixo. Entao a pagina diz ao processo
   * principal, a cada movimento do mouse, se o cursor esta em cima de um
   * cartao (`data-surface`) — e so ai o clique e nosso.
   */
  useEffect(() => {
    let capturing = false
    void api.setMouseCapture(false)
    void api.mainReady()

    const onMove = (event: MouseEvent) => {
      // Botao apertado (arrasto, selecao de texto): nao solta no meio do gesto.
      if (event.buttons !== 0 && capturing) return
      const over = event.target instanceof Element && event.target.closest(SURFACE) !== null
      if (over === capturing) return
      capturing = over
      void api.setMouseCapture(over)
    }

    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [api])

  /*
   * O ARRASTO.
   *
   * Quem tem `data-drag-handle` (o chip, o botao da pilha, o cabecalho do
   * cartao de chamada) pega a janela. Os botoes dentro dele continuam botoes:
   * so vira arrasto quando o cursor anda `DRAG_THRESHOLD_PX` com o botao
   * apertado — e ai o clique do fim e engolido, para soltar o chip nao abrir
   * a barra.
   *
   * Quem segue o cursor e o processo principal; aqui so dizemos quando comeca
   * (e onde esta o chip, que e o que fica preso na mao) e quando termina.
   */
  useEffect(() => {
    let press: { id: number; x: number; y: number; handle: Element } | null = null
    let dragging = false
    let swallowClick = false

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      const target = event.target instanceof Element ? event.target : null
      const handle = target?.closest('[data-drag-handle]')
      if (!handle || target?.closest('input, textarea, select')) return
      press = { id: event.pointerId, x: event.screenX, y: event.screenY, handle }
      dragging = false
    }

    const onMove = (event: PointerEvent) => {
      if (!press || dragging || event.pointerId !== press.id) return
      const moved = Math.hypot(event.screenX - press.x, event.screenY - press.y)
      if (moved < DRAG_THRESHOLD_PX) return
      dragging = true
      const anchor = document.querySelector('[data-anchor]') ?? press.handle
      const rect = anchor.getBoundingClientRect()
      try {
        ;(press.handle as HTMLElement).setPointerCapture(event.pointerId)
      } catch {
        // Sem captura o arrasto continua: quem segue o cursor e o Electron.
      }
      void api.dragStart({ x: rect.left, y: rect.top, width: rect.width, height: rect.height })
    }

    const onUp = (event: PointerEvent) => {
      if (!press || event.pointerId !== press.id) return
      if (dragging) {
        void api.dragEnd()
        // O `click` sai logo depois deste `pointerup`, na mesma leva de
        // eventos; o relogio so limpa o sinal se ele nao vier.
        swallowClick = true
        window.setTimeout(() => (swallowClick = false), 0)
      }
      press = null
      dragging = false
    }

    const onClick = (event: MouseEvent) => {
      if (!swallowClick) return
      swallowClick = false
      event.preventDefault()
      event.stopPropagation()
    }

    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    window.addEventListener('click', onClick, true)
    return () => {
      if (dragging) void api.dragEnd()
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      window.removeEventListener('click', onClick, true)
    }
  }, [api])

  /*
   * PARA QUE LADO AS COISAS ABREM.
   *
   * Quem decide e o processo principal, pela metade da tela onde o chip esta:
   * na de cima, a lista, os avisos e as notificacoes abrem ABAIXO dele; na da
   * esquerda, abrem a DIREITA. Aqui so viramos o canto em que o CSS encosta o
   * conteudo (`.grow-down`, `.grow-right` no `index.css`).
   *
   * Quando a troca acontece no meio de um arrasto, a janela tambem anda (para
   * o chip continuar debaixo da mao). Para os dois nunca aparecerem
   * desencontrados, o conteudo some (`edge-swap`), vira, confirmamos, a janela
   * anda, e so entao ele volta.
   */
  useEffect(() => {
    let alive = true
    const body = document.body

    const flip = (state: MainEdgeState) => {
      body.classList.toggle('grow-down', state.growDown)
      body.classList.toggle('grow-right', state.growRight)
    }

    const apply = (state: MainEdgeState) => {
      if (!alive) return
      if (!state.swap) {
        flip(state)
        return
      }
      const token = state.swap
      body.classList.add('edge-swap')
      flip(state)
      // Dois quadros: o primeiro ja pinta o conteudo apagado, virado.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          void api
            .confirmMainEdge(token)
            .catch(() => undefined)
            .finally(() => requestAnimationFrame(() => body.classList.remove('edge-swap')))
        }),
      )
    }

    void api.getMainEdge().then(apply)
    const stop = api.onMainEdge(apply)

    return () => {
      alive = false
      stop()
      body.classList.remove('grow-down', 'grow-right', 'edge-swap')
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
      } catch (err) {
        setError(explainFailure(err))
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
  /**
   * Abrir o painel de conexao.
   *
   * A ancora vem de QUEM CLICOU — hoje a engrenagem no cabecalho da lista de
   * agentes. Antes ela era lida de um `ref` para um botao que morava aqui; o
   * botao mudou de casa e o `ref` foi junto, virando este parametro.
   */
  const openConfigPanel = useCallback(
    (anchor: { x: number; y: number; width: number; height: number } | null) => {
      void api.openConfigPanel(anchor)
    },
    [api],
  )

  /* ------------------------------------------------------------ desenho -- */

  if (!connected) {
    return phase === 'boot' ? (
      // Em caixa: a versao de tela cheia pintaria a janela inteira de fundo.
      <ConnectingCard compact />
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

  return <App key={session} readyNotice={readyNotice} onOpenConfig={openConfigPanel} />
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

