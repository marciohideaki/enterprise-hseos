'use strict';
// usage: node summarize-provider-proof.cjs <result.json>
// Reads the `provider_proof` of an engineering task result (agent evidence output, or the result evidence itself)
// and approves it only when the adapter observed the backend on every request. Anything else is `unknown`.
const fs = require('node:fs');

function findProof(value) {
  if (!value || typeof value !== 'object') return;
  if (value.provider_proof && typeof value.provider_proof === 'object') return value.provider_proof;
  for (const child of Object.values(value)) {
    const found = findProof(child);
    if (found) return found;
  }
  return;
}

function summarizeProviderProof(result) {
  const proof = findProof(result);
  const failures = [];
  if (proof) {
    if (proof.backend_verified !== true) failures.push('backend-not-verified');
    if (!(Number.isInteger(proof.requests_total) && proof.requests_total > 0 && proof.requests_verified === proof.requests_total))
      failures.push('requests-not-all-verified');
    if (proof.auth_mode !== 'local' && !/^[a-f0-9]{64}$/.test(proof.credential_sha256 || '')) failures.push('credential-hash-absent');
  } else {
    failures.push('proof-absent');
  }
  return { verdict: failures.length === 0 ? 'pass' : 'unknown', failures };
}

if (require.main === module) {
  const [file] = process.argv.slice(2);
  if (!file) throw new Error('usage: node summarize-provider-proof.cjs <result.json>');
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    parsed = undefined;
  }
  const result = summarizeProviderProof(parsed);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.verdict === 'pass' ? 0 : 1;
}

module.exports = { summarizeProviderProof };
