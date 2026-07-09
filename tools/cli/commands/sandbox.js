'use strict';

const path = require('node:path');
const prompts = require('../lib/prompts');
const { runSandbox, sandboxDoctor } = require('../lib/sandbox');

const SUPPORTED_ACTIONS = new Set(['doctor', 'run']);

function statusLine(check) {
  const marker = check.ok ? 'PASS' : check.required ? 'FAIL' : 'WARN';
  return `[${marker}] ${check.title}: ${check.details}`;
}

async function printDoctor(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  await prompts.log.message(
    `Sandbox: ${result.configured ? 'configured' : 'optional defaults'}\n` +
      `  provider: ${result.provider}\n` +
      `  required: ${result.required ? 'true' : 'false'}`,
  );

  for (const check of result.checks) {
    if (check.ok) {
      await prompts.log.success(statusLine(check));
    } else if (check.required) {
      await prompts.log.error(statusLine(check));
    } else {
      await prompts.log.warn(statusLine(check));
    }
    if (!check.ok && check.remedy) {
      await prompts.log.message(`  next: ${check.remedy}`);
    }
  }
}

module.exports = {
  command: 'sandbox <action> [command...]',
  description: 'Inspect or run optional OS-level agent sandboxing through ai-jail',
  options: [
    ['--directory <path>', 'Project directory (default: current directory)'],
    ['--profile <name>', 'Sandbox profile for run (default: config default)'],
    ['--dry-run', 'Print the ai-jail command without executing it'],
    ['--json', 'Emit machine-readable doctor output'],
  ],
  action: async (action, command = [], options = {}) => {
    if (!SUPPORTED_ACTIONS.has(action)) {
      throw new Error(`Unsupported sandbox action: ${action}. Expected one of: ${[...SUPPORTED_ACTIONS].join(', ')}`);
    }

    const projectDir = path.resolve(options.directory || process.cwd());

    if (action === 'doctor') {
      const result = sandboxDoctor(projectDir);
      await printDoctor(result, Boolean(options.json));
      process.exitCode = result.ok ? 0 : 2;
      return;
    }

    if (!Array.isArray(command) || command.length === 0) {
      throw new Error('A command is required after `hseos sandbox run --`.');
    }

    const result = runSandbox({
      projectDir,
      profileName: options.profile,
      command,
      dryRun: Boolean(options.dryRun),
    });

    if (result.dryRun) {
      console.log(result.command);
      return;
    }

    if (result.error) {
      throw result.error;
    }

    process.exitCode = result.status;
  },
};
