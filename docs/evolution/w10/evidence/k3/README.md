# K3 — ensaio de ativação e rollback sobre cópia do `project.db` real

Prova, não implementação: nenhum código de produção mudou. Data da medição: 2026-10-22. Base: `feature/hseos-w5-closeout-w10` (a9c36468), Node 24.15.
Critério do ADR-0048 que esta evidência sustenta: **(b)** ensaio de ativação e rollback em cópia do banco. O item **(b2)** (backup do banco **real** com `integrity_check` e sha256) **não** é coberto aqui: nada foi escrito no banco real, e o backup real só existe na ativação real (W8, passo 1b).

## Conclusão

| Verificação                                                               | Resultado                                                                                                                                                                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Origem `.hseos/state/project.db` intacta                                  | **sim.** sha256, tamanho e mtime do arquivo principal idênticos antes e depois; `-wal` e `-shm` com o mesmo tamanho e mtime em nanossegundos (`source.*` em `rehearsal-result.json`)                   |
| CLI real recusa o ADR-0048 `Proposed`                                     | **sim.** `plan` sai com 2 e bloqueio `EXECUTION_ACTIVATION_ADR_NOT_ACCEPTED`; `apply` sai com 1 e o mesmo código; `apply` sem `--adr` sai com 1; a cópia continua byte a byte igual                    |
| `apply` com ADR de fixture `Accepted` (`internal.decisionsDirectory`)     | **sim.** `user_version` 4 → 17, `application_id` `0x48534f53`, `integrity_check` = `ok`, 7 tabelas novas, receipt gravado ao lado do backup                                                            |
| Preservação das tabelas 001–004                                           | **sim.** 16 tabelas pré-existentes (inclui FTS): contagem de linhas e digest sha256 do conteúdo ordenado idênticos antes e depois (`post_activation.per_table`)                                        |
| Modo resolvido e legado                                                   | depois do `apply`: `resolveGovernedExecutionMode` = `modern`; `openOperationalStateDatabase` (caminho legado) recusa com `EXECUTION_ACTIVATION_PENDING`                                                |
| `rollback`                                                                | **sim.** sha256 do banco restaurado == `original_sha256_before` do receipt == sha256 da cópia antes do `apply`; `user_version` 4; tabelas idênticas; modo `legacy`; banco ativado preservado ao lado   |
| Ensaio oficial `agentic-activation-rehearsal` (sobre o backup verificado) | `rehearsal-passed`; migração v4 → v17 e rollback prontos; origem inalterada. Gates restantes que ele mesmo lista: `provider-environment-validation`, `g9-zero-legacy-window`, `explicit-human-cutover` |
| Lock e varredura de processos                                             | com a cópia aberta neste processo, `plan` bloqueia com `EXECUTION_ACTIVATION_DATABASE_LOCKED`; `unscannable_processes` ≈ 390 (388 a 391 conforme a execução) (ver Achados)                             |

Duas variantes foram rodadas: `rehearsal-result.json` (cópia convertida para `journal_mode=delete`, arquivo único, hash estável) e `rehearsal-result-wal-mode.json` (cópia que mantém o cabeçalho WAL da origem). As duas passam em tudo acima.

## Método

`rehearse.cjs` (neste diretório): `node rehearse.cjs <worktree> <project.db> <scratch> <saída> [normalized|wal-mode]`.

1. **Origem somente leitura.** Registra sha256, tamanho e mtime do arquivo principal e tamanho/mtime em ns de `-wal` e `-shm`. Abre com `better-sqlite3` em `{ readonly: true, fileMustExist: true }` e copia pela API `db.backup` (que lê através do WAL). Nunca copia `-wal`/`-shm` brutos e nunca abre a origem para escrita. Depois do ensaio, repete a medição e compara.
2. **Cópia** em `/build/tmp/hseos-w5/closeout/k3/db/` (disco, não `/tmp`). Na variante `normalized`, `journal_mode = delete` na **cópia**; a origem não é tocada.
3. **Digests por tabela** da cópia (contagem e sha256 das linhas serializadas e ordenadas) antes do `apply`, depois do `apply` e depois do `rollback`.
4. **CLI real** (`tools/cli/hseos-cli.js execution-activation plan|apply --db <cópia> --adr ADR-0048 --backup-dir …`) contra o ADR-0048 real, que está `Proposed`: deve recusar.
5. **ADR de fixture** `ADR-0048-…md` com `## Status` / `Accepted - 2026-10-22`, em diretório temporário passado pela opção interna `internal.decisionsDirectory` da biblioteca (`tools/mcp-project-state/lib/operational-state-db.js`). Não é o ADR real e não o substitui.
6. **Lock**: `planExecutionLedgerActivation` com a cópia aberta (este processo) → bloqueio; depois `plan` limpo, `dryRun`, `apply`, verificação, `restoreExecutionLedgerBackup` (rollback), verificação.
7. **Ensaio oficial** `hseos agent-activation-rehearsal --database <cópia do backup> --repository <worktree> --json`.

Estado da origem na medição: `user_version` 4, `journal_mode` WAL, `-wal` de 663.352 bytes com última escrita em 2026-10-09 e nenhum processo escrevendo agora. O arquivo principal tem 159.744 bytes (sha256 `f4f62c0c15ef…`, mtime de 2026-09-26). A cópia tem outro sha256 (`c9dfebafc5a0…` normalizada, `686c49daa38f…` em modo WAL): é esperado, porque o `db.backup` produz bytes novos e enxerga o conteúdo do WAL. As duas cópias são pontos de partida do ensaio, não réplicas bit a bit da origem.

Resultado de integridade da origem: o hash do arquivo principal e as estatísticas de `-wal`/`-shm` não mudaram. A abertura somente leitura de um banco WAL é o único contato; este ensaio mediu e não encontrou alteração, mas não prova que uma abertura somente leitura nunca recria o `-shm` em outras condições.

## Achados (reportados, nada corrigido)

1. **`unscannable_processes` ≈ 390 (388 a 391 conforme a execução) no receipt.** A varredura de `/proc` da trava de ativação não consegue ler os descritores de ≈390 processos deste host (outros usuários, sandboxes). A prova de "banco não está aberto em outro lugar" é, portanto, parcial neste host. O receipt registra o número, o `apply` prossegue mesmo assim, e o runbook/ADR precisam decidir se um valor alto é aceitável ou se a ativação real deve rodar com os servidores comprovadamente parados por outro meio (para o piloto: parar os três MCPs do Codex e conferir `lsof`/`fuser` sobre o `project.db`).
2. **O banco piloto tem WAL com dados não checkpointados** (663 KB). O `apply` real vai executar checkpoint e recusa se o WAL ainda tiver dados (`EXECUTION_ACTIVATION_DATABASE_LOCKED`, "WAL sidecar still holds data"). Este ensaio **não** exercita esse caminho porque a cópia nasce sem sidecars. A variante `wal-mode` cobre o cabeçalho WAL, não um WAL com dados. Deve ser conferido na ativação real, com os servidores parados.
3. **O ensaio oficial ainda lista `g9-zero-legacy-window` como gate restante.** É o critério de 30 dias de zero uso legado que o ADR-0048 substitui; o relatório do ensaio só deixará de listá-lo quando o código acompanhar o ADR.
4. **Inventário de `project.db` do workspace.** `find` em `/workspace/github` (profundidade até 7, sem `node_modules` nem `.worktrees`) encontrou **18** `project.db` em `.hseos/state/` (lista de projetos em `project-db-inventory.txt`), isto é, o piloto mais **17** outros. O ADR-0048 diz "21 (a verificar na K3)": o número 21 **não foi confirmado**; a busca pode estar incompleta (profundidade e raízes), então o ADR deve citar "17 a 21, conforme levantamento" ou esperar um levantamento completo.
5. **Lista nominal de registros (parte da pré-condição do `apply`, ADR-0048 item 7).** Lida em modo somente leitura, só nomes:
   - `~/.codex/config.toml`: `hseos-governance`, `hseos-state-tracking` (project-state) e `hseos-swarm`, os três apontando para o release `2b4d6f37…` e para o `project.db` do enterprise-hseos via `HSEOS_STATE_DB`; `hseos-axon-bridge` existe com `enabled = false` e URL HTTP (não usa o `project.db`). Confirma "3 MCPs do Codex". Outros registros não-HSEOS: `axon`, `filesystem`, `mde-forge`, `playwright`.
   - `~/.claude.json`, escopo de usuário: só `axon` e `playwright` (nenhum servidor HSEOS); escopo do projeto enterprise-hseos: vazio.
   - **Não verificado:** `.mcp.json`/registros por projeto, hooks e CLIs que abram o `project.db`. A lista nominal completa do ADR (item 7) continua aberta.

## Arquivos

- `rehearse.cjs` — harness do ensaio.
- `rehearsal-result.json`, `rehearsal-result-wal-mode.json` — resultado completo de cada variante (origem antes/depois, CLI real, lock, `plan`, `apply` e receipt, digests por tabela, rollback, ensaio oficial). Caminhos do home aparecem como `~`.
- `project-db-inventory.txt` — projetos com `project.db` encontrados.

## Reproduzir

```bash
export PATH=/workspace/local/sdk/nvm/versions/node/v24.15.0/bin:$PATH
node docs/evolution/w10/evidence/k3/rehearse.cjs "$PWD" "$PWD/.hseos/state/project.db" /build/tmp/hseos-w5/closeout/k3 "$PWD/docs/evolution/w10/evidence/k3" normalized
```

O scratch (`/build/tmp/hseos-w5/closeout/k3*`) foi removido ao final; a evidência arquivada é este diretório.
