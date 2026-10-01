'use strict';

const fs = require('node:fs');
const path = require('node:path');
const prompts = require('../lib/prompts');
const { getProjectRoot } = require('../lib/project-root');
const { loadCapabilityCatalog, resolveCapabilityPlan } = require('../lib/capability-catalog');
const { PLATFORM_MODES, checkModeRef, detectStacks, modeStrength } = require('../lib/platform-bindings');
const { baselineMode } = require('../lib/platform-bindings-cli');

const MODE_CHOICES = [
  { name: 'platform (recommended)', value: 'platform', hint: 'Consume shared platform capabilities; new shareable exports need an intake' },
  { name: 'hybrid', value: 'hybrid', hint: 'Platform for stable capabilities, local implementation otherwise' },
  { name: 'local', value: 'local', hint: 'Implement locally; requires a decision record' },
];

function summarizePlan(plan, directory, bindings) {
  const prerequisites = plan.components.flatMap((component) =>
    (component.prerequisites || []).map((requirement) => `  ${component.id}: ${requirement}`),
  );
  return [
    `Project: ${directory}`,
    `Profile: ${plan.profile_name || plan.profile}`,
    `Hook profile: ${plan.hook_profile}`,
    `Components: ${plan.components.length}; skills: ${plan.skills.length}; paths: ${plan.install_paths.length}`,
    `Adapters: ${plan.tools.join(', ') || 'none'}`,
    ...(bindings ? [`Platform bindings: ${bindings.mode} (${bindings.stacks.join(', ') || 'no stacks detected'})`] : []),
    prerequisites.length > 0 ? `Optional prerequisites:\n${prerequisites.join('\n')}` : 'No external prerequisites selected.',
    '',
    'The selected profile installs project files. External credentials and operational authority remain separate.',
  ].join('\n');
}

module.exports = {
  command: 'init',
  description: 'Guide a new project through HSEOS profile selection, plan review, and installation',
  options: [['--directory <path>', 'Project directory (default: current directory)']],
  action: async (options = {}) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error('hseos init requires an interactive terminal; use hseos install-plan and hseos install in automation');
    }

    const directory = path.resolve(options.directory || process.cwd());
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
      throw new Error(`Project directory does not exist: ${directory}`);
    }

    const catalog = loadCapabilityCatalog(getProjectRoot());
    const profile = await prompts.select({
      message: 'Which HSEOS profile fits this project?',
      choices: Object.entries(catalog.profiles).map(([id, entry]) => ({
        name: `${entry.name}${entry.default ? ' (recommended)' : ''}`,
        value: id,
        hint: entry.description,
      })),
      default: Object.keys(catalog.profiles).find((id) => catalog.profiles[id].default),
    });
    const plan = resolveCapabilityPlan({ root: getProjectRoot(), profile });
    const stacks = detectStacks(directory);
    const platformMode = await prompts.select({
      message: `How should this project use platform capabilities? Detected stacks: ${stacks.join(', ') || 'none'}`,
      choices: MODE_CHOICES,
      default: 'platform',
    });
    let modeRef;
    if (modeStrength(platformMode) < modeStrength(baselineMode(directory))) {
      modeRef = (
        await prompts.text({
          message: `Repository-relative decision record that justifies mode '${platformMode}' (docs/decisions/<file>.md)`,
          validate: (value) => checkModeRef(directory, String(value || '').trim()) || undefined,
        })
      ).trim();
    }
    await prompts.note(summarizePlan(plan, directory, { mode: platformMode, stacks }), 'HSEOS install plan');
    const approved = await prompts.confirm({
      message: 'Continue with project installation?',
      default: false,
    });
    if (!approved) {
      await prompts.log.info('No project files were installed. Inspect the full plan with hseos install-plan --profile ' + profile);
      return;
    }

    return require('./install').action({ directory, profile, platformMode, ...(modeRef ? { modeRef } : {}) });
  },
  summarizePlan,
};
