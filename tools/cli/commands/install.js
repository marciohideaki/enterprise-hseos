const path = require('node:path');
const prompts = require('../lib/prompts');
const { Installer } = require('../installers/lib/core/installer');
const { UI } = require('../lib/ui');
const { getProjectRoot } = require('../lib/project-root');
const { parseCsv, resolveCapabilityPlan, writeCapabilitySelection } = require('../lib/capability-catalog');

const installer = new Installer();
const ui = new UI();

/**
 * Map selected `extra:*` capability components onto the corresponding install
 * flags, so a component selection IS the activation (explicit flags win).
 * Returns advisory notes for extras that still need operator input.
 */
function applyExtrasFromPlan(options, capabilityPlan) {
  const notes = [];
  const selected = new Set((capabilityPlan?.components || []).map((component) => component.id));

  if (selected.has('extra:rtk') && options.rtk === undefined) {
    options.rtk = true;
    notes.push('extra:rtk selected — RTK will patch the user-global Claude Code settings (cross-project side effect).');
  }
  if (selected.has('extra:usage-dashboard') && options.usageDashboard === undefined) {
    options.usageDashboard = 'local';
  }
  if (selected.has('extra:second-brain') && !options.secondBrainPath) {
    notes.push('extra:second-brain selected but no --second-brain-path given — the interactive wizard will ask for the vault path.');
  }
  if (selected.has('extra:git-hooks') && options.gitHooks === false) {
    notes.push('extra:git-hooks selected but --no-git-hooks passed — the explicit flag wins; hook will NOT be installed.');
  }

  return notes;
}

module.exports = {
  applyExtrasFromPlan,
  command: 'install',
  description: 'Install HSEOS agents and framework',
  options: [
    ['-d, --debug', 'Enable debug output for manifest generation'],
    ['--directory <path>', 'Installation directory (default: current directory)'],
    ['--modules <modules>', 'Comma-separated list of module IDs to install (e.g., "bmm,bmb")'],
    ['--profile <id>', 'Capability profile id to resolve before install'],
    ['--components <ids>', 'Comma-separated capability component IDs to include'],
    ['--skills <ids>', 'Comma-separated governed skill IDs to include as skill components'],
    ['--hook-profile <id>', 'Hook profile intent: advisory, standard, strict, or ci'],
    [
      '--tools <tools>',
      'Comma-separated list of tool/IDE IDs to configure (e.g., "claude-code,cursor"). Use "none" to skip tool configuration.',
    ],
    ['--custom-content <paths>', 'Comma-separated list of paths to custom modules/agents/workflows'],
    ['--action <type>', 'Action type for existing installations: install, update, quick-update, or compile-agents'],
    ['--user-name <name>', 'Name for agents to use (default: system username)'],
    ['--communication-language <lang>', 'Language for agent communication (default: English)'],
    ['--document-output-language <lang>', 'Language for document output (default: English)'],
    ['--output-folder <path>', 'Output folder path relative to project root (default: .hseos-output)'],
    ['-y, --yes', 'Accept all defaults and skip prompts where possible'],
    ['--second-brain-path <path>', 'Absolute path to second-brain vault (enables integration if provided)'],
    ['--rtk', 'Install RTK token optimizer (intercepts CLI commands to reduce LLM token usage by 60-90%)'],
    [
      '--usage-dashboard [mode]',
      'Install usage analytics dashboard. Mode: "local" (Python, default) or "docker" (Docker Compose, externally accessible)',
    ],
    [
      '--no-git-hooks',
      'Skip writing the pre-commit hook at .git/hooks/pre-commit. Default: install the hook when the target is a git working tree.',
    ],
  ],
  action: async (options) => {
    try {
      // Set debug flag as environment variable for all components
      if (options.debug) {
        process.env.HSEOS_DEBUG_MANIFEST = 'true';
        await prompts.log.info('Debug mode enabled');
      }

      const hasCapabilitySelection = Boolean(options.profile || options.components || options.skills || options.hookProfile);
      if (hasCapabilitySelection) {
        const capabilityPlan = resolveCapabilityPlan({
          root: getProjectRoot(),
          profile: options.profile,
          components: parseCsv(options.components),
          skills: parseCsv(options.skills),
          hookProfile: options.hookProfile,
        });
        options._capabilityPlan = capabilityPlan;
        if (!options.modules && capabilityPlan.modules.length > 0) {
          options.modules = capabilityPlan.modules.join(',');
        }
        if (!options.tools && capabilityPlan.tools.length > 0) {
          options.tools = capabilityPlan.tools.join(',');
        }
        const extrasNotes = applyExtrasFromPlan(options, capabilityPlan);
        for (const note of extrasNotes) {
          await prompts.log.warn(note);
        }
        await prompts.log.info(
          `Resolved capability plan: ${capabilityPlan.profile || 'custom'} (${capabilityPlan.components.length} components, ${capabilityPlan.skills.length} skills)`,
        );
      }

      const config = await ui.promptInstall(options);
      if (options._capabilityPlan) {
        config.capabilityPlan = options._capabilityPlan;
      }

      // Propagate CLI-only flags that promptInstall does not yet surface. Commander
      // maps `--no-git-hooks` to `options.gitHooks === false`.
      if (options.gitHooks === false) {
        config.noGitHooks = true;
      }

      // Handle cancel
      if (config.actionType === 'cancel') {
        await prompts.log.warn('Installation cancelled.');
        process.exit(0);
      }

      // Handle quick update separately
      if (config.actionType === 'quick-update') {
        const result = await installer.quickUpdate(config);
        await prompts.log.success('Quick update complete!');
        await prompts.log.info(`Updated ${result.moduleCount} modules with preserved settings (${result.modules.join(', ')})`);
        process.exit(0);
      }

      // Handle compile agents separately
      if (config.actionType === 'compile-agents') {
        const result = await installer.compileAgents(config);
        await prompts.log.info(`Recompiled ${result.agentCount} agents with customizations applied`);
        process.exit(0);
      }

      // Regular install/update flow
      const result = await installer.install(config);

      // Check if installation was cancelled
      if (result && result.cancelled) {
        process.exit(0);
      }

      // Check if installation succeeded
      if (result && result.success) {
        if (config.capabilityPlan) {
          const selectionPath = writeCapabilitySelection(config.directory, config.capabilityPlan);
          await prompts.log.info(`Capability selection recorded: ${selectionPath}`);
        }
        process.exit(0);
      }
    } catch (error) {
      try {
        if (error.fullMessage) {
          await prompts.log.error(error.fullMessage);
        } else {
          await prompts.log.error(`Installation failed: ${error.message}`);
        }
        if (error.stack) {
          await prompts.log.message(error.stack);
        }
      } catch {
        console.error(error.fullMessage || error.message || error);
      }
      process.exit(1);
    }
  },
};
