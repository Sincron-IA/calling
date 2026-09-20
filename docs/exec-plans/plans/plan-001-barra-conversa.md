# plan-001 — A barra deixa de ser só um botão de ligar

**Status:** active
**Created:** 2026-09-20
**Updated:** 2026-09-20
**Stories:** US-001 … US-009

## O problema, como o dono descreveu

Primeiro uso real do app de desktop no Windows, com o bridge já conectado. Três
coisas quebradas e quatro coisas que faltam:

1. Clicar no chevron não abre a lista de agentes — aparece só um retângulo
   cinza no canto de cima ("um shadow").
2. A janela não se deixa arrastar.
3. Conectar não avisa nada: a tela de conexão some e a barra aparece, e não há
   como saber que o sistema está pronto para conversar.
4. Falta poder ESCREVER para um agente, não só ligar. E poder escolher entre as
   duas coisas ali mesmo na lista.
5. Falta a barra de digitação e o lugar onde a resposta do agente aparece.
6. O que se escreve pelo Calling precisa existir na thread do agente — hoje a
   ligação vive numa sessão isolada e a thread do Telegram nunca fica sabendo.

## Causa-raiz das três quebras (investigada no código, não suposta)

### O menu nasce fora da janela

`.menu` é `position: absolute; bottom: calc(100% + 10px)` (`web/src/styles.css:289`).
Quem manda o tamanho da janela para o processo principal é o `ResizeObserver` do
`DesktopGate` (`web/src/DesktopGate.tsx:105`), e ele mede
`#root.getBoundingClientRect()` — que é a caixa de borda do `#root` e **ignora
qualquer filho posicionado por fora dela**. Resultado: a janela continua do
tamanho do chip, o menu é pintado acima dele, fora dos limites da janela, e o
`overflow: hidden` de `body.desktop-main` (`styles.css:914`) corta o que sobra.
O cinza que o dono viu é o `box-shadow` do menu vazando nos 8px de padding.

Isso não é um bug do menu: é um bug da regra "a janela tem o tamanho do
conteúdo". Qualquer coisa que cresça para cima — o menu, o balão de resposta, a
barra de digitação, o aviso de pronto — cai na mesma armadilha. Por isso US-001
vem primeiro e as outras três dependem dela.

### Não há por onde pegar a janela

A única superfície com `-webkit-app-region: drag` é o anel de 8px de padding do
`#root` (`styles.css:920`), e todo filho direto é `no-drag` (`styles.css:930`).
Oito pixels em volta de um chip de ~40px de altura é um alvo que o mouse não
acerta.

### Conectar é silencioso

`DesktopGate` só troca `connected` de `false` para `true` (`DesktopGate.tsx:203`)
e a árvore inteira é substituída. Não existe aviso nenhum.

## As decisões deste plano

### O conteúdo que cresce para cima entra no layout (US-001)

Em vez de ensinar o `ResizeObserver` a somar retângulos de elementos
posicionados — que teria de ser refeito a cada novo overlay —, o menu, o balão,
a barra de digitação e o aviso passam a ser **filhos em fluxo** de uma coluna
que termina no chip. A janela cresce sozinha, porque `getBoundingClientRect()`
do `#root` passa a incluí-los, e a âncora de canto inferior direito já existente
faz a janela crescer para cima e para a esquerda, como um widget de bandeja.

Alternativa rejeitada: reportar a união dos retângulos (`#root` + overlays
abertos). Funciona, mas é uma conta nova a cada overlay novo, e o `no-drag` e o
`:hover` teriam de ser mantidos à mão em cada um.

### Escrever e ligar são duas ações explícitas (US-004)

Hoje clicar numa linha do menu liga (`CallingBar.tsx:398`). Escrever é a ação
mais barata e vai ser a mais frequente; se ela virasse o clique padrão, todo
mundo que hoje clica para ligar ligaria errado. Então a linha deixa de ser
clicável e ganha dois botões nomeados: escrever e ligar.

### A resposta aparece e some (US-005)

Decisão do dono: um balão só, com a última resposta, que desaparece sozinho.
Sem histórico e sem rolagem — a conversa completa não é para ser vista por
enquanto. Isso também mantém a janela pequena.

### O texto tem sessão própria e persistente (US-006)

A ligação hoje abre uma sessão por `callId` e a joga fora no `end-call`
(`server/src/claude.ts:49`). Texto não tem "chamada": a sessão passa a ser por
AGENTE e sobrevive entre mensagens, senão cada frase escrita começaria do zero.
Voz e texto do mesmo agente compartilham essa sessão, então dá para ligar
perguntando sobre o que foi escrito dez minutos antes.

### O Telegram fica sabendo — pelo bridge, não pelo agente (US-007)

O dono perguntou se dá para colocar no Telegram. **Dá** — só que não pelo
caminho óbvio. Dentro da sessão headless a tool de reply do Telegram não existe;
a identidade de voz diz isso com todas as letras (`server/src/identity.ts:22`) e
existe justamente porque o agente tentava chamá-la e errava a resposta.

Quem manda o recado é o BRIDGE, direto na Bot API do Telegram, assim que uma
mensagem chega pelo Calling — antes mesmo de o agente responder. Blockquote é
suportado nativamente (`parse_mode: HTML`, tag `<blockquote>`).

Limitação honesta: de qual bot e de qual chat cada agente fala é coisa que mora
na VPS, não neste repositório. US-007 começa por descobrir isso; enquanto não
houver credencial para um agente, o eco é pulado em silêncio (com log) e a
mensagem segue normalmente.

Escopo: só mensagem de TEXTO. Ecoar cada turno de uma ligação de voz encheria a
thread de linguiça.

## Revisão do dono (20/09) — três ajustes

1. **O ícone de escrever é um aviãozinho de enviar**, não um lápis. A ação
   despacha um recado; não edita um texto parado. (US-004)
2. **O lembrete de teclas fica escondido atrás de um `i`** no canto superior
   direito do campo, e só aparece no hover ou no foco. O widget é quieto em
   repouso — mesma ideia da engrenagem. (US-005)
3. **A identidade visual de cada agente passa a ser editável dos dois lados.**
   Virou US-008 e US-009.

### A identidade do agente, nas duas direções (US-008, US-009)

Hoje a identidade visual está partida em três pedaços que não conversam:
`agents.json` tem `color`, `publicAgentList()` devolve `color`, `AgentSummary`
declara `color` — e a UI ignora os três e pinta por POSIÇÃO na lista
(`agentColor(index)`, `web/src/agents.ts:16`). Imagem não existe: o avatar é a
inicial do nome.

A decisão que destrava as duas direções de uma vez: **a identidade mora num
arquivo no workspace do agente**, não no `agents.json`. O agente já tem permissão
de escrita ali, então "o agente se reconfigura" não precisa de rota nenhuma — ele
edita o próprio arquivo. E o app editar aquele mesmo arquivo pelo bridge é a
outra ponta da mesma coisa.

`agents.json` continua sendo o registro (slug, workspace, enabled). O `slug`
continua sendo a chave estável: o nome de exibição pode mudar sem quebrar
ligação, toque ou sessão de texto.

O caminho de rede é o de sempre — HTTPS pelo túnel do Cloudflare, cookie do
Access mais chave do app. Nenhuma porta nova. Para a volta (o agente mudou algo),
o bridge vigia os arquivos e empurra o aviso pelo SSE que já existe, com um tipo
de evento novo, em vez de abrir um segundo canal.

Duas coisas novas para este projeto entram aqui e são as que pedem mais cuidado:
é a **primeira escrita em disco** e o **primeiro upload** do Calling. A imagem é
re-encodada no servidor em vez de gravada como chegou, e servida com tipo que o
navegador não executa.

## O que este plano NÃO faz

- Não mexe no caminho de voz (Gemini Live, `/api/gemini-live-token`, `/api/ask`).
- Não traz a conversa completa para a tela.
- Não entrega a mensagem na sessão viva que atende o Telegram — a decisão de
  2026-09-19 rejeitou os sockets `/tmp/cc-socks/*.sock` de propósito, e nada
  aqui a reabre.
- Não resolve múltiplos monitores, que segue sem teste desde `ab2e61b`.

## Ordem

```
US-001 (janela cresce)  ──► US-003 (aviso de pronto)
                        ├─► US-004 (lista com duas ações) ──► US-005 (digitar e ler)
US-002 (arrastar)                                                     │
US-006 (sessão de texto no bridge) ───────────────────────────────────┤
US-007 (eco no Telegram) ─────────────────────────────────────────────┘

US-008 (identidade vem do agente) ──► US-009 (editar dos dois lados)
```

US-002 é independente das outras. US-005 precisa de US-001, US-004 e US-006.
US-008 não depende de nada e pode andar em paralelo; US-009 depende dela e
encosta em US-004, porque a edição é alcançada pela linha da lista.
