'use strict';
// Prepara um banco ATIVADO descartavel para a K7: copia um banco v4 (ja uma copia, nunca a origem real), ativa com ADR de FIXTURE
// Accepted (opcao interna decisionsDirectory) e grava o recibo ao lado. Nunca toca em project.db real.
// Uso: node activate-db.cjs <repo-worktree> <banco-v4-copia> <destino-project.db> <backup-dir> [saida-json]
const fs = require('node:fs');
const path = require('node:path');

const [repo, v4Copy, target, backupDir, outJson] = process.argv.slice(2).map((p) => (p ? path.resolve(p) : p));
const lib = require(path.join(repo, 'tools', 'mcp-project-state', 'lib', 'operational-state-db.js'));

(async () => {
  const decisions = path.join(path.dirname(backupDir), 'adr-fixture');
  fs.mkdirSync(decisions, { recursive: true });
  fs.writeFileSync(
    path.join(decisions, 'ADR-0048-governed-execution-activation-criterion.md'),
    '# ADR-0048 (FIXTURE K7, nao e o ADR real)\n\n## Status\n\nAccepted - 2026-10-22\n',
  );
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(v4Copy, target);
  const result = await lib.activateExecutionLedger(target, { adr: 'ADR-0048', backupDir, internal: { decisionsDirectory: decisions } });
  const mode = lib.resolveGovernedExecutionMode(target);
  const summary = {
    mode,
    user_version_after: result.receipt.user_version_after,
    backup_sha256: result.receipt.backup_sha256,
    original_sha256_before: result.receipt.original_sha256_before,
  };
  if (outJson) fs.writeFileSync(outJson, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
