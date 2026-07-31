# Manual de Grafos de Loops — HSEOS

> Manual de utilização da estrutura de grafos de loops: do objetivo à execução verificada, com estado versionado e retomada a qualquer momento. Provado em produção pelo loop-piloto N1 (2026-07-24, PR #121). Complementa — não substitui — o fluxo operacional de `docs/RUNNING-GOVERNED-LOOPS.md`.

---

## 1. Modelo mental (2 minutos)

- **Loop** é o átomo: `tentar → verificar → ajustar → repetir`, com critério de parada. Um loop sem verificador externo é o agente concordando consigo mesmo.
- **Grafo** é a composição: **nós** (mini-goals verificáveis, 1 job cada) ligados por **arestas** (dependências reais de dados), com **estado compartilhado** fluindo entre eles. Um loop é um grafo de 1 nó com aresta para si mesmo.
- **A aresta só existe se dado atravessa.** Todo "e depois" que não carrega dado é espera desperdiçada — nós independentes rodam em paralelo.
- **Quem executa nunca ratifica** (invariante G2). Verificação vive em contexto independente, com ground truth que o executor não controla.
- **Custo tem dois ralos independentes**: turnos de orquestração (cura: coordenação em código — runtime Workflow) e exploração de contexto (cura: axon com health-gate). Ver `_learnings` do vault: 71% do custo de um dia de goal-loops era polling do orquestrador.

## 2. Mapa de componentes (o que existe e onde)

| Componente | Path | Papel |
|---|---|---|
| Skill `goal-graph` v1.1 | `.enterprise/governance/agent-skills/goal-graph/SKILL.md` (Tier 1) → `.agents/skills/goal-graph/` (compilado) | **Compilador**: objetivo → gap-map → DAG de loops → `GOAL-GRAPH.md` + `workflow.js` |
| Skill `verifier` 1.0 | `.enterprise/governance/agent-skills/verifier/SKILL.md` | **Ratificador**: único papel que grava veredito terminal; determinístico primeiro; adversarial isolado senão |
| Skill `hseos-goal-loop` | `.enterprise/governance/agent-skills/hseos-goal-loop/` | Loop sequencial (discover→contract→execute→verify), discovery axon-first |
| dev-squad / SWARM | `.enterprise/governance/agent-skills/dev-squad/` + `.hseos/agents/swarm.agent.yaml` | Waves paralelas PR-driven (Commander Opus + Squad em worktrees), gates G1–G5 |
| Runtime `Workflow` | harness (Claude Code Dynamic Workflows) | Executa `workflow.js`: `agent()`/`pipeline()`/`parallel()`, budget, resume, cap 16 concorrentes |
| `loop-guard.sh` | `scripts/governance/loop-guard.sh` | Escopo imposto (diff ⊆ allow-list), budget de iterações, heartbeat + 3 alertas |
| `anchor-guard.sh` | `scripts/governance/anchor-guard.sh` | Nenhum loop toca constituição/specs/policies/manifest/hooks — só `ANCHOR_OVERRIDE=1` humano |
| `worktree-manager.sh` | `scripts/governance/worktree-manager.sh` | Isolamento por nó/loop: `create/validate/commit/merge/remove` (1 task = 1 branch `task/<id>`) |
| Verificador determinístico (exemplo) | `scripts/governance/verify-doc-facts.sh` | Recomputa a verdade por contagem — padrão a imitar para novos domínios |
| Layout de estado `_graph/` | `.enterprise/governance/agent-skills/goal-graph/templates/graph-state-layout.md` | Estado versionado por goal: events.jsonl (fonte) > SQLite (projeção) > markdown (render) |
| Autonomy kit (N1) | `.enterprise/governance/autonomy/` | Carta, allow-list e Readiness Gate para loops autônomos governados |
| Templates de prompt | vault `_prompts/18-22` | Anatomia de goal (ciclos, retomada, carta prompt-pointer) |

## 3. Escolher a rota

```
o objetivo é uma tarefa única sequencial?  ──sim──► hseos-goal-loop (ou execução direta)
        │não
decompõe em especialidades/paralelismo?    ──sim──► ROTA A: goal-graph → workflow.js   ◄─ default
        │não, mas é campanha autônoma
baixo risco + verificável objetivamente?   ──sim──► ROTA B: loop governado (N1-style)
        │entrega por waves com PR por wave          ROTA C: dev-squad / SWARM
```

Sinais de que o grafo vale a pena (precisa de ≥1, não de todos): fan-out real de trabalho independente · verificador dedicado ≠ executor · modelos/ferramentas diferentes por etapa · sobreviver a crash/pausa · aprovação humana no meio · auditabilidade por nó. **Sem nenhum desses sinais, grafo é overhead** — mantenha o loop.

## 4. ROTA A — objetivo → grafo compilado (o fluxo canônico)

### 4.1 Invocar

Na sessão do projeto-alvo:

```
/goal-graph <objetivo completo — prompt e/ou paths de spec>
```

ou "monte o grafo de loops para: <objetivo>". Variantes úteis: *"só o gap-map primeiro"* (para no confronto) · *"compila mas não roda"* (para no artefato) · *"roda com +200k de budget"* (teto de tokens na execução).

### 4.2 O que o sistema faz — fase Entender & Confrontar (goal-graph §1-bis)

1. **Health-gate do axon**: índice ≤24h e MCP/CLI respondendo? Senão reindexa ou declara fallback — nunca degrada em silêncio.
2. **Capsule** → pivots do codebase relevantes ao objetivo (pivots ruins = refinar query; pivot irrelevante compila nó errado).
3. **Fan-out de leitores** (tier barato, contexto fresco, schema `{observado, inferido, não-verificado, riscos}`) — leitor reporta o que o código É, não opina.
4. **Barrier de confronto** → **GAP-MAP**: o que JÁ EXISTE · o que CONFLITA · o que FALTA · o que o objetivo ASSUME ERRADO.

### 4.3 Gate humano nº 1 — confirmar (G2)

Você recebe gap-map + grafo proposto: tabela de nós (escopo fechado, critério de aceitação, `verify_step`, tier, budget, domínio de risco, estático/dinâmico), DAG em mermaid com camadas, stop conditions dos nós dinâmicos, e a linha auto↔humano por domínio. Aprova, ajusta ou mata. **Você aprova um plano confrontado com o código real.**

### 4.4 Artefatos (compilação, goal-graph §7/§7-bis)

```
<projeto>/_graph/<goal-id>/
  GOAL-GRAPH.md      ← contrato humano (veredito, gap-map, nós, DAG, gates, DoD)
  workflow.js        ← contrato executável (runtime Workflow)
  BASELINE.md        ← âncoras da realidade (r1: SHA, digests, versões)
  state/             ← events.jsonl (fonte) · checkpoints/ · STATE.md + RESUME-PROMPT.md (renders)
  evidencias/
```

Mapeamento mecânico no `workflow.js`: nó→`agent({schema, model, effort})` · camada→`pipeline()` (barreira SÓ justificada no GOAL-GRAPH) · dinâmico→loop-until-dry com dedupe vs `seen` · verificação→N céticos independentes por maioria · mutação de arquivos→`isolation:'worktree'` · budget→guard `budget.remaining()`. Ferramentas sempre pelo PATH (`hseos`, `axon`) — o script viaja com o projeto.

### 4.5 Gate humano nº 2 — ligar

**Compilar nunca executa.** O diálogo de permissão do Workflow é o ato de ligar. Aprovado, a frota roda com zero turno de orquestração; acompanhe com `/workflows`. Nós mutantes continuam passando por `loop-guard scope`/`anchor-guard` — a governança não sai do caminho, sai do custo.

### 4.6 Retomar, versionar, voltar no tempo

- **Retomar** (qualquer sessão/dia/máquina): rode o `workflow.js` de novo. Nó com checkpoint válido — chave `(node_id, input_hash, baseline_ref)` — retorna em ms; a execução continua do primeiro não-feito. Nó com efeito colateral separa decisão de execução e checa `idempotency_key`.
- **Baseline mudou** (push, novo SHA, schema): emitir `r(N+1)` em `BASELINE.md` com invalidação explícita do anterior → checkpoints do baseline velho invalidam em cascata → só re-executa o afetado. É o padrão RC do cambio-real generalizado: **certificação não atravessa mudança de baseline**.
- **Time-travel**: checkout/revert do `_graph/` para a tupla `(contrato, rN, evento)`; `events.jsonl` é append-only — o passado nunca é reescrito.
- Precedência de verdade: **git (events.jsonl) > SQLite (`hseos state-emit`) > markdown (renders)** — e checkpoint é dica: todo resume revalida as âncoras contra git/cluster antes de confiar.

### 4.7 Encerrar

DoD por nó e global (≥1 REPROVADO esperado no histórico — verificador que só aprova é teatro) → relatório antes/depois → **PR e merge são sempre humanos** → `/end-session` consolida no vault.

## 5. ROTA B — loop governado autônomo (N1-style)

Para campanhas de baixo risco com resultado objetivamente verificável (o "hello world" foi doc-only). Requisitos antes de ligar: **carta** committada (template 20: objetivo verificável, papéis, mapa de mini-goals, gates escritos ANTES) + **allow-list** (`loop-guard`) + **budget** + verificador definido. Fluxo completo comando a comando: **`docs/RUNNING-GOVERNED-LOOPS.md`**. Essência:

```bash
worktree-manager.sh create <run-id> <feature-branch>
loop-guard.sh init --run <run-id> --scope <allow-list> --budget <N>
# por iteração: executor (subagente) → loop-guard scope → verificador → loop-guard iter → validate → commit "docs(pilot): …" → tag
# encerramento: push + PR (HUMANO) → merge (HUMANO) → worktree remove
```

Kill switch: remover o worktree a qualquer momento (nada mergeia sem você); automático via alertas `sem-progresso`/`budget`/diff fora do escopo. Regras provadas pela execução real (tipo de commit, rollback de propósito, etc.): runbook N1 §6 e `RUNNING-GOVERNED-LOOPS.md`.

## 6. ROTA C — dev-squad / SWARM

Quando a entrega é por **waves com PR por wave** (batch heterogêneo, 3+ tarefas independentes): Commander (Opus) faz Intake→Study→Plan (gate G2 humano)→Execute (squads Sonnet/Haiku em worktrees)→Consolidate. 1 task = 1 commit; 1 wave = 1 PR. O goal-graph pode alimentar o dev-squad (o GOAL-GRAPH.md vira o PLAN) quando você prefere o fluxo PR-driven ao Workflow compilado.

## 7. Verificação (skill `verifier`)

Ordem de decisão: **determinístico primeiro** (teste/script/contagem — LLM não substitui asserção executável) → adversarial em contexto independente senão ("tente REFUTAR; default REPROVADO se ambíguo"). Escala: 1 cético comum · **3 céticos/maioria** em domínio crítico (money/deploy/schema/segurança) · **lentes diversas** (correctness/security/reproduz?) quando a falha é multi-modo ou executor e verificador compartilham o modelo base. Sempre: reconferir ≥1 evidência NA FONTE; e **todo comando de verificação escrito em doc deve reproduzir exatamente o número afirmado** (o piloto reprovou uma iteração por isso). `INCONCLUSIVO` rebaixa, nunca aprova.

## 8. Custo — as regras de bolso

1. Coordenação é código (zero turnos); agentes custam de verdade — comece escopado (ex.: "máx 20 arquivos") e abra depois.
2. Tier por nó: caro só onde há julgamento; fan-out repetitivo desce de tier; **nenhum nó herda modelo em silêncio**.
3. Budget é teto duro (`+Nk` na diretiva; `budget.remaining()` como guard de loops dinâmicos).
4. Loop dinâmico para por **dry + budget + max-iterações** — produção precisa dos três.
5. Métrica que importa: **custo por mudança aceita** (<50% de aceite = prejuízo).
6. Grafo com 20 chamadas baratas pode custar mais que 1 chamada forte — topologia É custo.

## 9. Gates de autoridade (nunca automáticos)

Deploy · merge · push outward-facing · secrets/credenciais · migração de schema/dados · escrita em sistema externo/produção · qualquer caminho ancorado. O grafo os marca ANTES de ligar; compilar/emitir nunca os atravessa. FAIL/bloqueio = handoff explícito para o dono, não beco.

## 10. Troubleshooting (aprendido em execução real)

| Sintoma | Causa | Ação |
|---|---|---|
| Exploração cara/sem pivots úteis | axon MCP down silencioso ou índice stale | health-gate: `axon status`, reindex (`axon index <path>`); pivots ruins → query em inglês + `pivot_files` |
| Commit de iteração rejeitado: tipo inválido | validador não aceita tipo `loop` | usar `docs(pilot):` (tipos: feat/fix/docs/style/refactor/test/chore/ci/build/perf/revert) |
| Commit bloqueado por teste "orphan skills" | skill nova sem capability-family | mapear em `.agents/capabilities/components.yaml` (o gate está certo) |
| `hseos pr closeout` falha em PR task→feature | CI só dispara para master | merge direto `gh pr merge --merge`; closeout governado é feature→master |
| Estado do loop aparece no commit da iteração | `worktree-manager commit` usa `git add -A` | comportamento aceito (bus auditável versionado); alternativa: gitignorar `.hseos/loops/` |
| Run não aparece em `state-list`/kanban | heartbeat do loop-guard ≠ state store | exportar `HSEOS_CURRENT_RUN_ID=<run-id>` na sessão do loop |
| Executor subagente idle sem relatório | encerrou sem enviar a SAÍDA | contrato deve exigir "envie a SAÍDA antes de encerrar"; orquestrador confere o disco (evidência > relato) |
| Loop dinâmico nunca converge | dedupe contra confirmados, não contra vistos | dedupe vs `seen` — rejeitados não podem reaparecer |
| `worktree-manager` "Worktree not found" | rodado de dentro do worktree | rodar sempre da RAIZ do repo |

## 11. Exemplo completo (caso real: o piloto N1)

Objetivo: *"reconciliar a documentação factualmente incorreta do enterprise-hseos com a realidade do repo"*. Carta + allow-list doc-only + budget 8 → worktree `task/pilot-n1` → baseline REPROVADO (9 discrepâncias) → iterações: skills 46/49→52 · rollback testado de propósito · agents 14→15 · CHANGELOG criado · CAPABILITY-MATRIX reconciliada (com um REPROVADO real pego por amostragem: comando que não reproduzia o número) · sweep final (ADAPTER-GUIDE + ref morta) → verificador 4/4 PASS → PR #121 (humano) → merge (humano) → higiene. Heartbeat integral: `.hseos/loops/pilot-n1/heartbeat.jsonl`. Tags: `pilot-iter-1..5`.

Para um objetivo de código (Rota A), o mesmo esqueleto com `workflow.js`: leitores → gap-map → G2 → fan-out de implementadores em worktrees → verificadores adversariais → merge node → PR humano.

## 12. Referências

- Fluxo operacional de loops governados: `docs/RUNNING-GOVERNED-LOOPS.md`
- Skills: `goal-graph` (SKILL.md §1-bis, §7-bis) · `verifier` · `hseos-goal-loop` · `dev-squad`
- Estado versionado: `agent-skills/goal-graph/templates/graph-state-layout.md`
- Autonomia N1: `.enterprise/governance/autonomy/` (README com a execução provada) + runbook §6 (learnings)
- Vault: `_learnings/2026-07-24-grafos-de-loops-runtime-compilado-axon-e-custo.md` · `_prompts/18-22` · fundamentos externos na 📚 KNOWLEDGE BASE (Notion → 🤖 Engenharia de Agentes, 12 artigos)
