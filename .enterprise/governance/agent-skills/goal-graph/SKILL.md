---
name: goal-graph
tier: full
version: "1.1"
description: "Use when a user gives a complete objective (prompt, spec file, or both) and wants it compiled into an executable graph of loops for goal/loop execution — with parallelism across independent nodes, dynamic discovery-driven expansion, a codebase confrontation phase (gap-map), and optional compilation to an executable workflow.js for the Workflow runtime."
license: Apache-2.0
portable: true
metadata:
  owner: platform-governance
trigger: "montar grafo, grafo de loops, compilar objetivo em grafo, goal graph, loop graph, orquestrar objetivo, planejar execução paralela, decompor objetivo em waves, executar goal/loop com paralelismo e fluxo dinâmico"
skip: "objetivo trivial de um único passo; execução já em curso sob um grafo existente; pergunta read-only; quando um workflow dedicado já é dono da decomposição"
---

# Goal Graph — Compile an Objective into an Executable Loop Graph

Compila um objetivo completo em um **grafo de loops** executável: nós (loops/mini-goals), arestas (dependências), com **paralelismo** entre nós independentes e **fluxos dinâmicos** (expansão por descoberta) onde a estrutura não é conhecida a priori. O grafo é o contrato; a execução é feita depois por `dev-squad`/SWARM (waves paralelas) ou `hseos-goal-loop` (loop sequencial), sob os guardrails `loop-guard`/`anchor-guard`/verificador.

## Authority boundary

Protocolo de **planejamento**, não concessão de permissão. Produzir o grafo NÃO autoriza executá-lo. Cada nó, ao rodar, obedece constituição, ADRs, policies e âncoras, e para nos gates de autoridade. Deploy, merge, secret, migração de schema/dados, mudança de segurança/infra e escrita em sistema externo/produção exigem autoridade humana explícita — o grafo os marca como gates humanos **antes** de qualquer nó rodar. Se um objetivo é ambíguo de um jeito que muda comportamento, dados, arquitetura ou risco, pare e faça a menor pergunta; não invente decisão.

## 0. Onde esta skill se encaixa

| Skill | Papel |
|---|---|
| **goal-graph** (esta) | COMPILA objetivo → grafo de loops (planeja nós, arestas, paralelismo, fluxo dinâmico, gates, guardrails; emite GOAL-GRAPH.md + workflow.js) |
| runtime `Workflow` (harness) | EXECUTA o `workflow.js` compilado — coordenação em código (zero turnos de orquestração), pipeline/barrier, budget, checkpoint/resume |
| `dev-squad` / SWARM | EXECUTA waves paralelas de nós em worktrees isolados (fluxo PR-driven) |
| `hseos-goal-loop` | EXECUTA um loop sequencial (discover→execute→verify→reassess) |
| `loop-guard` / `anchor-guard` / verificador | GUARDRAILS que cada nó usa em runtime (escopo, budget, âncora, heartbeat, alertas) |

Use goal-graph quando o objetivo é grande ou heterogêneo o bastante para valer um grafo: múltiplos mini-goals, paralelismo possível, ou descoberta necessária. Para uma tarefa única sequencial, use `hseos-goal-loop` direto.

## 1. Intake — absorver o objetivo completo

Capturar e **ler tudo** que o objetivo referencia:

- o prompt do objetivo E todo arquivo/spec citado (ler integralmente; não inferir conteúdo);
- resultado de produção desejado, escopo e não-escopo;
- constraints (compatibilidade, segurança, compliance, entrega);
- autoridade disponível e evidência de produção esperada.

Carregue o contexto mínimo relevante (em projeto com `.axon/`, `mcp__axon__get_context_capsule(query)`; senão discovery dirigido). Para cada afirmação, distinga **observado / inferido / não-verificado**. Localize implementação existente antes de planejar uma paralela.

## 1-bis. Entender & Confrontar — diamond de leitura (gap-map)

Entre o intake e a decomposição, o objetivo passa por uma fase própria de leitura do codebase — estruturada como **diamond**, nunca como leitura sequencial na sessão:

1. **Health-gate do contexto barato** (obrigatório; nunca degradar em silêncio):
   - projeto com `.axon/`: índice ≤24h e MCP/CLI respondendo? Senão: alertar, reindexar (`axon index`) ou declarar fallback (`axon capsule` CLI). Registrar o modo usado.
   - sem `.axon/`: discovery dirigido (entrypoints, specs, testes) — declarar o custo extra.
2. **Capsule** → lista de pivots/subsistemas relevantes ao objetivo (query em inglês; **conferir se os pivots fazem sentido** — pivot irrelevante compila nó errado; se ruins, refinar a query ou dar `pivot_files` como dica).
3. **Fan-out de leitores** (tier executor/mecânico, 1 por pivot/subsistema, contexto fresco, schema obrigatório):
   `{fatos_observados[], inferidos[], nao_verificados[], riscos[]}` — o leitor **não opina sobre o plano**; só reporta o que o código É.
4. **Barrier de confronto** (1 nó, tier de planejamento): objetivo × leituras → **GAP-MAP**:
   - o que **JÁ EXISTE** (não reimplementar);
   - o que **CONFLITA** com o objetivo (decisão necessária);
   - o que **FALTA** (vira nó em §2);
   - o que o objetivo **ASSUME ERRADO** (voltar ao usuário se mudar comportamento, dados ou risco — Authority boundary).

O gap-map alimenta a decomposição (§2) e acompanha o GOAL-GRAPH.md no gate de confirmação humana: aprova-se um plano **confrontado com a realidade do código**, não uma suposição.

## 2. Decompor em nós (os loops)

Quebre o objetivo em **nós**. Cada nó é um mini-goal verificável ou uma wave. Escreva o contrato de cada nó:

```
id / título
escopo fechado (allowed_paths)  e  não-escopo
critério de aceitação
verify_step: comando/observável determinístico  (preferir)  OU  verificador adversarial
tier de modelo  ·  budget (iterações / tokens)
domínio de risco: doc | code | money-critical | deploy | external | anchor
estático | dinâmico   (ver §4)
```

Regra da menor unidade: cada nó deve ser **reversível e revisável isoladamente** (1 nó ⇒ 1 commit no fim). Um nó grande demais para verificar objetivamente deve ser quebrado.

## 3. Montar o DAG de dependências (as arestas)

Mapeie o que cada nó precisa que outro produza. Derive:

- **camadas topológicas**: nós com dependências satisfeitas ficam na mesma camada;
- **caminho crítico** (a cadeia mais longa que limita o wall-clock);
- **ciclos = erro**: quebre a dependência, ou converta em nó dinâmico com stop condition.

Emita o DAG como grafo (mermaid): nós + arestas de dependência + camadas.

## 4. Classificar o fluxo de cada nó: estático vs dinâmico

- **Estático (Goal):** estrutura conhecida a priori; o nó já é completo no grafo.
- **Dinâmico (Loop / descoberta):** estrutura desconhecida; o nó é um **expansor** que descobre subnós em runtime e faz o grafo crescer. Padrões:
  - **discovery→expand**: um nó de descoberta produz a lista de subnós (ex.: achar todos os call sites → 1 subnó por site).
  - **loop-until-dry**: repetir até K rodadas consecutivas sem novidade (descoberta de tamanho desconhecido — bugs, edge cases).
  - **fan-out por item**: 1 subnó por item descoberto, em paralelo.
  - **adversarial-verify por finding**: cada resultado é julgado por um nó cético independente antes de ser aceito.

Todo nó dinâmico DEVE declarar a **stop condition** (superfície esgotada / K rodadas secas / budget). Fluxo dinâmico sem stop condition é loop infinito — recuse emitir.

## 5. Decidir paralelismo

- Nós **independentes na mesma camada** rodam em paralelo.
- **Mutação paralela do filesystem ⇒ worktree isolado por nó** (`worktree-manager.sh create`) — sem worktree, dois nós colidem.
- **Pipeline por default**: cada item flui pelas etapas sem esperar os outros. Use **barreira** só quando um nó precisa de TODOS os resultados da camada anterior (dedup/merge global, early-exit "0 achados → pular verificação").
- **Limite de paralelismo ao que o host comporta** (AGENTS §3f: validar `uptime`; ≤2 builds/testes pesados simultâneos). Nós leves aceitam fan-out maior.
- **Tier de modelo por nó**: Opus para planejamento/decisão transversal/arbitragem; Sonnet para execução; Haiku para mecânico. Nenhum executor herda o modelo — declara explícito.

## 6. Anexar guardrails a todo nó

Cada nó, ao rodar:

- `loop-guard init` (scope allow-list + budget) → `loop-guard scope` antes de aceitar (diff ⊆ escopo **e** sem âncora) → `loop-guard iter` (heartbeat + alertas: gate-sem-evidência, sem-progresso, budget).
- `anchor-guard`: nenhum nó toca constituição/specs/policies/guards; só `ANCHOR_OVERRIDE=1` humano fora do grafo libera.
- **verificador**: determinístico quando existir (teste/script/contagem); senão subagente adversarial **isolado** (contexto limpo, "tente refutar; default reprovado se incerto"). Executor ≠ verificador — nunca a mesma sessão.
- **rollback**: worktree + 1 nó = 1 commit; rollback = `git revert` / descarte do worktree.
- **gate**: a linha auto-avanço ↔ humano por **domínio** (money-critical, deploy, merge, secret, schema, âncora, outward-facing = humano), escrita ANTES de ligar.

## 7. Emitir o grafo — `GOAL-GRAPH.md`

Produza o artefato executável (prompt-pointer; committar no repo do projeto). Estrutura:

1. **Veredito honesto** — o grafo faz sentido? teto autônomo realista (%); paredes duras que nenhuma autonomia fura.
2. **Objetivo verificável** (definição de 100%).
3. **Nós** — tabela: id, mini-goal, escopo, verify_step, tier, budget, domínio, estático/dinâmico.
4. **DAG** — mermaid: dependências, camadas, o que é paralelo.
5. **Fluxos dinâmicos** — para cada nó dinâmico: o padrão e a stop condition.
6. **Gates** — a linha auto↔humano por domínio, em termos verificáveis.
7. **Execution protocol** — pipeline por default; barreira só onde justificada; worktree para mutação paralela; verify adversarial obrigatório no crítico; 1 nó/iteração = 1 commit; tier matrix.
8. **DoD** — por nó e global; ≥1 REPROVADO esperado por nó com verificador (prova de que o verificador tem dentes).

## 7-bis. Compilar para runtime executável — `workflow.js`

Junto do GOAL-GRAPH.md, emitir o **mesmo contrato em forma executável** para o runtime `Workflow` (Dynamic Workflows), quando disponível no harness. Coordenação em código = **zero turnos de orquestração** (a alavanca do learning 2026-07-15: 71% do custo de goal-loops era polling do orquestrador re-submetendo contexto).

Mapeamento mecânico:

| goal-graph | Workflow |
|---|---|
| nó estático + contrato/schema | `agent(prompt, {schema, model, effort, label, phase})` |
| camada topológica | `pipeline()` por default; `parallel()` só com barreira justificada no GOAL-GRAPH |
| nó dinâmico discovery→expand | nó descobridor retorna lista → `pipeline(lista, ...)` |
| loop-until-dry | `while (dry < K)` com dedupe contra `seen` (nunca só contra confirmados) |
| verificador adversarial | N céticos `agent()` em contexto independente ("tente refutar; default REPROVADO"), maioria decide |
| mutação paralela de arquivos | `isolation: 'worktree'` apenas nos nós que escrevem |
| budget do nó | guard com `budget.remaining()`; loop dinâmico para por budget ALÉM do dry |
| tier matrix | `model`/`effort` explícitos por chamada — nenhum nó herda em silêncio |

Invariantes de compilação:

- **Emitir ≠ executar.** O diálogo de permissão do Workflow é o gate humano de "ligar". A compilação nunca dispara o run.
- **Ferramentas pelo PATH** (`hseos`, `axon`, `loop-guard.sh` resolvido via runtime global), nunca path absoluto do runtime — o script viaja com o projeto, sem acoplamento.
- **Nó idempotente por construção**: antes de gastar tokens, todo nó consulta checkpoint `(node_id, input_hash, baseline_ref)` no barramento do projeto (`_graph/<goal-id>/state/`); hit válido = retorna o gravado. **Retomar = rodar o workflow de novo.** Nó com efeito colateral separa *decisão* de *execução* e checa "já fiz?" antes de agir.
- **Baseline como âncora**: o script grava as âncoras da realidade (SHA, digests, versões) em `BASELINE.md` (rN, com invalidação explícita do anterior); checkpoint com baseline divergente **invalida em cascata** — a regra "certificação não atravessa push de imagem" generalizada.
- **Estado versionado**: `events.jsonl` append-only é a fonte; SQLite (`state-emit`) é projeção; STATE/RESUME-PROMPT são renders. 1 iteração = 1 commit; 1 camada = 1 tag.
- **Degradação graciosa**: sem `hseos` no PATH → pular `state-emit` com aviso; sem runtime `Workflow` no harness → o GOAL-GRAPH.md permanece executável via dev-squad/hseos-goal-loop.
- Nós mutantes continuam passando por `loop-guard scope`/`anchor-guard` — a governança não sai do caminho; sai do custo.

## 8. Handoff para execução

- **Grafo com `workflow.js` compilado ⇒ runtime `Workflow`** (preferido quando disponível: zero turnos de orquestração, checkpoint/resume, budget nativo).
- Waves paralelas PR-driven ⇒ `dev-squad` / SWARM (Commander planeja, Squad executa em worktrees).
- Loop sequencial / descoberta ⇒ `hseos-goal-loop`.
- O grafo é o contrato; o runtime o consome. **goal-graph não executa** — emite e entrega. Ligar a execução é ato humano (ou explicitamente autorizado por run).

## Completion declaration

```markdown
GOAL-GRAPH — {objetivo}
Gap-map: {existe / conflita / falta / assume-errado — resumo em 1 linha cada}
Nós: {N} em {C} camadas · paralelismo: {nós concorrentes por camada}
Fluxos dinâmicos: {nós dinâmicos com stop condition}
Gates humanos: {domínios que param no humano}
Guardrails: loop-guard (scope+budget+heartbeat) · anchor-guard · verificador {determinístico|adversarial isolado} por nó
Runtime de execução: {Workflow (workflow.js) | dev-squad | hseos-goal-loop}
Autoridade requerida para ligar: {nenhuma | ação exata}
Artefatos: {path do GOAL-GRAPH.md} · {path do workflow.js | não-compilado (motivo)}
```

## Anti-patterns

- Grafo como prosa sem contrato executável (nó sem verify_step, escopo ou gate).
- Paralelismo sem worktree → colisão de filesystem entre nós.
- Nó dinâmico sem stop condition → loop infinito.
- Barreira onde pipeline bastava → wall-clock desperdiçado.
- Auto-merge em domínio crítico; nó que toca âncora.
- Executor validando a si próprio (verificador = executor, mesma sessão).
- Emitir o grafo e já executar sem o gate humano de ligar.
- Métrica de progresso sem contra-métrica (nó "verde" — commit/atividade — sem verify de resultado).
- Pular o health-gate do axon e explorar caro em silêncio (degradação invisível de custo).
- Leitor do diamond opinando sobre o plano — leitor reporta o que o código É; o confronto é do barrier.
- Decompor sem gap-map — plano aprovado no G2 baseado em suposição, não em confronto com o código.
- Nó com efeito colateral sem checagem de idempotência — o resume duplica o efeito.
- `workflow.js` com paths absolutos do runtime global — acopla o projeto ao host.
