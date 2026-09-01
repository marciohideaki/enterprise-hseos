'use strict';

// Smoke test for the install emitters: portable governance source scaffolds,
// the pre-commit hook, and the root entrypoint files (AGENTS.md + the Claude
// Code pointer). Wired into `npm test` via `test:smoke-install`. Uses OS temp
// dirs so it runs cross-platform in CI.

const path = require('node:path');
const os = require('node:os');
const fs = require('fs-extra');
const assert = require('node:assert/strict');

const { Installer } = require('../tools/cli/installers/lib/core/installer');
const { AgentCoreCompiler } = require('../tools/cli/installers/lib/core/agent-core-compiler');
const { CodexSetup } = require('../tools/cli/installers/lib/ide/codex');
const { getProjectRoot } = require('../tools/cli/lib/project-root');
const uninstallCommand = require('../tools/cli/commands/uninstall');

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log(`  PASS  ${label}`);
}

(async () => {
  const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-smoke-install-'));
  const NOGIT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-smoke-install-nogit-'));
  await fs.ensureDir(path.join(TEST_DIR, '.git', 'hooks'));

  const sourceRoot = getProjectRoot();
  const installer = new Installer();

  try {
    // 1. installEnterpriseOverlay — fresh copy, idempotent re-run, self-target safety
    const overlay = await installer.installEnterpriseOverlay(TEST_DIR, sourceRoot);
    check('overlay first call copies', () => assert.equal(overlay.status, 'copied'));
    check('overlay copies the constitution', () => assert.ok(fs.existsSync(path.join(TEST_DIR, '.enterprise', '.specs', 'constitution'))));

    const overlay2 = await installer.installEnterpriseOverlay(TEST_DIR, sourceRoot);
    check('overlay re-run preserves existing', () => assert.equal(overlay2.status, 'preserved'));

    const overlaySelf = await installer.installEnterpriseOverlay(sourceRoot, sourceRoot);
    check('overlay self-target is a no-op', () => assert.equal(overlaySelf.status, 'skipped-self'));

    const workflows = await installer.installGovernanceWorkflowOverlay(TEST_DIR, sourceRoot);
    check('workflow overlay first call copies', () => assert.equal(workflows.status, 'copied'));
    check('workflow overlay copies the governed registry', () =>
      assert.ok(fs.existsSync(path.join(TEST_DIR, '.hseos', 'workflows', 'registry.yaml'))),
    );

    const workflows2 = await installer.installGovernanceWorkflowOverlay(TEST_DIR, sourceRoot);
    check('workflow overlay re-run preserves existing', () => assert.equal(workflows2.status, 'preserved'));

    const workflowsSelf = await installer.installGovernanceWorkflowOverlay(sourceRoot, sourceRoot);
    check('workflow overlay self-target is a no-op', () => assert.equal(workflowsSelf.status, 'skipped-self'));

    // 2. installPreCommitHook — fresh install, idempotency, no-git case
    const hook = await installer.installPreCommitHook(TEST_DIR);
    check('pre-commit hook installs', () => assert.equal(hook.status, 'installed'));
    const hookContent = await fs.readFile(path.join(TEST_DIR, '.git', 'hooks', 'pre-commit'), 'utf8');
    check('pre-commit hook invokes quality-gates.sh', () => assert.match(hookContent, /quality-gates\.sh/));
    check('pre-commit hook declares provenance', () => assert.match(hookContent, /Installed by `hseos install`/));

    const hook2 = await installer.installPreCommitHook(TEST_DIR);
    check('pre-commit hook re-run preserves existing', () => assert.equal(hook2.status, 'preserved'));

    const hookNoGit = await installer.installPreCommitHook(NOGIT_DIR);
    check('pre-commit hook reports no-git without .git/', () => assert.equal(hookNoGit.status, 'no-git'));

    // 3. Project config — a fresh headless install has no pre-existing root
    // config, so the state writer must create it before adding its section.
    const stateManagement = { mode: 'skill-only', db_path: '.hseos/state/project.db', mcp_port: 3100 };
    await installer.writeStateManagementConfig(NOGIT_DIR, stateManagement);
    const projectConfigPath = path.join(NOGIT_DIR, '.hseos', 'config', 'hseos.config.yaml');
    check('state configuration creates a missing project config', () => assert.ok(fs.existsSync(projectConfigPath)));
    const projectConfig = require('yaml').parse(await fs.readFile(projectConfigPath, 'utf8'));
    check('fresh project config contains the selected state mode', () => assert.deepEqual(projectConfig.state_management, stateManagement));

    const uninstallYesOption = uninstallCommand.options.find((option) => option[0].includes('--yes'))?.[1] || '';
    check('uninstall contract explicitly preserves portable governance', () => assert.match(uninstallYesOption, /portable governance/i));

    // 4. compile emits the root entrypoints: AGENTS.md + the Claude Code pointer
    const hseosDir = path.join(TEST_DIR, '.hseos');
    await fs.ensureDir(hseosDir);
    const compiler = new AgentCoreCompiler();
    await compiler.compile(TEST_DIR, hseosDir, { platforms: ['claude-code', 'codex'] });

    const agentsMdPath = path.join(TEST_DIR, 'AGENTS.md');
    const claudeMdPath = path.join(TEST_DIR, 'CLAUDE.md');
    check('compile emits AGENTS.md', () => assert.ok(fs.existsSync(agentsMdPath)));
    const agentsMd = await fs.readFile(agentsMdPath, 'utf8');
    check('AGENTS.md has the expected header', () => assert.match(agentsMd, /^# AGENTS\.md/m));
    check('AGENTS.md points at PROJECT.md', () => assert.match(agentsMd, /\.agents\/instructions\/PROJECT\.md/));

    check('compile emits the root entrypoint pointer', () => assert.ok(fs.existsSync(claudeMdPath)));
    const claudeMd = await fs.readFile(claudeMdPath, 'utf8');
    check('the pointer routes to AGENTS.md', () => assert.match(claudeMd, /Read `AGENTS\.md`/));

    // 5. Codex cleanup owns generated launchers, not compiler-governed skills.
    const skillsDir = path.join(TEST_DIR, '.agents', 'skills');
    const governedSkill = path.join(skillsDir, 'hseos-goal-loop', 'SKILL.md');
    const staleLauncher = path.join(skillsDir, 'hseos-stale-launcher', 'SKILL.md');
    await fs.outputFile(staleLauncher, 'stale generated launcher\n', 'utf8');
    await new CodexSetup().clearOldHseosSkills(skillsDir, { silent: true });
    check('Codex cleanup preserves compiler-governed hseos skills', () => assert.ok(fs.existsSync(governedSkill)));
    check('Codex cleanup removes stale generated launchers', () => assert.ok(!fs.existsSync(staleLauncher)));

    // 6. Idempotency — a pre-existing entrypoint must survive re-compile
    const custom = '# CUSTOM\n\nUser-authored content that must survive re-install.\n';
    await fs.writeFile(agentsMdPath, custom, 'utf8');
    await fs.writeFile(claudeMdPath, custom, 'utf8');
    await compiler.compile(TEST_DIR, hseosDir, { platforms: ['claude-code', 'codex'] });
    check('pre-existing AGENTS.md is not overwritten', () => assert.equal(fs.readFileSync(agentsMdPath, 'utf8'), custom));
    check('pre-existing root pointer is not overwritten', () => assert.equal(fs.readFileSync(claudeMdPath, 'utf8'), custom));

    console.log(`\nInstall emit smoke: ${passed} passed, 0 failed`);
  } finally {
    await fs.remove(TEST_DIR);
    await fs.remove(NOGIT_DIR);
  }
})().catch((error) => {
  console.error('  FAIL', error && error.message ? error.message : error);
  process.exit(1);
});
