# PLAN — 20261008-2350-next-steps

Status: **G2 APROVADO pelo owner em 2026-10-08 ("Prossiga! Plano aprovado!")**

## Tarefas

| ID | Item | Objetivo | Tier | Branch / saída | Entrega |
|---|---|---|---|---|---|
| T1 | 1 | Spike: compilador TypeScript como leitor de exports do guard | Sonnet high | `feature/guard-ts-parser-spike` ← `task/T1` | protótipo + `SPIKE-REPORT.md`; **sem PR, sem merge na master** |
| T2 | 2 | Revisão manual do grupo c (39 divergências de modalidade não-polaridade e não-INFORMATIVE) | Sonnet medium | somente leitura → `REPORT-T2.md` no run-dir | relatório; nenhum arquivo do repo editado |
| T3 | 3 | Anunciar `.claude/settings.json` e `.mcp.json` em `PLATFORM_SURFACES['claude-code']` | Sonnet low | `feature/platform-surfaces-claude-mcp` ← `task/T3` | 1 commit + teste; PR aberta pelo owner |

O item 4 sai do run e continua como pendência.

## DAG
Wave 1: T1 ∥ T2 ∥ T3. Não há dependências nem handoffs.

## Critérios de aceite

**T1 (spike)**
- O protótipo fica atrás de uma opção explícita, por exemplo `HSEOS_GUARD_PARSER=ts`. O caminho padrão continua igual ao da master.
- O relatório mede:
  - latência do hook com `require('typescript')` frio e quente, p50 e p95;
  - tamanho que o `typescript` acrescenta à instalação;
  - pior caso a 1 MB, comparado com a master no mesmo instante e via `heavy-run`.
- Diferencial contra a master sobre o corpus de bypass dos testes do guard, sem filtrar por validade: o protótipo vê um superconjunto dos símbolos?
- Fecha as lacunas documentadas: `readonly`/`unique` no fim de linha de anotação, corpo de class/function em linha própria e as 2 variantes divisão→regex pinadas.
- Falso positivo num corpus real: os `.js`/`.ts` do próprio repo.
- Comportamento com arquivo que não parseia, que tem de falhar fechado.
- Recomendação final: adotar, adotar com condição ou rejeitar. Inclui o custo de mover `typescript` para `dependencies`.

**T2**
- Lista as 39 por id de regra, fontes, divergência e locators.
- Classifica cada uma contra o texto atual do repo: divergência real de força normativa, variante legítima com contexto diferente, ou ruído.
- Para as reais, propõe o modal certo e o arquivo dono. Não edita nada.

**T3**
- `platforms.js` ganha `settings: '.claude/settings.json'` e `mcp: '.mcp.json'`, com comentário sobre a condicionalidade.
- Teste em `test/test-agent-core-compiler-hooks.js`: as superfícies aparecem quando os arquivos existem e não aparecem quando não existem.
- Recompila `.agents/manifest.yaml` se o artefato versionado mudar. O limite do inventário (1472) não pode mudar, porque nenhum arquivo novo é emitido.

## Execution Protocol

- **Coordenação:** SWARM é o Commander (Opus): planeja, revisa e consolida. A squad é Sonnet, despachada pelo Agent tool com `model: "sonnet"`. Não há opt-in de Opus em execução.
- **Isolamento:** T1 e T3 rodam em worktree via `scripts/governance/worktree-manager.sh create|validate|commit|merge|remove`, com base em seus `feature/*`. T2 é somente leitura: não cria worktree e abre a base com `mode=ro`.
- **Higiene de commit:** 1 tarefa = 1 commit, validado por `validate-commit-msg.sh`. Sem `Co-Authored-By` e sem menção a IA. Nunca `--no-verify`.
- **Carga do host (§3f):** `uptime` antes de cada suíte. Toda build, teste ou benchmark roda via `heavy-run`, que serializa por flock. Só testes alvo, nunca `npm test` completo em paralelo. Suíte local com Node 24, cgroup delegado e `TMPDIR=/build/hseos-qg-tmp`.
- **Revisão cética:** depois da wave, um revisor Sonnet isolado avalia T1 e T3 contra estes critérios. Primeiro em passagem cega, depois em confronto com as alegações do executor. O revisor reporta e não corrige. No máximo 3 rodadas de correção.
- **Gates humanos:** G2 (este plano), G4 (o owner abre a PR de T3), G5 (merge por `hseos pr closeout <n> --approved` só com aprovação explícita). T1 nunca vira PR neste run.
- **Versionamento:** sem tag. O CHANGELOG entra só em T3, se o repo exigir. O run-dir é registrado num commit `docs(runs)` no fechamento.
- **Mapa:** Wave 1 = {T1: Sonnet high, T2: Sonnet medium, T3: Sonnet low}. Revisão = Sonnet. Consolidação = Commander.
