'use strict';

const { runIntegrity } = require('./integrity');

async function runAudit(projectDir) {
  // Audit currently delegates to integrity; once the v2 manifest carries
  // .agents/.signatures/<adapter>.sha256 entries (Wave 6 implementation),
  // this module additionally walks the adapter signatures and compares
  // against freshly-computed bundle hashes per adapter.
  const integrity = await runIntegrity(projectDir);
  const checks = integrity.checks.map((c) => ({ ...c, source: 'integrity' }));

  // Pending adapter-signature drift checks are added in W6 implementation.
  return {
    ok: integrity.ok,
    checks,
    warnings: integrity.warnings,
    errors: integrity.errors,
  };
}

module.exports = { runAudit };
