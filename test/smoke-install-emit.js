'use strict';

// Smoke test for the new install emitters: AGENTS.md, .enterprise/ scaffold,
// pre-commit hook. Not part of the standard test suite — invoked manually
// during development of feat/install-complete-emit. Safe to delete.

const path = require('node:path');
const fs = require('fs-extra');
const assert = require('node:assert/strict');

const { Installer } = require('../tools/cli/installers/lib/core/installer');
const { AgentCoreCompiler } = require('../tools/cli/installers/lib/core/agent-core-compiler');
const { getProjectRoot } = require('../tools/cli/lib/project-root');

(async () => {
  const TEST_DIR = path.resolve('C:/temp/hseos-smoke-test');
  await fs.remove(TEST_DIR);
  await fs.ensureDir(TEST_DIR);
  await fs.ensureDir(path.join(TEST_DIR, '.git', 'hooks'));

  const sourceRoot = getProjectRoot();
  const installer = new Installer();

  console.log('[smoke] projectDir =', TEST_DIR);
  console.log('[smoke] sourceRoot =', sourceRoot);

  // 1. installEnterpriseOverlay (fresh)
  const overlay = await installer.installEnterpriseOverlay(TEST_DIR, sourceRoot);
  console.log('[smoke] overlay #1:', overlay);
  assert.equal(overlay.status, 'copied', 'first call should copy');
  assert.ok(await fs.pathExists(path.join(TEST_DIR, '.enterprise', '.specs', 'constitution')),
    '.enterprise/.specs/constitution should exist after copy');

  // 2. installEnterpriseOverlay (re-run idempotency)
  const overlay2 = await installer.installEnterpriseOverlay(TEST_DIR, sourceRoot);
  console.log('[smoke] overlay #2:', overlay2);
  assert.equal(overlay2.status, 'preserved', 'second call should preserve existing');

  // 3. installEnterpriseOverlay (self-target safety)
  const overlaySelf = await installer.installEnterpriseOverlay(sourceRoot, sourceRoot);
  console.log('[smoke] overlay self:', overlaySelf);
  assert.equal(overlaySelf.status, 'skipped-self', 'sourceRoot === target should be a no-op');

  // 4. installPreCommitHook (fresh)
  const hook = await installer.installPreCommitHook(TEST_DIR);
  console.log('[smoke] hook #1:', hook);
  assert.equal(hook.status, 'installed', 'first call should install');
  const hookContent = await fs.readFile(path.join(TEST_DIR, '.git', 'hooks', 'pre-commit'), 'utf8');
  assert.match(hookContent, /quality-gates\.sh/, 'hook should invoke quality-gates.sh');
  assert.match(hookContent, /Installed by `hseos install`/, 'hook should declare provenance');

  // 5. installPreCommitHook (re-run idempotency)
  const hook2 = await installer.installPreCommitHook(TEST_DIR);
  console.log('[smoke] hook #2:', hook2);
  assert.equal(hook2.status, 'preserved', 'second call should preserve existing');

  // 6. installPreCommitHook (no .git/)
  const nogitDir = path.join(TEST_DIR, '..', 'hseos-smoke-nogit');
  await fs.remove(nogitDir);
  await fs.ensureDir(nogitDir);
  const hookNoGit = await installer.installPreCommitHook(nogitDir);
  console.log('[smoke] hook nogit:', hookNoGit);
  assert.equal(hookNoGit.status, 'no-git', 'missing .git/ should report no-git');
  await fs.remove(nogitDir);

  // 7. AgentCoreCompiler.compile writes AGENTS.md via the new agents-md adapter
  const hseosDir = path.join(TEST_DIR, '.hseos');
  await fs.ensureDir(hseosDir);
  const compiler = new AgentCoreCompiler();
  const stats = await compiler.compile(TEST_DIR, hseosDir, { platforms: ['claude-code', 'codex'] });
  console.log('[smoke] compile stats:', stats);
  const agentsMdPath = path.join(TEST_DIR, 'AGENTS.md');
  assert.ok(await fs.pathExists(agentsMdPath), 'AGENTS.md should exist after compile');
  const agentsMd = await fs.readFile(agentsMdPath, 'utf8');
  assert.match(agentsMd, /^# AGENTS\.md/m, 'AGENTS.md should start with the expected header');
  assert.match(agentsMd, /\.agents\/instructions\/PROJECT\.md/, 'AGENTS.md should point at PROJECT.md');

  // 8. AGENTS.md idempotency — modify and ensure second compile preserves user content
  const customAgentsMd = '# CUSTOM\n\nUser-authored content that must survive re-install.\n';
  await fs.writeFile(agentsMdPath, customAgentsMd, 'utf8');
  await compiler.compile(TEST_DIR, hseosDir, { platforms: ['claude-code', 'codex'] });
  const afterRecompile = await fs.readFile(agentsMdPath, 'utf8');
  assert.equal(afterRecompile, customAgentsMd, 'pre-existing AGENTS.md must NOT be overwritten by re-compile');

  console.log('\n[smoke] ALL ASSERTIONS PASSED ✔');
  await fs.remove(TEST_DIR);
})().catch((error) => {
  console.error('[smoke] FAILED:', error);
  process.exit(1);
});
