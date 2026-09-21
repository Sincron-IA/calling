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

import { useCallback, useEffect, useState } from 'react'
import { App } from './App'
import { ConnectScreen, ConnectingCard, type ConnectPhase } from './ConnectScreen'
import { fetchAgents } from './bridge'
import { DEFAULT_BRIDGE_URL, setConfig } from './config'
import { resetIncomingStream } from './incoming'
import { desktop } from './desktop'

type Phase = 'boot' | ConnectPhase

const GENERIC_ERROR = 'Não consegui falar com o bridge. Confira o endereço e a chave.'

/**
 * Quanto tempo o conteudo precisa ficar parado antes de a janela encolher.
 *
 * Um pouco acima da transicao mais longa do CSS (240ms, o chip abrindo), para
 * que a janela so acompanhe o tamanho FINAL — nunca um quadro do meio.
 */
const SETTLE_MS = 280

/**
 * Quanto a janela cresce ALEM do conteudo quando algo comeca a abrir.
 *
 * Cobre com sobra o que ainda falta de qualquer transicao da interface (a maior
 * e o chip, ~215px de largura). O excedente e transparente e sai no `settle`
 * logo em seguida — o que ele compra e a janela nunca correr atras do conteudo.
 */
const GROW_SLACK = 320

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
     * DUAS CHAMADAS POR GESTO, NAO CATORZE.
     *
     * O chip abre em 240ms de transicao CSS e o observador dispara a cada
     * quadro dela. A versao anterior segurava o ENCOLHER mas mandava todo
     * quadro do CRESCER — uns catorze `setBounds` em sequencia, cada um por
     * IPC, cada um assincrono. A janela ficava alguns quadros atras do
     * conteudo, entao por um instante ela era mais estreita do que o que havia
     * dentro dela: o conteudo aparecia cortado a esquerda (o "estrangulado") e
     * a borda esquerda varria por baixo do cursor (o "pulando"), o que ainda
     * devolvia `pointerenter`/`pointerleave` sinteticos.
     *
     * A janela nao pode ir ATRAS da animacao — ela tem que ja estar grande
     * quando a animacao comeca. Como o tamanho final so se conhece no fim,
     * crescemos de uma vez com folga: um retangulo maior que o conteudo e
     * invisivel (a janela e transparente), entao a folga nao custa nada, e os
     * quadros seguintes ja cabem nela e nao mandam mais nada.
     *
     * Fica assim: UMA chamada ao comecar a crescer, e UMA no fim, quando o
     * conteudo para e a janela veste o tamanho exato.
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
      // O tamanho exato vem depois que tudo parar — inclusive o que cresceu com
      // folga aqui em cima.
      shrinkTimer = window.setTimeout(settle, SETTLE_MS)

      // Ja cabe? Entao nao ha nada a fazer: e um quadro do meio da animacao.
      if (width <= applied.width && height <= applied.height) return

      // Nao cabe: cresce de uma vez, com a folga que cobre o resto da animacao.
      // A folga vai so no eixo que esta crescendo — um retangulo transparente
      // maior que o conteudo nao aparece, mas engole clique enquanto existe.
      send(
        width > applied.width ? width + GROW_SLACK : applied.width,
        height > applied.height ? height + GROW_SLACK : applied.height,
      )
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

  /* A ENGRENAGEM NAO MORA MAIS AQUI, entao a borda da tela nao muda mais o
     desenho: ela e uma linha no cabecalho da lista de agentes, e a lista abre
     sempre no mesmo lugar. O `getMainEdge`/`onMainEdge` da ponte continua de pe
     para quem precisar saber onde a janela esta — hoje, ninguem. */

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

