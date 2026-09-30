'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const packageRoot = path.join(process.cwd(), 'node_modules', 'hseos');
  const { CodexAppServerDriver } = require(path.join(packageRoot, 'packages', 'runtime-providers', 'codex-app-server-driver'));
  const { engineeringDigest } = require(path.join(packageRoot, 'tools', 'cli', 'lib', 'engineering-task-state'));
  const binding = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const driver = new CodexAppServerDriver({
    executable: binding.executable,
    args: binding.args,
    cwd: process.cwd(),
    env: {
      HOME: process.env.HOME,
      CODEX_HOME: process.env.CODEX_HOME,
      PATH: process.env.PATH,
    },
  });
  try {
    const { identity, quota } = await driver.inspectAccount();
    const bucket = quota?.rateLimitsByLimitId?.codex || quota?.rateLimits;
    const windows = [bucket?.primary, bucket?.secondary].filter(Boolean);
    const now = Date.now();
    assert.equal(identity?.account?.type, 'chatgpt');
    assert.equal(typeof identity.account.email, 'string');
    assert.equal(bucket?.limitId, 'codex');
    assert.equal(bucket.rateLimitReachedType, null);
    assert.equal(bucket.credits?.hasCredits, false);
    assert.equal(bucket.credits?.unlimited, false);
    assert.ok(windows.length > 0 && windows.every((window) => window.usedPercent < 100 && window.resetsAt * 1000 > now));
    process.stdout.write(
      JSON.stringify({
        schema_version: 1,
        observed_at: now,
        account_type: identity.account.type,
        account_sha256: engineeringDigest({ type: 'chatgpt', email: identity.account.email }),
        route: 'account',
        paid_credits: false,
        ordinary_usage_allowed: true,
        quota_windows: windows.map((window) => ({ used_percent: window.usedPercent, resets_at: window.resetsAt * 1000 })),
        inference_executed: false,
      }) + '\n',
    );
  } finally {
    await driver.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.code || error.message}\n`);
  process.exitCode = 1;
});
