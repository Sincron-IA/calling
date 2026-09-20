import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ConfigPanel } from './ConfigPanel'
import { DesktopGate } from './DesktopGate'
import { isConfigPanel, isDesktop, isDesktopMainWindow } from './desktop'
import './styles.css'

// As duas janelas do app de desktop flutuam sem moldura e SAO transparentes
// (`transparent: true` no Electron). Entao nada fora do cartao pode pintar:
// `html`, `body` e `#root` ficam transparentes, senao o retangulo da janela
// reaparece atras dos cantos arredondados.
if (isDesktop) document.documentElement.classList.add('desktop-window')

// A janela principal, alem disso, veste o tamanho do conteudo: esta classe e o
// que desliga o layout de tela cheia (o `100vh` e a barra grudada no canto da
// viewport) que so faz sentido no navegador.
if (isDesktopMainWindow) document.body.classList.add('desktop-main')

// O painel da engrenagem tem o tamanho do cartao: nao ha pagina em volta dele.
if (isConfigPanel) document.body.classList.add('desktop-panel')

// No navegador nada muda: o app sobe direto, lendo o `.env` como sempre.
// Dentro do app de desktop sao duas janelas com o MESMO codigo: a da barra,
// com o porteiro (DesktopGate), e a da engrenagem (`#config`), que mostra so o
// painel de conexao.
function Root() {
  if (!isDesktop) return <App />
  return isConfigPanel ? <ConfigPanel /> : <DesktopGate />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
