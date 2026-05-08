const path = require('node:path');
const { AgentCoreCompiler } = require('../installers/lib/core/agent-core-compiler');
const { runIntegrity } = require('../installers/lib/core/agent-core-compiler/verify/integrity');
const { runAudit } = require('../installers/lib/core/agent-core-compiler/verify/audit');
const { runDoctor } = require('../installers/lib/core/agent-core-compiler/verify/doctor');
const prompts = require('../lib/prompts');

const SUPPORTED_ACTIONS = new Set(['compile', 'verify', 'audit', 'doctor']);

async function runCompile(projectDir, options) {
  const hseosDir = path.join(projectDir, '.hseos');
  const compiler = new AgentCoreCompiler();
  const target = options.target || 'all';
  if (target !== 'all') {
    await prompts.log.warn(
      `--target ${target}: per-adapter compile lands in a follow-up Wave 2 commit; running all targets`,
    );
  }
  const result = await compiler.compile(projectDir, hseosDir);
  await prompts.log.success(
    `Agent core compiled: ${result.skills} skills, ${result.hooks} hooks, ${result.commands} commands -> ${result.manifest}`,
  );
}

function statusLine(check) {
  return `${check.ok ? '✓' : '✗'} ${check.title}${check.details ? ` — ${check.details}` : ''}`;
}

async function runVerifyCmd(projectDir) {
  const result = await runIntegrity(projectDir);
  for (const check of result.checks) {
    if (check.ok) {
      await prompts.log.success(statusLine(check));
    } else {
      await prompts.log.error(statusLine(check));
    }
  }
  if (result.errors.length > 0) {
    await prompts.log.error(`verify: ${result.errors.length} error(s) — run \`hseos agent-core compile\` to fix.`);
    throw new Error(`hseos agent-core verify failed: ${result.errors.length} error(s)`);
  }
  if (result.checks.length === 0) {
    await prompts.log.warn('verify: no assets to check (manifest missing or empty).');
    return;
  }
  await prompts.log.success(`verify: all ${result.checks.length} check(s) passed.`);
}

async function runAuditCmd(projectDir) {
  const result = await runAudit(projectDir);
  for (const check of result.checks) {
    if (check.ok) {
      await prompts.log.success(statusLine(check));
    } else {
      await prompts.log.warn(statusLine(check));
    }
  }
  const driftCount = result.checks.filter((c) => !c.ok).length;
  if (driftCount > 0) {
    await prompts.log.warn(
      `audit: ${driftCount} drift(s) detected. Run \`hseos agent-core compile\` to re-sync.`,
    );
    return;
  }
  if (result.checks.length === 0) {
    await prompts.log.warn('audit: no assets to check (manifest missing or empty).');
    return;
  }
  await prompts.log.success(`audit: ${result.checks.length} check(s) — no drift detected.`);
}

async function runDoctorCmd(projectDir) {
  const result = await runDoctor(projectDir);
  for (const check of result.checks) {
    if (check.ok) {
      await prompts.log.success(statusLine(check));
    } else {
      await prompts.log.error(statusLine(check));
    }
  }
  const failCount = result.checks.filter((c) => !c.ok).length;
  if (failCount > 0) {
    for (const w of result.warnings) {
      await prompts.log.warn(w);
    }
    await prompts.log.error(`doctor: ${failCount}/${result.checks.length} check(s) failed.`);
    throw new Error(`hseos agent-core doctor: ${failCount} check(s) failed`);
  }
  await prompts.log.success(`doctor: all ${result.checks.length} check(s) passed.`);
}

module.exports = {
  command: 'agent-core <action>',
  description: 'Manage the vendor-neutral .agents core',
  options: [
    ['--directory <path>', 'Project directory (default: current directory)'],
    ['--target <id>', 'Adapter target id (default: all). One of claude-code, codex, cursor, continue, aider, cline, all'],
  ],
  action: async (action, options = {}) => {
    if (!SUPPORTED_ACTIONS.has(action)) {
      throw new Error(
        `Unsupported agent-core action: ${action}. Expected one of: ${[...SUPPORTED_ACTIONS].join(', ')}`,
      );
    }

    const projectDir = path.resolve(options.directory || process.cwd());

    if (action === 'compile') {
      await runCompile(projectDir, options);
      return;
    }
    if (action === 'verify') {
      await runVerifyCmd(projectDir);
      return;
    }
    if (action === 'audit') {
      await runAuditCmd(projectDir);
      return;
    }
    if (action === 'doctor') {
      await runDoctorCmd(projectDir);
    }
  },
};
