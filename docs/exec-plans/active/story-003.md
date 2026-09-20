# US-003 — Conectar avisa que o sistema está pronto

**Status:** pending
**Parent plan:** docs/exec-plans/plans/plan-001-barra-conversa.md
**Created:** 2026-09-20
**Updated:** 2026-09-20

## Persona

Como **o dono do Calling, logo depois de passar pelo login do Cloudflare**

## Job-to-be-done

Quero **um aviso curto de que o sistema está pronto** para **saber que já posso falar com os agentes, em vez de adivinhar pelo sumiço da tela de conexão**

## Dependências

- **Depende de:** US-001
- **Bloqueia:** nenhuma

## Contexto técnico

Hoje `DesktopGate` apenas troca `connected` para `true` (`web/src/DesktopGate.tsx:203`)
e a árvore inteira é substituída pela barra. Não há aviso nenhum.

O aviso é um bloco em FLUXO acima da barra (regra de US-001), some sozinho e
não deixa buraco no layout quando sai.

## Critérios de aceitação

### FUNCIONAL
- [ ] Ao conectar com sucesso, aparece acima da barra um aviso com o número de agentes disponíveis (ex.: "Pronto. 6 agentes na linha.")
- [ ] O aviso some sozinho depois de 5 segundos
- [ ] Clicar no aviso o fecha na hora
- [ ] O aviso aparece só na conexão feita pelo botão; a reconexão silenciosa da abertura do app (cookie ainda válido) não mostra nada
- [ ] Se a conexão der certo mas o bridge devolver zero agentes, o texto diz isso em vez de mentir um número

### VISUAL
- [ ] Mesmo material da barra (fundo, borda, raio), largura no máximo a da lista de agentes
- [ ] A janela cresce para caber o aviso e volta ao tamanho do chip quando ele sai, sem a barra escorregar

### COMPORTAMENTO
- [ ] Uma chamada recebida chegando enquanto o aviso está no ar tem prioridade: o aviso sai e o cartão de chamada entra
- [ ] Com `prefers-reduced-motion`, o aviso entra e sai sem animação de deslize

## Arquivos afetados
*(Construtor preenche após implementação.)*

Previsão: `web/src/DesktopGate.tsx`, `web/src/CallingBar.tsx`, `web/src/styles.css`.

## Histórico de tentativas

## Validation Log

| Round | Linters | Reviewers | LLM Judge | Result |
|---|---|---|---|---|
|       |         |           |           |        |

## Review Checklist

- [ ] docs/review-checklists/ (a criar)

## Compound Opportunity

Primeiro aviso efêmero do app. O mesmo componente serve o balão de resposta de
US-005 — vale nascer genérico.

## Lessons Captured

## Compound Decision

- Capture needed: no
- Destination: none
- Reason: componente de UI comum, sem decisão arquitetural
- Artifact: —
- Tier: 1
