# INVENTORY — run `20261113-repo-hygiene` (onda HA, fase 1)

Base `master` `a4fabbd5`. Três exploradores Sonnet em paralelo, somente leitura. Os números abaixo são saída de ferramenta (`git ls-tree -r -l -z HEAD`, `git ls-files -s -z`, `git worktree list --porcelain`, `git cherry`, `gh pr list`, `du -sb`, `find -mtime +7`, `fuser -v`). As hipóteses estão marcadas como tal.

## (a) Árvore versionada

Total: 4986 arquivos (`git ls-files -z | tr -cd '\0' | wc -c`).

| Raiz | Arquivos | Bytes |
|---|---|---|
| docs | 2594 | 46313299 |
| test | 339 | 5786736 |
| tools | 393 | 3764181 |
| .enterprise | 472 | 2944084 |
| src | 245 | 1477205 |
| .hseos | 359 | 1392521 |
| packages | 137 | 1152867 |
| .agents | 207 | 1014925 |
| _graph | 117 | 461879 |
| (arquivos soltos na raiz) | 17 | 377854 |
| .specs | 42 | 337607 |
| scripts | 22 | 181217 |
| .github | 18 | 61060 |
| _pipeline | 1 | 40310 |
| .claude | 8 | 30072 |
| .codex | 2 | 25606 |
| plugins | 5 | 3010 |
| .logs | 4 | 1520 |
| .husky | 2 | 504 |
| .claude-plugin | 1 | 409 |
| .codex-plugin | 1 | 69 |

`docs/`: `evolution` 2383 arquivos / 28909260 B; `assets` 13 / 15414506 B (10 PNG acima de 1 MB, usados pelo README); `v4` 108 / 1276693 B; `audits` 3; `pt-br` 6; `goals` 11; `agents` 16; `releases` 14; `decisions` 6; `evidence` 4; mais 23 arquivos no topo.

`docs/evolution/` (2º nível, arquivos / bytes): `w3/evidence` 1185 / 8058325; `w4/evidence` 428 / 6171772; `w5/evidence` 281 / 4510550; `w2/evidence` 97 / 3105949; `evidence/w0-closeout` 49 / 1475708; `w1/evidence` 72 / 1106960; `revalidation-2026-10/evidence` 44 / 930487; `w10/evidence` 60 / 548849; `consumer-validation-2026-10/evidence` 27 / 434671; `terminal-closeout/evidence` 6 / 314223; `evidence/sequential` 14 / 227124; `w0/evidence` 2 / 193064; `w3/stab2` 9; `w3/model-bindings` 4; `runbooks` 4; `pendencias-w0-w5` 2; `audit-2026-10-27` 2; `contracts` 2.

`.hseos/runs/`: 293 arquivos, dos quais 290 em `dev-squad` (25 runs, todas com `STATUS.md`; só `20261111-terminal-closeout` tem `FINAL-REPORT.md`; 5 sem `INTAKE.md`) e 3 em `standalone-migration`.

### Duplicados (por blob id)
- `.specs/` da raiz (42 arquivos, `features/harness-w1..w5`): **0** de 42 com blob idêntico em `.enterprise/.specs/` ou em qualquer outro lugar. **Não é duplicata.** O `AGENTS.md` §12 cita `.specs/features/harness-w5/liveness.md`. A hipótese do prompt ("duplicata de `.enterprise/.specs`") foi refutada por ferramenta.
- `.agents` × `.enterprise`: 129 blobs compartilhados (saída do compilador, NECESSÁRIO).
- Dentro de `docs/`: 55 blobs repetidos entre `docs/evolution/{evidence,w1..w4}` e `docs/v4` (hipótese: evidência copiada entre ondas). Cópias de evidência citadas ficam onde são citadas.

## (b) Git

### Worktrees (8 registrados)
| Caminho | Branch | Estado | Decisão técnica |
|---|---|---|---|
| principal | master | limpo | — |
| `/build/aew-graph-source-2b4d6f3` | detached `2b4d6f37` | outra sessão | OWNER-GATE, não tocar |
| `/build/tmp/hseos-accept` | `docs/accept-adr-0052` | **prunable**, diretório ausente | `git worktree prune` (autorizado) |
| `/build/tmp/hseos-det` | `docs/deterministic-first-policy` | **prunable**, diretório ausente | `git worktree prune` (autorizado) |
| `hideaki-solutions-core/.wt/hseos-ai-provider-compat` | `feature/ai-provider-native-compat` (`cd84091a`) | outra sessão | OWNER-GATE |
| `.../.worktrees/provider-native-compat` | `task/provider-native-compat` (`581fba79`) | outra sessão | OWNER-GATE |
| `.../.worktrees/provider-native-current` | `task/provider-native-current` | outra sessão, 20 mudanças não commitadas | OWNER-GATE |
| `.../.worktrees/provider-native-sync` | `task/provider-native-sync` | outra sessão, 830 mudanças não commitadas | OWNER-GATE |

O prompt listava 6 worktrees; existem 8 (dois sub-worktrees novos de outra sessão).

### Branches locais (35)
- Contida na `master`, sem worktree: `feature/ai-provider-native-current`.
- Patch-equivalentes (`git cherry` 0 `+`): `task/P12`, `P13`, `P14`, `P16`, `P17`, `P18`; `feature/stab3-{f14v4-attempt1,f14v4-cost,f14v4-harness,f15l2-attempt1,owner-decisions,reaudit4}`; `docs/accept-adr-0052`; `docs/deterministic-first-policy` (local `dadde3f6` é ancestral da remota `8f30f689`, ponta da PR #299 mesclada).
- Com commits sem equivalente (squash muda o patch-id): `feature/stab3-f14v4-spec` e `task/P15` (2), `feature/stab3-f15l2-fix` e `task/P11` (2), `task/T1a..T1d`, `T2`, `T3`, `T4`, `T5`, `T6` (1 cada), `task/T2r` (7).
- De outra sessão, com worktree: `feature/ai-provider-native-compat`, `task/provider-native-{compat,current,sync}`.

### Branches remotas (15)
| Branch | PR | `cherry +` | Decisão técnica (§1) |
|---|---|---|---|
| `docs/accept-adr-0052` | #302 MERGED | 0 | apagar |
| `docs/deterministic-first-policy` | #299 MERGED | 0 | apagar |
| `feature/stab3-{reaudit4,f15l2-attempt1,owner-decisions,f14v4-harness,f14v4-attempt1,f14v4-cost}` | #307/#308/#309/#311/#312/#313 MERGED | 0 | apagar |
| `feature/stab3-f14v4-spec` | #310 MERGED | 2 | OWNER-GATE (sem contenção nem equivalência) |
| `feature/stab3-f15l2-fix` | #306 MERGED | 2 | OWNER-GATE (idem) |
| `feature/capability-graph-governance` | #146 CLOSED | 8 | OWNER-GATE |
| `feature/solo-maintainer-protection` | sem PR | 0 (contida) | OWNER-GATE (§1 exige PR) |
| `backup/dev-claude-enterprise-hseos-20260904T233646` | — | 0 | OWNER-GATE (não autorizado) |
| `preservation/machine-rebuild-20260905/753280dba1482779` | — | 1 | OWNER-GATE (não autorizado) |

Tags `hseos-hygiene*`: 0. `hseos-terminal-close` existe no remoto (`e5835a71`).

## (c) Não versionado e scratch

| Caminho | Arquivos | Bytes | Decisão |
|---|---|---|---|
| `node_modules/` | 7892 | 91118861 | proteger |
| `.hseos/state/` | 8 | 126202325 | proteger (bancos em uso) |
| `.axon/` | 2 | 40645319 | proteger |
| `.goose/` | 71 | 435270 | proteger |
| `.husky/_/` | 17 | 1258 | proteger |
| `.logs/validation/gate-*.log` | 57 (51 com mais de 7 d) | 136203 (121104) | LIXO-LOCAL: apagar os com mais de 7 d |
| `.logs/validation/pendencies-waves/` | 7 (todos com mais de 7 d) | 1646030 | LIXO-LOCAL |
| `.logs/validation/{harness-*,w4-*}.log` | cerca de 20 | — | LIXO-LOCAL só se tiverem mais de 7 d |
| `.logs/validation/contract-coverage/` | 7 | 3599862 | manter (recente) |
| `.logs/runs/worktree-manager.log` | 1 | — | manter (ativo) |
| `$TMPDIR/hseos-*` | 933 | cerca de 310 MB | nada com mais de 7 d hoje → nada apagável pela regra; 47 entradas modificadas na última hora (testes ativos) |
| `/build/artifacts/hygiene-2026-11-06-residue/` | — | 43460 | OWNER-GATE (já pendente) |
| `$TMPDIR/{w3a-spike,w3b-spike,w3a-body.md,w3b-body.md,W3yWSR,w3kONu}` | 6 | — | dono não confirmado: não tocar |

Nota: `.logs/summaries/managed-governance-validation.md` e os `.gitkeep` são **versionados**. Saem da limpeza local e entram no grafo de referências.
