# STATUS — 20261006-2040-pendencies-closeout

Atualizado: 2026-10-06 (Commander)

| Task | Wave | Estado | Evidência |
|---|---|---|---|
| H-02 | W0 | DONE — #191 atualizada (`7da1f34a..2e1adc35`) | quality-gates 6/6 (suíte completa) no worktree; diff vs master = +39 Standard, +1 CHANGELOG |
| H-09 | W1 | DONE — `03394b59` → `feature/pendencies-closeout-w1` (`90f52700`) | `test-commit-msg.js` 72/0; quality-gates 6/6; revisão cética: 1 major corrigido (termo `authored by` solto) |
| H-05 | W1 | DONE — `2704d53e` → `feature/pendencies-closeout-w1` (`7c9dae84`) | 5/5 serial, 2/2 concorrente, retry por colisão exercitado; quality-gates 6/6; 2 rodadas de correção |
| B-03 | W2 | DONE — `81d987a` → `feature/pendencies-closeout-w2` (`fe3e73c`) | `contracts:test` 44/44; recálculo opcional via `--ecp-bundle`; PARTIAL documentado (sem tarball offline) |
| B-01 | W2 | DONE — `7b46167` → `feature/pendencies-closeout-w2` (`be8d4ae`) | falha sem o lock, passa com ele; Conformance 176/176 |
| B-02 | W2 | DONE — `697a2bc` → `feature/pendencies-closeout-w2` (`6cd65f2`) | Conformance 182/182, Approval 51/51; 2 rodadas de correção (fail-open e `$id` duplicado corrigidos) |

PRs: backend-core#25 (W2, aberta 2026-10-06). HSEOS W1: branch `feature/pendencies-closeout-w1`.

## Follow-ups registrados

- H-12: `pickPort()`/`Math.random` ainda em `test/test-mcp-agent-state.js`, `test/test-mcp-hseos-governance.js`, `test/test-native-entrypoint-wiring.js` — migrar para o helper compartilhado da H-05.
- B-07: README do backend-core afirma bundles reproduzíveis byte a byte; um tarball 0.4.0 reconstruído tem hash diferente — investigar.
- B-08: `contracts:verify` só valida o formato do `bundle_sha256` por padrão; fechar via CI com tarball baixado ou hash fixado no `SHA256SUMS` do ECP.

## Gotchas de ambiente (host local)

- `node` padrão é v22, mas `better-sqlite3` está compilado para Node 24 (ABI 137): usar `/workspace/local/sdk/nvm/versions/node/v24.15.0/bin` no PATH.
- Testes de isolamento exigem cgroup delegado: `systemd-run --user --wait --collect --pipe -p Delegate=yes -p DelegateSubgroup=tests ... bash -c 'node .github/scripts/enable-test-cgroup.mjs && ...'`.
- `/build/tmp/.codex` (de outra ferramenta) quebra os testes de ACP; `/tmp` está no limite de quota. Usar `TMPDIR=/build/hseos-qg-tmp` (modo 700).
- `git merge --no-ff -q` reescrito pelo rtk resultou em fast-forward; usar `rtk proxy git merge --no-ff`.

Aguardando owner: merge da #197 (G5); aprovação Engineering Leadership da #191; decisões D1–D9.
