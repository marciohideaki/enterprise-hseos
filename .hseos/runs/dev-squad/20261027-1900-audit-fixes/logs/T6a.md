# T6a — relatório do executor (exec-t6a), recebido 2026-10-28T00:33Z

Commit `aaa71e3a` em `task/audit-t6a-rollback` ("fix(activation): refuse a rollback without a verifiable receipt unless explicitly allowed").

## Alegações do executor

**Biblioteca e CLI**
- Biblioteca: receipt ausente ou sem `original_sha256_before` lança `EXECUTION_ACTIVATION_RECEIPT_REQUIRED`. A mensagem traz o caminho e cita `--receipt` e `--allow-missing-receipt`.
- A opção `allowMissingReceipt` permite seguir. O resultado ganha `receipt_verified` (true/false), e as demais verificações continuam obrigatórias.
- CLI: `--receipt <path>` e `--allow-missing-receipt`. A saída mostra `receipt verified`, e o `--json` traz o campo.
- O manifesto foi regenerado; `--check` sai com 0.
- Runbook `docs/evolution/runbooks/activation.md` atualizado. `v4-migration.md` não foi tocado.

**Testes novos (biblioteca e CLI real)**
- `true` com receipt.
- Ausente → recusa; com a flag → restaura byte a byte, `receipt_verified:false`.
- Sem `original_sha256_before` → recusa.
- A flag não afrouxa o hash.
- `receiptPath` explícito: o válido restaura, o contraditório recusa.
- CLI: recusa e `--receipt`, em ambos os sentidos, mais `--allow-missing-receipt`.
- Nenhuma asserção existente foi alterada.

**Evidência**
- Mutação (`if (false)`): 6 falhas em 35. Três vêm do defeito da cópia (sem `docs/` e ADRs), não da mutação.
- O vermelho no worktree não foi provado: o executor perdeu o patch com o `rtk git diff` e refez a implementação.
- Verde: 45/45 nos 3 arquivos, ANTES da divisão de um teste de CLI. Hook de pre-commit: 132/132. Package-surface: 1/1. Eslint e prettier: 0.

**Fora do escopo**
- Defeito encontrado: dois rollbacks no mesmo segundo colidem no nome `…activated-<stamp>` (resolução de 1 s) → `BACKUP_EXISTS`. O teste foi dividido em dois. É fail-closed. Registrado como resíduo baixo.
- c8: não rodado (`operational-state-db.js` fora do kernel).
