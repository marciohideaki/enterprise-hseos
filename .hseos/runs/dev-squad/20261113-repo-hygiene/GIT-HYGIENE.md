# GIT-HYGIENE — onda HB (run 20261113-repo-hygiene)

Base: `master` = `origin/master` = a4fabbd5, checkout principal limpo. Nenhum force-push, nenhum stash/checkout/switch, nenhuma reescrita de histórico, nenhuma atribuição de IA.

## Antes / depois
| Item | Antes | Depois |
|---|---|---|
| Worktrees (inclui principal) | 9 (2 prunable) | 7 |
| Branches locais | 36 | 8 |
| Branches remotas (`ls-remote --heads`) | 17 | 9 |
| Refs `refs/remotes` | 18 | 10 |

Recibos em `$TMPDIR/hygiene-20261113/hb/`: `before-*.txt`, `after-*.txt`, `diff-*.txt`, `branch-status.txt`, `classify.tsv`, `bundle-verify.txt`, `delete-local.txt`, `delete-remote.txt`.

## Ações
1. Recibo antes: `git worktree list --porcelain`, `git for-each-ref refs/heads refs/remotes`, `git ls-remote --heads origin`.
2. Preservação: `git bundle create <nome>.bundle <branch>` para as 14 branches com `git cherry` `+` (lista esperada confirmada, sem divergência); `git bundle verify` com rc=0 nos 14; `sha256sum -c SHA256SUMS` com 14 OK.
3. `git worktree prune -v`: removeu só `/build/tmp/hseos-accept` e `/build/tmp/hseos-det` (prunable).
4. `git branch -D` em 28 branches locais (cada uma sem worktree, e com `cherry` sem `+` ou bundle verificado). Saída em `delete-local.txt`.
5. `git push origin --delete` em 8 remotas, depois de conferir PR MERGED, `ls-remote` igual ao `headRefOid` e `cherry` sem `+`. Nenhuma divergiu, nenhuma virou OWNER-GATE:
   - docs/accept-adr-0052 PR#302 MERGED oid=aa8ccf1b4c72285f5788454685dd0a0447134550 remote=aa8ccf1b4c72285f5788454685dd0a0447134550 plus=0
   - docs/deterministic-first-policy PR#299 MERGED oid=8f30f689f788b35729c6482d05d04622a6610715 remote=8f30f689f788b35729c6482d05d04622a6610715 plus=0
   - feature/stab3-reaudit4 PR#307 MERGED oid=075c351b694eb77e54fee5aa2cf197cb949cca1a remote=075c351b694eb77e54fee5aa2cf197cb949cca1a plus=0
   - feature/stab3-f15l2-attempt1 PR#308 MERGED oid=78c5406b9df362175f2ac56120ab02a20548963b remote=78c5406b9df362175f2ac56120ab02a20548963b plus=0
   - feature/stab3-owner-decisions PR#309 MERGED oid=55118dc5e1b625ba689149d440a70e678cc4377d remote=55118dc5e1b625ba689149d440a70e678cc4377d plus=0
   - feature/stab3-f14v4-harness PR#311 MERGED oid=b3bb83a5117e0a5ddb0e118dfcd0a0e89f60bad8 remote=b3bb83a5117e0a5ddb0e118dfcd0a0e89f60bad8 plus=0
   - feature/stab3-f14v4-attempt1 PR#312 MERGED oid=696121ba49644f5ef4eef4a0a29438ec08ed1ffe remote=696121ba49644f5ef4eef4a0a29438ec08ed1ffe plus=0
   - feature/stab3-f14v4-cost PR#313 MERGED oid=6e549f8d5b7bd26eb74eccf509c34b12b3704bca remote=6e549f8d5b7bd26eb74eccf509c34b12b3704bca plus=0
6. Recibo depois: mesmos comandos, diff e `git fetch --prune origin` (ok).

### Locais apagadas (28)
docs/accept-adr-0052, docs/deterministic-first-policy, feature/stab3-{f14v4-attempt1,f14v4-cost,f14v4-harness,f15l2-attempt1,owner-decisions,reaudit4,f14v4-spec,f15l2-fix}, task/P11 a P18, task/T1a, T1b, T1c, T1d, T2, T2r, T3, T4, T5, T6.

## Bundles (`/build/artifacts/hygiene-20261113/`)
Todos: `git bundle verify` rc=0 e `sha256sum -c` OK. Recuperação: `git fetch <bundle> <branch>:<branch>`.

```
1976e8f1b484fca43aed752e2240e67a477091fa6721879bd9fb8e5f20af3fe3  feature-stab3-f14v4-spec.bundle
799443e35536a11b0c10f1b1804bbf21b117599a53a411fe7646dbbb01a6a0dd  feature-stab3-f15l2-fix.bundle
1a808fd6ba508fba11be318ea1b04ddbca4d2f0cf223d8b330f56065c0a246ea  task-P11.bundle
5bd8e10410af320e4257098017e857275d54886bf32fd73cc014ce606386ae77  task-P15.bundle
94e88dac3f93e1b1bcc0bff695bc40dbe341d797d208d68ca2630f887ec15cf8  task-T1a.bundle
12281c25ec9cc334d595a31ae8409ff44a124aba0ae8d1cb09bf3b0126a28906  task-T1b.bundle
a3736d9d6ca6e958000e329be23e0add744c4e9ba5de3962879694c202402a1f  task-T1c.bundle
b5e3914cbac803cd3ac23d0a63366e7a6c8a7b8fe384682bbbe0787843479661  task-T1d.bundle
152a289d419fb8a49bcfb9c99e539009c904b5ca97fa91c3d2b7762b7a1cd5fa  task-T2.bundle
1272954c4c766496e22614fde42a3a4560190de5bae72fcf04ac87e8242fe10d  task-T2r.bundle
01c7f9bc13810a7a36685e20f839c6e3179a6ff542f2e7e99b329498b6ebed95  task-T3.bundle
e426222cea3fd5fba99d4c770447bbfb107e8a9c3dd61ab7465f62e71502cbcb  task-T4.bundle
8ffc7d3297bb008c54555d55e2bdec0d47f6c17c858a5c5426d498cb71e553fc  task-T5.bundle
68ef6f98aa31212462ab5c5fdf092ed9ce984b21b59238c31704592e3c52b566  task-T6.bundle
```

## Integrado / superado / único
Critério por arquivo contra `origin/master`: integrado = idêntico na master; superado = difere porque a master o alterou depois; único = ausente na master.
Totais: 0 único; 138 linhas arquivo-por-branch. Resumo por branch (detalhe completo em `README.md` do diretório dos bundles e `classify.tsv`):

| Branch | integrado | superado | único |
|---|---|---|---|
| task/P11 | 58 | 1 | 0 |
| task/P15 | 0 | 1 | 0 |
| task/T1a | 1 | 0 | 0 |
| task/T1b | 1 | 0 | 0 |
| task/T1c | 1 | 0 | 0 |
| task/T1d | 1 | 0 | 0 |
| task/T2 | 0 | 1 | 0 |
| task/T2r | 5 | 1 | 0 |
| task/T3 | 1 | 0 | 0 |
| task/T4 | 0 | 1 | 0 |
| task/T5 | 1 | 0 | 0 |
| task/T6 | 2 | 2 | 0 |
| feature/stab3-f14v4-spec | 0 | 1 | 0 |
| feature/stab3-f15l2-fix | 58 | 1 | 0 |

Arquivos superados:
- task/P11: docs/evolution/w3/F15-L2-2026-11.md, superado (51b81cf1 docs(evolution): record the owner decisions on the F14 v3 reaudit and the F15 L2 closure (#309))
- task/P15: docs/evolution/w3/stab2/F14-V4-PROTOCOL.md, superado (99a54dcc feat(evolution): cap the F14 v4 spend with the provider cache discount and the console credit (#313))
- task/T2: docs/evolution/w3/stab2/T2.md, superado (e20f2df8 fix(runtime): keep the latest tool result visible and prune older results first (#296))
- task/T2r: docs/evolution/w3/stab2/T2.md, superado (e20f2df8 fix(runtime): keep the latest tool result visible and prune older results first (#296))
- task/T4: docs/evolution/w3/stab2/T4.md, superado (0ac9fe21 docs(evolution): record the F14 v4 real execution of 2026-11-09 and the owner decisions (#312))
- task/T6: docs/evolution/pendencias-w0-w5/MAPA.md, superado (bd13773b docs(evolution): reconcile the living evolution docs with the terminal closeout)
- task/T6: docs/evolution/w3/L1-LOCAL-MODEL-2026-11.md, superado (11efb32e fix(evolution): make the local model binding usable and probe its effective window in campaigns (#293))
- feature/stab3-f14v4-spec: docs/evolution/w3/stab2/F14-V4-PROTOCOL.md, superado (99a54dcc feat(evolution): cap the F14 v4 spend with the provider cache discount and the console credit (#313))
- feature/stab3-f15l2-fix: docs/evolution/w3/F15-L2-2026-11.md, superado (51b81cf1 docs(evolution): record the owner decisions on the F14 v3 reaudit and the F15 L2 closure (#309))

## Intocado e por quê
- `master`: proibido.
- Locais: `feature/ai-provider-native-compat` (PR #320), `feature/ai-provider-native-current` (outra sessão), `task/provider-native-*` (4, worktrees em `.wt/`), `feature/repo-hygiene-ha` (PR #321 aberta).
- Remotas: `backup/dev-claude-enterprise-hseos-20260904T233646`, `preservation/machine-rebuild-20260905/*` (backup/preservation); `feature/capability-graph-governance`, `feature/solo-maintainer-protection`, `feature/ai-provider-native-compat`, `feature/repo-hygiene-ha` (fora de escopo ou PR aberta); `feature/stab3-f14v4-spec` e `feature/stab3-f15l2-fix` (OWNER-GATE, só as cópias locais saíram).
- Worktrees `/build/aew-graph-source-2b4d6f3` e `.wt/hseos-ai-provider-compat/*`: proibido.

## O que esta onda não prova
- Não prova que o conteúdo das branches `plus=0` esteja na master por patch-id idêntico além do `git cherry`; a equivalência vem do `cherry`, não de revisão humana.
- Superado significa só que a master alterou o arquivo depois; não foi avaliado se a versão da branch tinha valor que se perdeu (por isso os bundles).
- Os bundles ficam na mesma máquina (`/build/artifacts`); não há cópia externa.
- Não verifiquei se as branches remotas OWNER-GATE continuam necessárias.
- Os conteúdos das `.wt/` de outras sessões não foram inspecionados.

Ressalva do recibo: `before-worktrees.txt` foi capturado através do rewrite do rtk e saiu compactado (9 linhas, formato não porcelain). A contagem "9 worktrees antes" vem dele e da conferência: 7 restantes mais os 2 registros removidos pelo prune. `after-worktrees.txt` está em porcelain completo, então o diff de worktrees não é textualmente comparável. Os recibos de refs e `ls-remote` estão íntegros.
