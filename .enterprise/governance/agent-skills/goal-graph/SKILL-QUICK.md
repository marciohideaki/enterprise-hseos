---
name: goal-graph
tier: quick
version: "1.1"
description: "Use when a user gives a complete objective (prompt/spec) and wants it compiled into an executable graph of loops — parallel across independent nodes, dynamic where structure is unknown, confronted with the codebase via gap-map — ready for Workflow (workflow.js), dev-squad or goal-loop execution."
license: Apache-2.0
metadata:
  owner: platform-governance
---

# Goal Graph — Quick Reference

## Propósito

Transformar um objetivo completo (prompt + arquivos) num **grafo de loops** executável: nós verificáveis, arestas de dependência, paralelismo entre nós independentes, expansão dinâmica onde a estrutura é desconhecida, **confrontado com o codebase (gap-map)**. Emite `GOAL-GRAPH.md` + `workflow.js` para o runtime `Workflow` (preferido — coordenação em código, zero turnos), `dev-squad` (waves) ou `hseos-goal-loop` (loop) executar sob guardrails. **Planeja, não executa.**

## Sequência

1. **Intake** — ler o prompt E todo arquivo citado; escopo, constraints, autoridade, evidência esperada.
1-bis. **Entender & Confrontar (diamond)** — health-gate axon (índice ≤24h, nunca degradar em silêncio) → capsule/pivots → fan-out de leitores (schema `{observado, inferido, não-verificado, riscos}`) → barrier de confronto → **GAP-MAP** (existe / conflita / falta / assume-errado). Alimenta a decomposição e o gate humano.
2. **Nós** — decompor em mini-goals verificáveis: escopo fechado, aceitação, `verify_step`, tier, budget, domínio de risco.
3. **DAG** — mapear dependências → camadas topológicas + caminho crítico (ciclo = erro).
4. **Classificar fluxo** — estático (conhecido) vs dinâmico (descoberta que expande o grafo); todo dinâmico exige stop condition.
5. **Paralelismo** — nós independentes da mesma camada em paralelo; worktree por nó se mutam o FS; pipeline por default, barreira só p/ dedup/merge global; ≤ capacidade do host (§3f).
6. **Guardrails por nó** — `loop-guard` (scope+budget+heartbeat/alertas) · `anchor-guard` · verificador determinístico ou adversarial isolado · rollback (worktree, 1 nó=1 commit) · gate humano por domínio.
7. **Emitir `GOAL-GRAPH.md`** — veredito, gap-map, objetivo, nós, DAG (mermaid), fluxos dinâmicos, gates, execution protocol, DoD.
7-bis. **Compilar `workflow.js`** — nó→`agent({schema, model, effort})`; camada→`pipeline()` (barreira só justificada); dinâmico→loop-until-dry (dedupe vs `seen`); verify→N céticos independentes; mutação→worktree; budget→`budget.remaining()`. Nó **idempotente**: consulta checkpoint `(node_id, input_hash, baseline_ref)` antes de gastar; retomar = rodar de novo. Ferramentas pelo PATH; emitir ≠ executar.
8. **Handoff** — Workflow (workflow.js, preferido) · dev-squad/SWARM (paralelo PR-driven) · hseos-goal-loop (sequencial).

## Primitivas de fluxo

| Primitiva | Quando |
|---|---|
| **estático** | estrutura do nó conhecida a priori |
| **dinâmico: discovery→expand** | um nó descobre a lista de subnós em runtime |
| **loop-until-dry** | descoberta de tamanho desconhecido; para após K rodadas secas |
| **fan-out por item** | 1 subnó por item descoberto, em paralelo |
| **adversarial-verify** | cada resultado julgado por nó cético independente |
| **pipeline (default)** | itens fluem pelas etapas sem barreira |
| **barreira** | só quando o próximo nó precisa de TODOS os resultados anteriores |

## Hard gates

- Deploy/merge/secret/schema/infra/escrita externa = **gate humano**, definido ANTES de ligar.
- Nenhum nó toca âncoras (constituição/specs/policies/guards) — `ANCHOR_OVERRIDE` só humano.
- Todo nó dinâmico tem stop condition (superfície esgotada / K rodadas secas / budget).
- Verificador ≠ executor; paralelismo com mutação de FS ⇒ worktree.
- Health-gate axon antes de explorar; decompor sem gap-map = plano por suposição.
- Nó com efeito colateral separa decisão de execução e checa "já fiz?" (resume não pode duplicar efeito).
- goal-graph emite o grafo; **ligar a execução é ato humano/autorizado** (compilar workflow.js NÃO executa).

## Saída

```markdown
GOAL-GRAPH — {objetivo}
Gap-map: {existe / conflita / falta / assume-errado}
Nós: {N} em {C} camadas (paralelismo: {…})
Dinâmicos + stop: {…}   Gates humanos: {domínios}
Runtime: {Workflow (workflow.js) | dev-squad | hseos-goal-loop}   Artefatos: {GOAL-GRAPH.md · workflow.js}
```

Carregue a skill completa para decompor um objetivo real, montar o DAG e anexar os guardrails por nó.
