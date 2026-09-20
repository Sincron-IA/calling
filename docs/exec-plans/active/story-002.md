# US-002 — Dá para arrastar a barra pegando nela

**Status:** pending
**Parent plan:** docs/exec-plans/plans/plan-001-barra-conversa.md
**Created:** 2026-09-20
**Updated:** 2026-09-20

## Persona

Como **o dono do Calling, com a barra parada num canto que não é o que ele quer**

## Job-to-be-done

Quero **arrastar a barra pegando em qualquer parte dela que não seja botão** para **botá-la onde ela não atrapalha**

## Dependências

- **Depende de:** nenhuma
- **Bloqueia:** nenhuma

## Contexto técnico

A única superfície com `-webkit-app-region: drag` hoje é o anel de 8px de
padding do `#root` (`web/src/styles.css:920`); todo filho direto recebe
`no-drag` (`web/src/styles.css:930`). O alvo é pequeno demais para acertar.

Correção: a área não interativa do chip (o fundo dele e as três barrinhas da
onda, `span.wave`) passa a ser `drag`; avatar, chevron, engrenagem, botões do
cartão de chamada e — quando existirem — a lista e o campo de digitação
continuam `no-drag`.

## Critérios de aceitação

### FUNCIONAL
- [ ] Pressionar e arrastar sobre a onda (as três barrinhas) ou sobre o fundo do chip move a janela
- [ ] Clicar no avatar continua ligando/desligando, sem mover a janela
- [ ] Clicar no chevron continua abrindo a lista, sem mover a janela
- [ ] Clicar na engrenagem continua abrindo o painel de conexão
- [ ] Nos botões do cartão de chamada recebida (Aprovar, atender, recusar) o clique continua chegando
- [ ] Depois de arrastar, a barra fica onde foi solta e volta a crescer a partir dali (a âncora acompanha)

### VISUAL
- [ ] O cursor vira o de mover sobre a área que arrasta
- [ ] Nada muda de aparência em repouso

### COMPORTAMENTO
- [ ] Um clique curto na área de arraste não dispara ação nenhuma
- [ ] Arrastar até a borda direita continua ligando o modo empilhado (`shell--stacked`)
- [ ] No navegador nada disso existe e nada quebra

## Arquivos afetados
*(Construtor preenche após implementação.)*

Previsão: `web/src/styles.css`, possivelmente `web/src/CallingBar.tsx`.

## Histórico de tentativas

## Validation Log

| Round | Linters | Reviewers | LLM Judge | Result |
|---|---|---|---|---|
|       |         |           |           |        |

## Review Checklist

- [ ] docs/review-checklists/ (a criar)

## Compound Opportunity

O par `drag` no fundo / `no-drag` em tudo que é clicável é receita de janela sem
moldura. Vale registrar.

## Lessons Captured

## Compound Decision

- Capture needed: no
- Destination: none
- Reason: aplica padrão conhecido de Electron, sem descoberta nova
- Artifact: —
- Tier: 1
