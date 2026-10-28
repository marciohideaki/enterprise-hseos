# T6a — Rollback da ativação exige receipt (achado A-12; padrão do owner aprovado no G2)

Leia primeiro e siga: /workspace/github/marciohideaki/enterprise-hseos/.hseos/runs/dev-squad/20261027-1900-audit-fixes/prompts/COMMON.md
Worktree: /workspace/github/marciohideaki/enterprise-hseos/.worktrees/audit-t6a-rollback (branch task/audit-t6a-rollback, feature feature/audit-fix-w2). Task id: audit-t6a-rollback. Tier: medium, escalado em +1 por mexer em integridade. G3: só edições em arquivos existentes de tools/.

## Decisão do owner (2026-10-27)
O rollback da ativação recusa quando o receipt está ausente ou não tem `original_sha256_before`, salvo flag explícita do operador. Com a flag, a restauração prossegue e a saída registra que o receipt não foi verificado.

## Código atual
- Arquivo: `tools/mcp-project-state/lib/operational-state-db.js`.
- `readReceipt` (:683) devolve `null` se o arquivo não existe. Ele já recusa JSON inválido, não-objeto e `original_sha256_before` fora do formato SHA256_HEX.
- `restoreExecutionLedgerBackup(databasePath, {backupPath, expectedSha256, receiptPath, now})` começa em :705.
  - :727 resolve o receipt como `receiptPath` ou `${backup}.receipt.json`.
  - :742 só cruza `if (receipt && receipt.original_sha256_before)`; se o receipt falta, pula em silêncio.
- Erros são `ExecutionActivationError` com `code` string, no mesmo arquivo.
- CLI: `tools/cli/commands/agent-activation-rehearsal.js`.
  - `executionActivationAction` (:60-91) chama `restoreExecutionLedgerBackup(databasePath, { backupPath: options.backup, expectedSha256: options.expectedSha256 })` e NUNCA passa `receiptPath`.
  - Opções em :96-102: `--db`, `--adr`, `--backup-dir`, `--backup`, `--expected-sha256`, `--json`.
  - O manifesto `tools/cli/command-manifest.json` é gerado por `node scripts/generate-cli-command-manifest.js`; `npm run check:cli` falha se ficar stale, então regenere com `npm run compile:cli` ou o gerador.
- Testes em `test/test-execution-ledger-activation.js`:

| Linha | Caso |
|---|---|
| :197 | rollback feliz |
| :228 | hash divergente |
| :248-266 | receipt contradiz o backup |
| :278 | sem digest |
| :293 | integridade |
| :500-571 | companion pela CLI, com rollback via `spawnSync` em :552-565 |
| :573-622 | apply e rollback reais pela CLI |
| :786-804 | receipt corrompido |

  Não há caso de receipt ausente.

## Entregas
1. **Biblioteca.**
   - Novo erro `EXECUTION_ACTIVATION_RECEIPT_REQUIRED` quando o receipt está ausente ou não tem `original_sha256_before`. A mensagem diz o caminho procurado e como prosseguir (`--receipt <path>` ou `--allow-missing-receipt`).
   - Opção `allowMissingReceipt: true` permite seguir, e o resultado ganha `receipt_verified: false`; no caminho normal, `receipt_verified: true`.
   - As demais verificações continuam obrigatórias em ambos os casos: sha do backup, `integrity_check`, `user_version` e sha da cópia.
2. **CLI.**
   - Flags `--receipt <path>`, repassada como `receiptPath`, e `--allow-missing-receipt`.
   - A saída `--json` inclui `receipt_verified`.
   - Regenere o manifesto e confirme que `node scripts/generate-cli-command-manifest.js --check` sai com 0.
3. **Testes**, vermelhos primeiro:
   - receipt removido → `EXECUTION_ACTIVATION_RECEIPT_REQUIRED`, pela biblioteca e pela CLI real;
   - com `--allow-missing-receipt` → restaura byte a byte e `receipt_verified:false`;
   - `--receipt` explícito apontando para o receipt movido → restaura com `receipt_verified:true`;
   - `--receipt` apontando para um receipt que contradiz o backup → recusa.
   - Os casos existentes seguem verdes, sem asserção alterada.
   - Mutação descartável: voltar ao pulo silencioso tem que derrubar um teste.
4. **Docs.**
   - `docs/evolution/runbooks/activation.md`: atualizar o passo de rollback com as flags novas e o significado de `receipt_verified`.
   - NÃO edite `docs/v4-migration.md`; a nota de migração fica com a task de docs T7, para evitar conflito com outra onda.

## Critérios de aceite
- Verdes, com contagem literal: `test-execution-ledger-activation.js`, `test-operational-state-db.js` e `test-agentic-activation-rehearsal.js`.
- `node scripts/generate-cli-command-manifest.js --check` sai com 0.
- c8: `operational-state-db.js` NÃO está no `.c8-kernel.json`; mesmo assim, informe a cobertura das linhas novas.
- eslint (`node_modules/.bin/eslint`) e prettier limpos; `node --test test/test-package-surface.js` verde.
- 1 commit: `fix(activation): refuse a rollback without a verifiable receipt unless explicitly allowed` (≤100 chars).
