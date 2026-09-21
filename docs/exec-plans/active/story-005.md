# US-005 — Escrever para o agente e ler a resposta, que some sozinha

**Status:** implemented — aguardando smoke no app de desktop com o bridge (ver .sincron-auto/report.md)
**Parent plan:** docs/exec-plans/plans/plan-001-barra-conversa.md
**Created:** 2026-09-20
**Updated:** 2026-09-20

## Persona

Como **o dono do Calling, com um pedido curto para fazer sem ligar**

## Job-to-be-done

Quero **digitar uma mensagem na barra e ver a resposta do agente logo acima** para **resolver uma coisa rápida sem abrir voz e sem sair do que estou fazendo**

## Dependências

- **Depende de:** US-001, US-004, US-006
- **Bloqueia:** nenhuma

## Contexto técnico

Decisão do dono: **uma resposta só, que some sozinha.** Sem histórico, sem
rolagem, sem thread visível. O balão e o campo são filhos em fluxo da coluna
(regra de US-001), então a janela cresce e encolhe junto.

O lembrete de teclas fica **escondido atrás de um `i`** no canto superior direito
do campo: o tutorial aparece quando se procura por ele e some quando não.
Essa é a mesma ideia da engrenagem que só aparece no hover — o widget é quieto
em repouso.

O envio usa `POST /api/message` (US-006), não `/api/ask` — `/api/ask` é do
caminho de voz e amarra a sessão ao `callId`.

## Critérios de aceitação

### FUNCIONAL
- [ ] "escrever" na lista abre um campo de texto acima da barra, já com foco, dizendo para quem é ("Para · Automa")
- [ ] `Enter` envia; `Shift+Enter` quebra linha; `Esc` fecha o campo e descarta o rascunho
- [ ] As teclas NÃO ficam escritas na tela: elas vivem atrás de um `i` discreto no canto superior direito do campo
- [ ] Passar o mouse no `i` (ou alcançá-lo por Tab) mostra o lembrete; tirar o mouse o esconde
- [ ] O lembrete some sozinho e não muda o tamanho do campo ao aparecer
- [ ] Enquanto a resposta não chega, o campo fica desabilitado e a barra mostra que o agente está pensando
- [ ] A resposta aparece num balão acima do campo e some sozinha depois de 15 segundos
- [ ] Clicar no balão o fecha na hora; passar o mouse por cima segura o relógio enquanto ele estiver ali
- [ ] Mandar outra mensagem substitui o balão anterior — nunca há dois
- [ ] Erro do bridge (fora do ar, 401, timeout) aparece no mesmo lugar do balão, com o texto do erro, e o rascunho NÃO se perde
- [ ] Fechar o campo com uma resposta no ar não apaga o balão; ele segue seu próprio relógio

### VISUAL
- [ ] O balão tem no máximo 280px de largura e corta com reticências acima de 6 linhas
- [ ] O balão traz o nome e a cor do agente que respondeu
- [ ] Campo e balão usam o mesmo material da barra; a janela segue transparente fora deles
- [ ] O `i` é discreto em repouso e acende no hover/foco, sem puxar o olho do campo

### COMPORTAMENTO
- [ ] Uma chamada recebida chegando com o campo aberto tem prioridade: o cartão entra e o rascunho é preservado para quando ele sair
- [ ] Com uma ligação de voz em curso, escrever não derruba a ligação
- [ ] Nada do que foi escrito ou respondido sobrevive ao fechamento do app: não há histórico em disco nem em `localStorage`

## Arquivos afetados
*(Construtor preenche após implementação.)*

Previsão: `web/src/CallingBar.tsx`, `web/src/App.tsx`, `web/src/bridge.ts`, `web/src/styles.css`.

## Histórico de tentativas

## Validation Log

| Round | Linters | Reviewers | LLM Judge | Result |
|---|---|---|---|---|
|       |         |           |           |        |

## Review Checklist

- [ ] docs/review-checklists/ (a criar)

## Compound Opportunity

"A conversa não é vista, só a última resposta" é uma decisão de produto forte e
deliberada. Vale em `docs/sincron/DECISIONS.md` com o porquê, senão alguém
"conserta" isso no futuro achando que faltou histórico.

## Lessons Captured

## Compound Decision

- Capture needed: yes
- Destination: docs/compound
- Reason: a ausência de histórico é escolha, não limitação — precisa ficar escrito
- Artifact: —
- Tier: 1
