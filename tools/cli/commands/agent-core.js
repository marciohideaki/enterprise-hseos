const path = require('node:path');
const { AgentCoreCompiler } = require('../installers/lib/core/agent-core-compiler');
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

async function runVerify() {
  await prompts.log.warn(
    'hseos agent-core verify: integrity check (sha256 chain) lands in Wave 6 (Self-Verification). See ADR-0007 §verify pipeline.',
  );
}

async function runAudit() {
  await prompts.log.warn(
    'hseos agent-core audit: source-vs-compiled drift detection lands in Wave 6 (Self-Verification). See ADR-0007 §verify pipeline.',
  );
}

async function runDoctor() {
  await prompts.log.warn(
    'hseos agent-core doctor: 8-check health report lands in Wave 6 (Self-Verification). See ADR-0006 §Self-Verification System.',
  );
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
      await runVerify();
      return;
    }
    if (action === 'audit') {
      await runAudit();
      return;
    }
    if (action === 'doctor') {
      await runDoctor();
    }
  },
};
