const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const agentCoreCommand = require('../tools/cli/commands/agent-core');

let passed = 0;
let failed = 0;

function assertPass(label, condition, details = '') {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}${details ? ` — ${details}` : ''}`);
    failed++;
  }
}

async function withTempDir(fn) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-compile-check-test-'));
  try {
    return await fn(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testCheckPassesWithoutWriting() {
  await withTempDir(async (tempDir) => {
    await agentCoreCommand.action('compile', { directory: tempDir, target: 'claude-code' });
    const manifestPath = path.join(tempDir, '.agents', 'manifest.yaml');
    const before = fs.readFileSync(manifestPath, 'utf8');

    await agentCoreCommand.action('compile', { directory: tempDir, check: true });

    assertPass(
      'compile --check accepts generated artifacts without rewriting them',
      fs.readFileSync(manifestPath, 'utf8') === before,
    );
  });
}

async function testCheckRejectsDrift() {
  await withTempDir(async (tempDir) => {
    await agentCoreCommand.action('compile', { directory: tempDir, target: 'claude-code' });
    const handlerPath = path.join(tempDir, '.agents', 'hooks', 'handlers', 'plan-lint.sh');
    fs.appendFileSync(handlerPath, '\n# intentional test drift\n');

    let rejected = false;
    try {
      await agentCoreCommand.action('compile', { directory: tempDir, check: true });
    } catch (error) {
      rejected = /compile --check failed/.test(error.message);
    }
    assertPass('compile --check rejects generated-artifact drift', rejected);
  });
}

async function main() {
  await testCheckPassesWithoutWriting();
  await testCheckRejectsDrift();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
