'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { summarizeProviderProof } = require('../docs/evolution/w3/evidence/shared/summarize-provider-proof.cjs');

const SCRIPT = path.join(__dirname, '../docs/evolution/w3/evidence/shared/summarize-provider-proof.cjs');
const GOOD = {
  schema_version: 1,
  auth_mode: 'credential',
  credential_sha256: 'a'.repeat(64),
  credential_source: 'request-header',
  backend_verified: true,
  requests_total: 3,
  requests_verified: 3,
};
const wrap = (proof) => ({ verification: { evidence: { provider_proof: proof } } });

test('only a fully observed proof passes', () => {
  assert.equal(summarizeProviderProof(wrap(GOOD)).verdict, 'pass');
  assert.equal(summarizeProviderProof(wrap({ ...GOOD, auth_mode: 'local', credential_sha256: undefined })).verdict, 'pass');
});

test('absent, unverified, partial or hashless proofs are unknown', () => {
  for (const value of [
    {},
    wrap({ ...GOOD, backend_verified: false }),
    wrap({ ...GOOD, requests_verified: 2 }),
    wrap({ ...GOOD, requests_total: 0, requests_verified: 0 }),
    wrap({ ...GOOD, credential_sha256: undefined }),
    wrap({ ...GOOD, backend_verified: undefined }),
  ])
    assert.equal(summarizeProviderProof(value).verdict, 'unknown');
});

test('the command exits non-zero unless the verdict is pass', () => {
  const directory = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'hseos-proof-summary-'));
  try {
    const run = (value) => {
      const file = path.join(directory, 'result.json');
      fs.writeFileSync(file, JSON.stringify(value));
      return spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8' });
    };
    assert.equal(run(wrap(GOOD)).status, 0);
    const bad = run(wrap({ ...GOOD, backend_verified: false }));
    assert.notEqual(bad.status, 0);
    assert.equal(JSON.parse(bad.stdout).verdict, 'unknown');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
