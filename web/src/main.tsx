import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ConfigPanel } from './ConfigPanel'
import { DesktopGate } from './DesktopGate'
import { isConfigPanel, isDesktop } from './desktop'
import './styles.css'

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
