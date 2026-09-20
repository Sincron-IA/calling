# US-001 — A janela cresce junto com o que abre por cima da barra

**Status:** pending
**Parent plan:** docs/exec-plans/plans/plan-001-barra-conversa.md
**Created:** 2026-09-20
**Updated:** 2026-09-20

## Persona

Como **o dono do Calling, usando o app de desktop no Windows**

## Job-to-be-done

Quero **que a lista de agentes (e qualquer coisa que abra acima da barra) apareça inteira** para **não ver um retângulo cinza cortado no lugar do menu**

## Dependências

- **Depende de:** nenhuma
- **Bloqueia:** US-003, US-004, US-005

## Contexto técnico

`.menu` é `position: absolute; bottom: calc(100% + 10px)` (`web/src/styles.css:289`).
O `ResizeObserver` de `web/src/DesktopGate.tsx:105` mede
`#root.getBoundingClientRect()`, que ignora filhos posicionados fora da caixa de
borda. A janela não cresce, o menu é pintado fora dela e `overflow: hidden`
(`web/src/styles.css:914`) corta. O cinza visível é o `box-shadow` do menu.

Correção: menu, balão, barra de digitação e aviso viram filhos EM FLUXO de uma
coluna que termina no chip, dentro do `#root`. No navegador o comportamento
continua o de hoje (a barra é `position: fixed` no canto da viewport), então a
mudança de fluxo é aplicada sem quebrar o caso do browser.

## Critérios de aceitação

### FUNCIONAL
- [ ] Clicar no chevron abre a lista com todos os agentes menos o atual, inteira, dentro da janela
- [ ] A janela do Electron cresce em altura para caber a lista e volta ao tamanho do chip quando ela fecha
- [ ] O canto inferior direito da janela não se move quando ela cresce ou encolhe (a âncora de `electron/main.js` continua valendo)
- [ ] `Esc` e clique fora fecham a lista e a janela encolhe de volta
- [ ] No navegador (`npm run dev`, sem Electron) a barra continua ancorada no canto e a lista continua abrindo por cima, como hoje

### VISUAL
- [ ] Nenhum retângulo, sombra ou faixa cinza aparece fora do cartão em qualquer estado
- [ ] A lista fica alinhada à direita, acima do chip, com o mesmo respiro de hoje (10px)
- [ ] A janela continua transparente: só o cartão pinta

### COMPORTAMENTO
- [ ] Abrir e fechar a lista várias vezes seguidas não deixa a janela com tamanho errado nem faz a barra escorregar pela tela
- [ ] Com a barra encostada na borda direita (`shell--stacked`), a lista continua inteira e dentro da área útil

## Arquivos afetados
*(Construtor preenche após implementação.)*

Previsão: `web/src/CallingBar.tsx`, `web/src/styles.css`, `web/src/DesktopGate.tsx`.

## Histórico de tentativas
*(Avaliador preenche a cada rodada.)*

## Validation Log

| Round | Linters | Reviewers | LLM Judge | Result |
|---|---|---|---|---|
|       |         |           |           |        |

## Review Checklist

- [ ] docs/review-checklists/ (a criar — não existe checklist neste projeto ainda)

## Compound Opportunity

A regra "nesta janela, o que cresce tem que estar no fluxo" vale para todo
overlay futuro do Calling. Candidata a virar linha em `docs/sincron/DECISIONS.md`
e checklist de frontend.

## Lessons Captured

## Compound Decision

- Capture needed: yes
- Destination: architecture
- Reason: a armadilha do `getBoundingClientRect()` numa janela do tamanho do conteúdo vai reaparecer em todo overlay novo
- Artifact: —
- Tier: 1
