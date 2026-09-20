import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { DesktopGate } from './DesktopGate'
import { isDesktop } from './desktop'
import './styles.css'

// No navegador nada muda: o app sobe direto, lendo o `.env` como sempre.
// Dentro do app de desktop, quem manda na tela e o porteiro (DesktopGate),
// que pede endereco e chave na primeira vez e cuida do login do Cloudflare.
createRoot(document.getElementById('root')!).render(
  <StrictMode>{isDesktop ? <DesktopGate /> : <App />}</StrictMode>,
)
