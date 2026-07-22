# Autonomy Kit — estado do Readiness Gate

Mecanismos que deixam o `enterprise-hseos` pronto para operar grafos de loop autônomos (N1). Instalado por: audit 2026-07-22 (`.enterprise/governance/audits/2026-07-22-cybernetic-audit/`).

**Decisão de arquitetura (2026-07-22):** o enforcement de âncora é **loop-side**, não via branch protection do GitHub — por escolha do owner ("não vamos proteger a branch"). O `.github/branch-protection.yaml` e o `ci.yaml` permanecem **inalterados**; a proteção contra o loop tocar constituição/specs/policies vive dentro do próprio loop (`loop-guard` → `anchor-guard`). Isso protege exatamente o cenário de risco de autonomia (o loop reescrever a própria regra) sem impor política ao repositório.

Todos os scripts foram testados, inclusive os casos de falha (não são no-ops).

## Artefatos instalados
| Arquivo | Fecha | Papel |
|---|---|---|
| `scripts/governance/anchor-guard.sh` | item 2 (F-005/F-002) | bloqueia diff que toca âncora (constituição/core/cross/policies/manifest/hooks/.github/guards) sem `ANCHOR_OVERRIDE=1` humano. Testado: pass / fail / override |
| `scripts/governance/loop-guard.sh` | itens 2,3,5 | `scope` (diff ⊆ allow-list **e** sem âncora, via anchor-guard), `iter` (heartbeat + alertas gate-sem-evidência / sem-progresso / budget), `init`, `status`. Testado em repo isolado |
| `scripts/governance/verify-doc-facts.sh` | item 1 (verify) | medição objetiva do piloto doc-only (contagens vs README, CHANGELOG). Determinística — é o verificador adversarial reproduzível |
| `autonomy/CARTA-PILOT-N1.md` | item 6 | contrato do loop-piloto (gates escritos antes de ligar) |
| `autonomy/scope-pilot-n1.txt` | item 3 | allow-list do piloto (doc-only, não-ancorada) |

Não há CODEOWNERS nem mudança de CI/branch — o kit é autocontido nos guardrails.

## Estado do Readiness Gate
| Item | Estado | Nota |
|---|---|---|
| 1 — Verificador isolado obrigatório | ✅ | `verify-doc-facts.sh` é determinístico e recomputa a verdade; para loops não-doc, spawnar subagente verificador isolado (carta §3) |
| 2 — Âncora protegida (loop-side) | ✅ pronto e testado | `loop-guard scope` reprova qualquer iteração que toque âncora, mesmo se a allow-list for ampla; só `ANCHOR_OVERRIDE=1` humano libera |
| 3 — Escopo + budget impostos | ✅ pronto e testado | — |
| 4 — Rollback definido | ✅ | reusa `worktree-manager.sh` + 1 iter = 1 commit; testar rollback uma vez antes de auto-avançar |
| 5 — Sensor + alerta | ✅ pronto e testado | `heartbeat.jsonl` + exit 3; evoluir para PrometheusRule na Wave 2 |
| 6 — Gate humano na fronteira | ✅ | escrito na carta §6 |

**Veredito:** os 6 itens do Gate estão fechados no código, sem depender de branch protection. O ambiente está pronto para ligar o loop-piloto N1.

## Como o loop roda (isolamento)
O loop roda num **worktree isolado** (`worktree-manager.sh create <run-id> <branch>`), a partir de um commit onde os guardrails existam. Nesse worktree, `loop-guard scope` compara working-tree vs HEAD → enxerga exatamente as edições da iteração. 1 iteração = 1 commit; rollback = `git revert` ou remoção do worktree. O loop **não** faz push nem merge (item 6).

## Ações do operador (não automatizadas de propósito)
1. **Commitar o kit** (`anchor-guard.sh`, `loop-guard.sh`, `verify-doc-facts.sh`, `autonomy/`) — pré-requisito para o worktree do loop tê-los.
2. Confirmar budget do piloto (default 8) e ligar via `CARTA-PILOT-N1.md`.
3. Reindexar o axon do repo (13 dias stale, F-015) antes de ligar, ou declarar rodar sem axon.
4. Aprovar o PR final (o loop nunca faz o próprio merge).
5. Fora do piloto, antes de apontar autonomia para projetos que usam o harness global: resolver os S0 (F-001 PAT, F-002 swarm-gate, F-003 commit do vault).

## Auto-teste do kit (repo isolado)
```bash
# anchor-guard: PASS / FAIL / override
ANCHOR_GUARD_FILES=README.md            bash scripts/governance/anchor-guard.sh
ANCHOR_GUARD_FILES=.agents/manifest.yaml bash scripts/governance/anchor-guard.sh || echo "  ^ bloqueou (esperado)"
ANCHOR_GUARD_FILES=.agents/manifest.yaml ANCHOR_OVERRIDE=1 bash scripts/governance/anchor-guard.sh
# baseline factual do piloto
bash scripts/governance/verify-doc-facts.sh || echo "  ^ há trabalho para o piloto (esperado hoje)"
```

## Próximo nível (N2) — não ligar antes
Grafo de loops encadeados com auto-merge em domínio não-crítico exige as Waves 2–3 do `EVOLUTION-ROADMAP.md` (sensores de resultado + contra-métricas + arbitragem + rollback automatizado). Só avançar depois que o piloto rodar até a stop condition com o alerta silencioso e o rollback testado.
