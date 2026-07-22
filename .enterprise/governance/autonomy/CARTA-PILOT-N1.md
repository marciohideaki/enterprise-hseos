# Carta de Orquestração — Loop-Piloto N1 (doc-only, enterprise-hseos)

> Prompt-pointer: a sessão que roda este loop recebe SÓ o path desta carta.
> Contrato durável, versionado. Estado volátil vive em `.hseos/loops/pilot-n1/`.
> Origem: audit 2026-07-22 · AUTONOMY-N1-RUNBOOK.md. Formato: template `_prompts/20`.

## 1. Veredito honesto
Escopo doc-only = menor blast radius com resultado 100% verificável por contagem programática. Teto autônomo realista: **~90%** (o loop descobre/corrige/verifica; os 10% humanos são abrir/mergear o PR e receber alertas). Paredes duras que nenhuma autonomia fura: caminhos ancorados (anchor-guard), qualquer coisa fora de `scope-pilot-n1.txt` (loop-guard scope), o merge.

## 2. Objetivo verificável (100%)
Toda afirmação factual/numérica nos docs de `scope-pilot-n1.txt` corresponde à realidade do repo, comprovada por `scripts/governance/verify-doc-facts.sh` (exit 0). `CHANGELOG.md` criado. Zero caminho ancorado tocado.

## 3. Modelo operacional
| Papel | Quem | Faz |
|---|---|---|
| Orquestrador | sessão principal | decompõe em mini-goals, spawna executor/verificador, chama `loop-guard`, para no gate; nunca lê arquivo grande direto |
| Executor | subagente `model: sonnet` | aplica UMA correção e PARA; 1 commit atômico |
| Verificador | subagente ISOLADO (contexto limpo, adversarial) | roda `verify-doc-facts.sh` + `loop-guard scope`; REPROVA se ambíguo; não confia no executor |

## 4. Mapa de iterações (um mini-goal por vez)
| Iter | Mini-goal | Verificação objetiva |
|---|---|---|
| 1 | corrigir contagem de skills no README | `verify-doc-facts.sh` skills-count PASS |
| 2 | corrigir contagem de agents no README | `verify-doc-facts.sh` agents-count PASS |
| 3 | criar `CHANGELOG.md` (Keep-a-Changelog) | `verify-doc-facts.sh` CHANGELOG PASS |
| 4+ | referências mortas em docs não-ancorados | `test -e` de cada path citado |

## 5. Execution Protocol
Cada iteração:
1. Executor aplica 1 correção dentro do escopo.
2. `scripts/governance/loop-guard.sh scope --run pilot-n1` — diff ⊆ allow-list? (senão REPROVA)
3. Verificador isolado roda `verify-doc-facts.sh` e devolve verdict + evidência objetiva.
4. `loop-guard.sh iter --run pilot-n1 --goal <g> --verdict <PASS|REPROVADO> --evidence <medição> --files <paths>`
   - exit 3 (ALERTA) ⇒ **PARE e escale** (gate-sem-evidência, budget, ou sem-progresso).
5. 1 iteração = 1 commit `loop(pilot-n1): <mini-goal>` + tag `pilot-n1-iter-N`. Worktree via `worktree-manager.sh`. Rollback = `git revert` ou descarte do worktree.
Throttling: `uptime` antes de qualquer build/test (AGENTS §3f). Sem push direto.

## 6. Gates (a linha auto-avanço ↔ humano, escrita ANTES de ligar)
- **auto-avança** entre iterações dentro do escopo com verify PASS.
- **PARA no humano**: abrir o PR final; qualquer diff fora do escopo; qualquer caminho ancorado (redundante com anchor-guard); o merge; qualquer exit 3 do loop-guard.

## 7. Loop de operação + DoD
Discover (que afirmação ainda está factualmente errada?) → Mini-goal → Execute (1 correção reversível) → Verify (adversarial) → se REPROVADO, Fix pela causa raiz e revalidar o MESMO aceite → `loop-guard iter` → Reassess.
**Stop condition:** `verify-doc-facts.sh` exit 0 (superfície esgotada) **ou** budget atingido **ou** bloqueio/ambiguidade → registrar e escalar.
**DoD global:** CI verde; `loop-guard scope` sem violação de escopo/âncora em nenhuma iteração (enforcement loop-side, sem branch protection); PR aberto com relatório (o que mudou, antes/depois, o que ficou fora); zero âncora tocada; ≥1 REPROVADO no `heartbeat.jsonl` (prova de que o verificador tem dentes).

## Bootstrap (comandos)
```bash
cd /opt/hideakisolutions/enterprise-hseos
# axon fresco antes de ligar (F-015), ou declarar rodar sem axon:
#   mcp__axon__run_pipeline OU: axon index .
bash scripts/governance/loop-guard.sh init --run pilot-n1 \
  --scope .enterprise/governance/autonomy/scope-pilot-n1.txt --budget 8
bash scripts/governance/verify-doc-facts.sh   # baseline: mostra o que corrigir
# ...rodar o loop conforme §5...
bash scripts/governance/loop-guard.sh status --run pilot-n1
```
