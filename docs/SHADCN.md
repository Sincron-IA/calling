# O Calling sobre componentes prontos

Este documento responde a uma pergunta só: **quanto do Calling dá para montar
usando exclusivamente componentes prontos do shadcn, e o que sobra de verdade?**

A resposta curta: **19 das 22 superfícies têm componente pronto**. As três que
não têm são a barrinha que se expande no hover, as três barrinhas de onda do
áudio e a alça de arrastar do Electron — e nenhuma delas é um componente de UI
genérico, são particularidades de um widget de canto de tela.

> **A migração já foi feita** — pule para [Feito](#feito) se quiser só o
> resultado. O que vem antes é a análise que a motivou, mantida como está para
> que dê para comparar o previsto com o medido. Duas previsões dela não se
> confirmaram, e a seção **Feito** diz quais e por quê: `Popover`/`Sheet`/`sonner`
> não servem nesta janela, e o `Progress` não substitui o filete de tempo.

## O ponto de partida, medido

| O que | Número |
| --- | --- |
| Código em `web/src` | 5 794 linhas |
| Destas, CSS escrito à mão (`styles.css`) | 2 134 linhas (37%) |
| Seletores de topo no CSS | 234 |
| Dependências de UI | nenhuma (`orb-ui` só desenha o orbe) |
| Componentes acessíveis prontos | nenhum |

Cada superfície nova hoje custa um bloco de CSS novo. O `styles.css` tem
comentários explicando por que um `max-width` anima em vez de um `width`, por
que um rótulo está em fluxo e não absoluto, por que existe um guarda de 600 ms
contra reabrir um menu. Esse é o custo real: o arquivo virou a documentação de
uma biblioteca de componentes que nunca foi escrita como tal.

## O mapa, superfície por superfície

A coluna "hoje" conta as regras CSS de cada prefixo. A coluna "pronto" é o que
o registro `@shadcn` entrega sem escrever CSS.

| Superfície | Hoje | Componente pronto | O que some junto |
| --- | --- | --- | --- |
| `.connect` — endereço e chave | 34 regras | `Card` + `FieldGroup`/`Field` + `InputGroup` + `Button` + `Spinner` + `Alert` | máscara da chave, estado de erro, spinner |
| `.menu` — lista de agentes | 30 | `Popover` + `ItemGroup`/`Item` (`ItemMedia`, `ItemTitle`, `ItemActions`) | navegação por teclado, foco, `aria` |
| `.panel` — aparência do agente | 22 | `Popover` + `Field` + `ToggleGroup` + `Button` | seleção de cor, estados |
| `.compose` — campo de escrever | 22 | `InputGroup` + `InputGroupTextarea` + `InputGroupAddon` | botão dentro do campo, estado ocupado |
| `.chip` — a barrinha | 20 | **parcial**: `Button` + `Avatar` + `Badge` | — (ver "o que não tem") |
| `.notice` — aviso curto | 15 | `sonner` | `NOTICE_TIMEOUT_MS`, o `useEffect` do relógio, a fila de avisos |
| `.bubble` — resposta do agente | 14 | `sonner` (duração + pausa no hover nativas) | `REPLY_TIMEOUT_MS`, `replyHeld`, `replyLeftRef`, o relógio que pausa |
| `.queue` — fila de recados | 13 (92 linhas) | `Popover` + `ScrollArea` + `ItemGroup` + `Empty` + `Badge` | estado vazio, rolagem, contador |
| `.wave` — onda do áudio | 8 | **nenhum** | — |
| `.desk` — layout web | 8 | `Card` | — |
| `.stack` — pilha de chamadas | 6 | `Popover` + `ScrollArea` + `Avatar` | — |
| `.incoming` — chamada recebida | 6 | `Card` + `ButtonGroup` + `Progress` | a barra de expiração vira `Progress` |
| `.field` | 6 | `Field` + `Input` | rótulo, descrição, `aria-invalid` |
| `.thinking` — três pontinhos | 4 | `Spinner` | a `@keyframes thinking` |
| `.pill` | 4 | `Badge` ou `Button size="sm"` | — |
| `.timer` — filete de tempo | 3 | `Progress` | a `@keyframes timer-run` e o `--timer-ms` |
| `.swatches` — cores | 3 + 1 | `ToggleGroup` | estado ativo, teclado |
| `.round` | 3 | `Button size="icon"` | — |
| `.gear` — engrenagem | 3 | `Button variant="ghost"` + `Tooltip` | — |
| `.disc` — avatar do agente | 3 | `Avatar` + `AvatarFallback` | o componente `AgentDisc` e o `initialOf` inteiros |
| `.shell` | 4 | layout | — |
| lembrete de teclas | — | `HoverCard` + `Kbd` | o estado `hintOpen` |

## O que NÃO tem pronto — e é honesto dizer

**1. A barrinha que se expande no hover.** Não existe em nenhum registro
(`@shadcn`, `@magicui`, `@kibo-ui`, `@aceternity`, `@bundui`). O mais próximo é
o `@magicui/dock` e o `@aceternity/floating-dock`, que são outra coisa: uma
doca com ícones que crescem sob o cursor, não um chip que revela conteúdo.
As **partes** são prontas (`Button`, `Avatar`, `Badge`); o comportamento de
abrir são ~15 linhas de Tailwind sobre um `data-state`.

**2. As três barrinhas de onda.** É uma animação de 20 linhas com
`@keyframes`. Nenhum registro tem equivalente e não deveria ter — é identidade
visual, não componente.

**3. A alça de arrastar (`-webkit-app-region`).** É uma propriedade do Electron,
não um componente. Continua sendo CSS à mão, e continua sendo a origem do
problema de hover descrito em `docs/` — ver a seção final.

## O comparativo, no código real

A fila de recados, hoje: **56 linhas de JSX + 92 linhas de CSS**.

```tsx
<div className="queue" role="dialog" aria-label="Recados dos agentes">
  <div className="queue__head">
    <span className="eyebrow">Recados</span>
    <span className="queue__tools">
      {messages.length > 0 && (
        <button type="button" className="queue__clear" onClick={…}>Limpar</button>
      )}
      <button type="button" className="menu__tool" onClick={…} title="Fechar">
        <CloseIcon />
      </button>
    </span>
  </div>

  {messages.length === 0 ? (
    <p className="queue__empty">Nenhum recado por enquanto.</p>
  ) : (
    <ul className="queue__list">
      {messages.map((message) => (
        <li key={message.id} className="queue__item">
          <span className="queue__line">
            <AgentDisc name={…} color={…} src={…} size={20} />
            <span className="queue__who">{nameOf(message.agentSlug)}</span>
            <span className="queue__at">{formatClock(message.at)}</span>
            <button type="button" className="menu__tool" onClick={…}>
              <CloseIcon />
            </button>
          </span>
          <span className="queue__text">{message.text}</span>
        </li>
      ))}
    </ul>
  )}
</div>
```

A mesma fila, só com peça pronta: **34 linhas de JSX + zero linha de CSS**.
(O `Popover` daqui não sobreviveu ao contato com a janela do Electron — o
código final usa a mesma composição em fluxo. Ver **Feito**.)

```tsx
<Popover open={queueOpen} onOpenChange={setQueueOpen}>
  <PopoverContent className="w-68 p-0" align="end" side="top">
    <div className="flex items-center justify-between p-3">
      <span className="text-muted-foreground text-xs uppercase">Recados</span>
      {messages.length > 0 && (
        <Button variant="ghost" size="sm" onClick={onClearMessages}>Limpar</Button>
      )}
    </div>
    <Separator />

    {messages.length === 0 ? (
      <Empty className="py-8">
        <EmptyDescription>Nenhum recado por enquanto.</EmptyDescription>
      </Empty>
    ) : (
      <ScrollArea className="max-h-80">
        <ItemGroup>
          {messages.map((message) => (
            <Item key={message.id} size="sm">
              <ItemMedia>
                <Avatar className="size-5">
                  <AvatarImage src={avatarOf?.(message.agentSlug)} />
                  <AvatarFallback>{initialOf(nameOf(message.agentSlug))}</AvatarFallback>
                </Avatar>
              </ItemMedia>
              <ItemContent>
                <ItemTitle>
                  {nameOf(message.agentSlug)}
                  <span className="text-muted-foreground ml-2 font-normal">
                    {formatClock(message.at)}
                  </span>
                </ItemTitle>
                <ItemDescription>{message.text}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button variant="ghost" size="icon-sm" onClick={() => onDismissMessage?.(message.id)}>
                  <XIcon />
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      </ScrollArea>
    )}
  </PopoverContent>
</Popover>
```

Nesse pedaço: 148 linhas viram 34, e chegam de graça o fechamento no `Esc`, o
clique fora, o retorno do foco para quem abriu, a navegação por teclado e a
rolagem que não come 15px do conteúdo.

Multiplicando pelas 19 superfícies com equivalente pronto, a estimativa é
**2 134 linhas de CSS → ~150** (os tokens do tema, a onda, o chip e a alça de
arrastar).

## O que isto conserta que não é estética

Três problemas do código de hoje somem porque o componente pronto já resolveu:

**Hover intent.** O `HoverCard` e o `Popover` do Radix têm `openDelay` e
`closeDelay` embutidos, e tratam o caminho do cursor entre o gatilho e o
conteúdo. É exatamente o que o `CallingBar` faz à mão com `hoverTimerRef`,
`menuTimerRef`, `openedByHoverRef`, `closedAtRef` e um guarda de 600 ms.

**Relógio que pausa.** O `sonner` já tem duração por toast, pausa quando o mouse
entra e fila quando chegam vários. Hoje isso é `replyHeld`, `replyLeftRef`, dois
`useEffect` e uma `@keyframes` com `animation-play-state`.

**Foco e teclado.** Nenhum dos menus de hoje devolve o foco para quem os abriu,
e a lista de agentes não anda com as setas. Nos primitivos do Radix isso não é
uma funcionalidade a implementar — é o padrão.

## O que custa

| Custo | Estimativa |
| --- | --- |
| Tailwind v4 + `@radix-ui/*` (≈14 pacotes) + `lucide-react` | +45 a 70 kB gz sobre os 148 kB gz de hoje |
| Reescrita de JSX | ~1 600 linhas em 6 arquivos |
| Risco | o Electron: a janela tem o tamanho do conteúdo, e `Popover`/`Sheet` renderizam em portal no `body` — **fora do `#root` que é medido**. Precisa de um `container` explícito apontando para dentro do `#root`, senão o menu nasce fora da janela |

Esse último ponto é o único de verdade técnico, e já foi encontrado antes: o
`styles.css` tem um comentário dizendo que o menu já nasceu cortado uma vez por
estar posicionado fora da caixa medida. Todo componente de overlay do shadcn
aceita `container` no `Portal` — a solução é uma linha, mas precisa estar na
cabeça desde o primeiro componente.

## Para distribuir

Feito. O repositório publica um registro shadcn próprio, e qualquer projeto
instala as peças do Calling pelo CLI de sempre:

```bash
npx shadcn@latest add https://calling.sincronia.digital/r/calling-bar.json
```

Cinco itens em `web/registry.json`:

| Item | O que é |
| --- | --- |
| `calling-theme` | os tokens escuros e as utilidades que não têm equivalente |
| `agent-avatar` | o disco do agente (imagem, ou a inicial na cor dele) |
| `calling-bar` | a coluna inteira: chip, menu, fila, balão, campo, chamada recebida |
| `agent-panel` | nome, cor e imagem de um agente |
| `connect-screen` | a tela de conexão, nos dois estados |

`npm run build` roda `shadcn build` antes do Vite, então os JSONs saem em
`web/dist/r/` e o deploy os serve junto do app. Para gerar só o registro:

```bash
npm run registry --workspace=web
```

## Feito

Todos os passos foram aplicados. O `styles.css` não existe mais.

1. ✅ `npx shadcn@latest init --preset nova --base radix` no workspace `web`.
2. ✅ Tokens portados para `:root`/`.dark` em `src/index.css`, com os nomes que
   os componentes leem. O visual aprovado no canvas `plan-001` fica igual, e
   `--primary` virou neutro: o verde era a cor do agente padrão, não a cor do
   app.
3. ✅ `ConnectScreen` e `ConfigPanel`.
4. ✅ `AgentPanel`.
5. ✅ `.notice`, `.bubble` e `.change` — **sem `sonner`**, pelo motivo da seção
   seguinte. O conteúdo é `Item`/`Badge`/`Avatar`; o relógio continua sendo uma
   `@keyframes`, que é o que pausa no hover sem um `requestAnimationFrame`.
6. ✅ `.menu`, `.queue` e `.stack` — `Item`/`ItemGroup`/`Empty`/`ScrollArea`,
   **em fluxo, sem `Popover`**.
7. ✅ `.chip`, `.wave`, `.incoming`, `.compose`, `.desk`, `.gear`, `.shell`.
8. ✅ `registry.json`.

### A descoberta que mudou o plano: nada de `Popover`, `Sheet` nem `sonner`

O risco que este documento previa era o portal: overlays do Radix renderizam no
`body`, fora do `#root` que o Electron mede. A solução proposta era passar
`container`. **Ela não resolve.**

Todo overlay faz *duas* coisas: sai para um portal **e** se posiciona com
`position: absolute`. Mesmo ancorando o portal dentro do `#root`, um filho
posicionado fora da caixa não entra no `getBoundingClientRect()` do pai. A
janela não cresce, e o menu nasce pintado fora dela, cortado. O `sonner` cai na
mesma armadilha: `Toaster` é `position: fixed` num portal.

Então tudo o que abre na barra fica **em fluxo**, nesta coluna. O que é
componente pronto não é o posicionamento — é o conteúdo. Uma janela que tem o
tamanho do próprio conteúdo é o caso em que "use o overlay pronto" está errado,
e o `className` fazendo layout é exatamente o que o `className` deve fazer.

### A segunda pegadinha: o Tailwind reordena as utilidades

`@utility reveal` e `@utility reveal-open` pareciam funcionar. Não
funcionavam: o Tailwind v4 ordena as utilidades geradas por conta própria, e
escrevia `.reveal-open` **antes** de `.reveal` — o chip nunca abria, e nada no
código dizia por quê.

O conserto é não depender de ordem: o estado virou um atributo
(`&[data-open='true']` dentro da própria utilidade), que tem especificidade
maior. Vale para qualquer par base/modificador escrito à mão.

### O que sobrou de CSS, e por quê

**Oito utilidades**, em `src/index.css`, e cada uma tem um motivo que não é
preguiça:

| Utilidade | Por que não tem pronto |
| --- | --- |
| `timer-track`, `timer-fill`, `timer-held` | o filete pausa por `animation-play-state`, junto com o relógio do JS — sem estado a mais e sem `requestAnimationFrame` |
| `wave` | as três barrinhas do áudio: identidade visual, não componente |
| `reveal`, `reveal-text` | o chip que revela conteúdo. `dock` e `floating-dock` são outra coisa: ícones que crescem sob o cursor |
| `app-drag`, `app-no-drag` | `-webkit-app-region`: é Electron, não interface |

Mais as regras de janela (transparência, `#root` do tamanho do conteúdo, a faixa
de 8px que arrasta). Também Electron.

### O placar, medido

| | Antes | Depois |
| --- | --- | --- |
| CSS à mão | 2 134 linhas | 382 (tokens + 8 utilidades + regras de janela) |
| Seletores de topo | 234 | 8 utilidades + 6 regras de janela |
| Código em `web/src` | 5 794 linhas | 4 621 (sem contar `components/ui`) |
| Componentes prontos | 0 | 25 |
| JS (gzip) | 148,06 kB | 203,01 kB |
| CSS (gzip) | 63,78 kB | 42,23 kB |
| **Total (gzip)** | **211,84 kB** | **245,24 kB (+33,4)** |

O acréscimo ficou **abaixo** da estimativa de 45–70 kB, porque o CSS encolheu
21,55 kB ao mesmo tempo. Parte disso veio de trocar a Geist estática em três
pesos pela versão variável — um arquivo no lugar de três.

### Como conferir sem subir o Electron

A barra e os painéis só existem dentro do app de desktop, o que na prática
queria dizer não conferir o desenho. `src/Preview.tsx` põe os dezoito estados
lado a lado com dados de mentira:

```bash
npm run dev --workspace=web
```

Depois, `http://localhost:5173/?preview=panels`. Só funciona em
desenvolvimento — `import.meta.env.DEV` é constante, e o bundler corta a
bancada inteira do build.

## A parte que shadcn não resolve

O hover irregular da barrinha **não é um problema de componente**. A causa está
na conversa entre a página e a janela do Electron: o chip anima a largura em
240 ms, o `ResizeObserver` do `DesktopGate` disparava a cada quadro dessa
animação, e cada disparo redimensionava a janela por IPC. A janela encolhia
debaixo do cursor no meio do fechamento, o ponto onde o mouse estava saía da
janela, o chip recebia um `pointerleave`, e o quadro seguinte devolvia um
`pointerenter` — a barra abrindo e fechando sozinha.

Agravado por dois detalhes: o `.chip` era ao mesmo tempo o alvo do hover e a
região de arraste (`-webkit-app-region: drag`), que o Windows re-avalia a cada
mudança de geometria; e a zona de hover era o chip, enquanto o menu, o balão e o
campo de escrever são irmãos dele, separados por 8px de `gap` — atravessar esse
vão já era sair da zona.

O conserto (já aplicado) tem três partes:

- `DesktopGate.tsx`: a janela **cresce na hora e só encolhe depois de 280 ms de
  conteúdo parado**, com os disparos do observador agrupados por quadro. Uma
  janela maior que o conteúdo é invisível (ela é transparente), então segurar o
  encolhimento não custa nada e corta o laço.
- `CallingBar.tsx`: a zona de hover passou a ser a `.bar` inteira — que engloba
  o chip, o menu, o balão e o vão entre eles, e não é região de arraste.
- `CallingBar.tsx`: intenção de hover — 90 ms para acender, 260 ms para apagar,
  160 ms para o chevron abrir a lista. Qualquer tremida de 1px é absorvida.
