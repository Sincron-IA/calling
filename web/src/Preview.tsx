/**
 * Bancada de conferencia — so em desenvolvimento.
 *
 * A barra e os paineis so existem dentro do Electron (janela sem moldura,
 * `window.callingDesktop`, uma conexao viva com o bridge). Conferir o desenho
 * exigia subir o app inteiro e ter tudo funcionando, o que na pratica queria
 * dizer nao conferir.
 *
 * Aqui tudo aparece lado a lado, em todos os estados, com dados de mentira.
 * Abre em `http://localhost:5173/?preview=panels`. O `main.tsx` so monta isto
 * quando `import.meta.env.DEV` — nada disto vai para o build.
 */

import { useState, type ReactNode } from 'react'
import { PanelTopOpenIcon, PowerIcon } from 'lucide-react'

import { AgentPanel } from './AgentPanel'
import { CallingBar, type QueuedMessage } from './CallingBar'
import { ConnectScreen, ConnectingCard } from './ConnectScreen'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import type { AgentSummary } from './bridge'
import type { IncomingCall } from './incoming'

const URL_FAKE = 'https://calling-bridge.sincronia.digital'
const SECRET_FAKE = 'chave-de-mentira-so-para-a-bancada'

const AGENTS = [
  { slug: 'automa', name: 'Automa', color: '#4ade80' },
  { slug: 'ivo', name: 'Ivo', color: '#60a5fa' },
  { slug: 'theo', name: 'Theo', color: '#c084fc' },
  { slug: 'bravo', name: 'Bravo', color: '#fbbf24' },
  { slug: 'flow', name: 'Flow', color: '#f472b6' },
  { slug: 'vetor', name: 'Vetor', color: '#2dd4bf' },
] as unknown as AgentSummary[]

const colorOf = (slug: string) =>
  (AGENTS.find((a) => a.slug === slug) as { color?: string })?.color ?? '#4ade80'

function call(slug: string, reason: string, id = slug): IncomingCall {
  return {
    id,
    agentSlug: slug,
    reason,
    receivedAt: Date.now(),
    expiresAt: Date.now() + 90_000,
  } as IncomingCall
}

const NADA = () => undefined

/** As props que a barra sempre precisa, com tudo desligado. */
const BASE = {
  agents: AGENTS,
  colorOf,
  currentSlug: 'automa',
  phase: 'idle' as const,
  callStartedAt: null,
  incoming: [],
  onCall: NADA,
  onHangUp: NADA,
  onApprove: NADA,
  onAnswer: NADA,
  onDecline: NADA,
  // A engrenagem so aparece quando ha para onde ela levar.
  onOpenConfig: NADA,
}

/** As preferencias que o `ConfigPanel` monta de verdade. */
function Prefs() {
  const [on, setOn] = useState(false)
  return (
    <FieldGroup className="gap-3">
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="aot">Sempre no topo</FieldLabel>
          <FieldDescription>
            A barra fica por cima das outras janelas.
          </FieldDescription>
        </FieldContent>
        <Switch id="aot" checked={on} onCheckedChange={setOn} />
      </Field>
    </FieldGroup>
  )
}

/** O rodape que o `ConfigPanel` monta de verdade. */
function Footer() {
  return (
    <>
      <Button variant="ghost" size="sm" type="button">
        <PanelTopOpenIcon data-icon="inline-start" />
        Abrir a barra
      </Button>
      <Button variant="ghost" size="icon-sm" type="button" aria-label="Sair do Calling">
        <PowerIcon />
      </Button>
    </>
  )
}

function Case({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <div className="flex w-72 flex-col gap-2">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-muted-foreground text-xs">{note}</p>
      </div>
      <div className="flex justify-end">{children}</div>
    </div>
  )
}

/**
 * Um toque que passou do tempo, junto de um recado. De mentira, mas vivo: o
 * "Limpar" leva so o recado, e decidir o pedido tira ele da lista.
 */
function PendingBench() {
  const late = { ...call('flow', 'Posso rodar a migração das contas agora?', 'late-flow'), receivedAt: Date.now() - 900_000 }
  const [items, setItems] = useState<QueuedMessage[]>([
    { id: 'call-late-flow', agentSlug: 'flow', text: late.reason, at: late.receivedAt, read: false, call: late },
    {
      id: 'm0',
      agentSlug: 'vetor',
      text: 'A migração terminou. Nenhuma coluna foi perdida.',
      at: Date.now() - 400_000,
      read: false,
    },
  ])
  return (
    <CallingBar
      {...BASE}
      currentSlug="flow"
      messages={items}
      onMessagesRead={() => setItems((list) => list.map((item) => ({ ...item, read: true })))}
      onDismissMessage={(id) => setItems((list) => list.filter((item) => item.id !== id))}
      onClearMessages={() => setItems((list) => list.filter((item) => item.call))}
      onResolveLate={(item) => setItems((list) => list.filter((entry) => entry.id !== item.id))}
    />
  )
}

export function Preview() {
  const [closed, setClosed] = useState(0)
  const [draft, setDraft] = useState('Consegue rodar o deploy de novo?')

  return (
    <div className="bg-background min-h-svh space-y-10 p-8">
      <section className="space-y-4">
        <h1 className="text-lg font-semibold">A barra</h1>
        <div className="flex flex-wrap items-end gap-8">
          <Case title="Chip parado" note="passe o mouse para ele abrir">
            <CallingBar {...BASE} />
          </Case>

          <Case title="Chip na linha" note="as barrinhas vivas, o cronômetro">
            <CallingBar {...BASE} phase="in-call" callStartedAt={Date.now() - 83_000} />
          </Case>

          <Case title="Recado curto" note="sai sozinho em 5s">
            <CallingBar {...BASE} notice="Conectado · pronto para conversar" />
          </Case>

          <Case title="Resposta do agente" note="o mouse em cima pausa o relógio">
            <CallingBar
              {...BASE}
              reply={{
                agentSlug: 'ivo',
                text: 'Rodei. O build passou, mas o typecheck do server reclamou de um import não usado.',
                echoed: true,
              }}
            />
          </Case>

          <Case title="Erro" note="não sai sozinho — pede decisão">
            <CallingBar
              {...BASE}
              reply={{
                agentSlug: 'ivo',
                text: 'Não consegui falar com o workspace do Ivo.',
                isError: true,
              }}
            />
          </Case>

          <Case title="Um agente mudou" note="antes → depois">
            <CallingBar
              {...BASE}
              change={{
                slug: 'theo',
                what: 'trocou de cor',
                beforeName: 'Theo',
                beforeColor: '#60a5fa',
              }}
            />
          </Case>

          <Case title="Escrevendo" note="Enter manda, Shift+Enter quebra">
            <CallingBar
              {...BASE}
              compose={{ agentSlug: 'bravo', draft, busy: false }}
              onDraftChange={setDraft}
            />
          </Case>

          <Case title="Esperando a resposta" note="o campo trava">
            <CallingBar
              {...BASE}
              compose={{ agentSlug: 'bravo', draft, busy: true }}
              onDraftChange={setDraft}
            />
          </Case>

          <Case title="Notificações" note="o sino no chip abre; o pedido não sai com Limpar">
            <PendingBench />
          </Case>

          <Case title="Fila de recados" note="clique no sino do chip">
            <CallingBar
              {...BASE}
              messages={[
                {
                  id: 'm1',
                  agentSlug: 'vetor',
                  text: 'A migração terminou. Nenhuma coluna foi perdida.',
                  at: Date.now() - 400_000,
                  read: false,
                },
                {
                  id: 'm2',
                  agentSlug: 'theo',
                  text: 'Subi o rascunho do contrato na pasta do cliente.',
                  at: Date.now() - 3_600_000,
                  read: true,
                },
              ]}
            />
          </Case>

          <Case title="Uma chamada recebida" note="aprovar, voz ou recusar">
            <CallingBar
              {...BASE}
              incoming={[call('flow', 'O deploy de produção precisa de uma aprovação sua.')]}
            />
          </Case>

          <Case title="Várias chamando" note="clique para abrir a pilha">
            <CallingBar
              {...BASE}
              incoming={[
                call('flow', 'O deploy de produção precisa de uma aprovação sua.'),
                call('vetor', 'A migração apagaria 3 colunas. Confirmo?'),
                call('bravo', 'O cliente respondeu a proposta.'),
              ]}
            />
          </Case>
        </div>
      </section>

      <section className="space-y-4">
        <h1 className="text-lg font-semibold">Os painéis</h1>
        <div className="flex flex-wrap items-start gap-8">
          <Case title="Painel · conectado" note="o estado que estava tosco">
            <ConnectScreen
              compact
              connected
              statusLabel="conectado"
              phase="form"
              defaultBridgeUrl={URL_FAKE}
              defaultSecret={SECRET_FAKE}
              onConnect={NADA}
              onForget={NADA}
              onCancel={NADA}
              cancelLabel="Fechar"
              preferences={<Prefs />}
              footer={<Footer />}
            />
          </Case>

          <Case title="Painel · reconectar" note="sessão do Cloudflare venceu">
            <ConnectScreen
              compact
              statusLabel="reconectar"
              phase="form"
              defaultBridgeUrl={URL_FAKE}
              defaultSecret={SECRET_FAKE}
              error="Não consegui falar com o bridge. Confira o endereço e a chave."
              onConnect={NADA}
              onCancel={NADA}
              cancelLabel="Fechar"
              footer={<Footer />}
            />
          </Case>

          <Case title="Painel · primeira vez" note="sem nada guardado">
            <ConnectScreen
              compact
              statusLabel="sem chave"
              phase="form"
              defaultBridgeUrl=""
              defaultSecret=""
              onConnect={NADA}
              onCancel={NADA}
              cancelLabel="Fechar"
              footer={<Footer />}
            />
          </Case>

          <Case title="Painel · esperando o login" note="a janela do Cloudflare abriu">
            <ConnectScreen
              compact
              statusLabel="login aberto"
              phase="login"
              defaultBridgeUrl={URL_FAKE}
              defaultSecret={SECRET_FAKE}
              onConnect={NADA}
              onCancel={NADA}
              cancelLabel="Fechar"
              footer={<Footer />}
            />
          </Case>

          <Case title="Painel · abrindo" note="conferindo em silêncio">
            <ConnectingCard label="Abrindo…" compact />
          </Case>

          <Case title="Painel · sem cofre" note="a chave não fica guardada">
            <ConnectScreen
              compact
              connected
              statusLabel="conectado"
              phase="form"
              secretPersisted={false}
              defaultBridgeUrl={URL_FAKE}
              defaultSecret={SECRET_FAKE}
              onConnect={NADA}
              onForget={NADA}
              onCancel={NADA}
              cancelLabel="Fechar"
              preferences={<Prefs />}
              footer={<Footer />}
            />
          </Case>

          <Case title="Aparência do agente" note="nome, cor e imagem">
            <AgentPanel
              key={closed}
              agent={AGENTS[0]}
              color="#4ade80"
              avatar=""
              onClose={() => setClosed((n) => n + 1)}
              onSaved={NADA}
            />
          </Case>
        </div>
      </section>
    </div>
  )
}
