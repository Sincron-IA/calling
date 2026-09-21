import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ConfigPanel } from './ConfigPanel'
import { DesktopGate } from './DesktopGate'
import { Preview } from './Preview'
import { isConfigPanel, isDesktop, isDesktopMainWindow } from './desktop'
// Fontes empacotadas com o app: a janela do desktop nao pode depender de rede
// para desenhar a propria letra.
// A Geist de texto vem na versao VARIAVEL, pelo `index.css` — um arquivo no
// lugar de tres. A mono continua estatica porque so usamos dois pesos dela.
import '@fontsource/geist-mono/400.css'
import '@fontsource/geist-mono/500.css'
// O tema: tokens do Calling + Tailwind + as tres coisas que nao tem componente
// pronto (o filete de tempo, a onda do audio e o chip que se abre no hover).
import './index.css'

// As duas janelas do app de desktop flutuam sem moldura e SAO transparentes
// (`transparent: true` no Electron). Entao nada fora do cartao pode pintar:
// `html`, `body` e `#root` ficam transparentes, senao o retangulo da janela
// reaparece atras dos cantos arredondados.
if (isDesktop) document.documentElement.classList.add('desktop-window')

// O Calling e escuro, sempre — nao ha tema claro para alternar. A classe existe
// porque os componentes do shadcn a leem; os tokens ja valem sem ela.
document.documentElement.classList.add('dark')

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
/* A bancada de conferencia dos paineis. So em desenvolvimento — no build ela
   nem existe, porque o `import.meta.env.DEV` e constante e o bundler a corta
   junto com o import dinamico. */
const previewing =
  import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === 'panels'

function Root() {
  if (previewing) return <Preview />
  if (!isDesktop) return <App />
  return isConfigPanel ? <ConfigPanel /> : <DesktopGate />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
