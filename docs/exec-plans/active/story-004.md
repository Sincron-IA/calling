# US-004 — Na lista, escolher entre escrever e ligar

**Status:** implemented — aguardando smoke no app de desktop com o bridge (ver .sincron-auto/report.md)
**Parent plan:** docs/exec-plans/plans/plan-001-barra-conversa.md
**Created:** 2026-09-20
**Updated:** 2026-09-20

## Persona

Como **o dono do Calling, que nem sempre quer falar em voz alta**

## Job-to-be-done

Quero **escolher, na própria lista de agentes, entre escrever e ligar** para **mandar um recado rápido sem abrir uma ligação**

## Dependências

- **Depende de:** US-001
- **Bloqueia:** US-005

## Contexto técnico

O ícone de "escrever" é um **aviãozinho de enviar**, não um lápis: o que a ação faz
é despachar um recado para o agente, não editar um texto parado.

Hoje a linha inteira do menu é um botão que liga (`web/src/CallingBar.tsx:393-407`).
A linha deixa de ser clicável e passa a carregar dois botões nomeados. O agente
do chip (o atual) também precisa alcançar as duas ações — hoje `others` o exclui
da lista (`web/src/CallingBar.tsx:235`), e ele só tem o clique no avatar, que liga.

## Critérios de aceitação

### FUNCIONAL
- [ ] Cada linha da lista mostra o nome do agente, um botão "escrever" e um botão "ligar"
- [ ] "ligar" faz exatamente o que o clique na linha fazia antes: fecha a lista e abre a ligação
- [ ] "escrever" fecha a lista e abre a barra de digitação já endereçada àquele agente (o campo em si é US-005)
- [ ] O agente atual aparece na lista também, marcado como atual, com as mesmas duas ações
- [ ] Teclado alcança os dois botões de cada linha na ordem visual, e `Esc` fecha a lista

### VISUAL
- [ ] O ponto colorido de cada agente continua como é hoje
- [ ] "escrever" é um aviãozinho de enviar; "ligar" é o telefone que já existe no cartão de chamada recebida
- [ ] Os dois botões são ícones com rótulo acessível (`aria-label`), e ganham fundo no hover/foco
- [ ] A lista não passa de 220px de largura

### COMPORTAMENTO
- [ ] Com uma ligação em curso, "ligar" em outro agente continua derrubando a atual antes de abrir a nova (`App.tsx:106`)
- [ ] Com uma ligação em curso, "escrever" NÃO derruba a ligação
- [ ] Clicar no avatar do chip continua sendo ligar/desligar, sem mudança

## Arquivos afetados
*(Construtor preenche após implementação.)*

Previsão: `web/src/CallingBar.tsx`, `web/src/styles.css`, `web/src/App.tsx`.

## Histórico de tentativas

## Validation Log

| Round | Linters | Reviewers | LLM Judge | Result |
|---|---|---|---|---|
|       |         |           |           |        |

## Review Checklist

- [ ] docs/review-checklists/ (a criar)

## Compound Opportunity

Decisão de não trocar o significado de um clique existente ao acrescentar uma
ação mais barata. Vale como nota de produto.

## Lessons Captured

## Compound Decision

- Capture needed: yes
- Destination: docs/compound
- Reason: a escolha de manter "clique = ligar" e nomear as duas ações explicitamente é a parte reutilizável
- Artifact: —
- Tier: 1
