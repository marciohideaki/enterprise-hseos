const path = require('node:path');
const fs = require('fs-extra');
const prompts = require('../lib/prompts');

async function loadConfig(directory) {
  const yaml = require('js-yaml');
  const configPath = path.join(directory, '.hseos', 'config', 'hseos.config.yaml');
  if (await fs.pathExists(configPath)) {
    try {
      const doc = yaml.load(await fs.readFile(configPath, 'utf8'));
      return doc?.second_brain || { enabled: false, path: '' };
    } catch {
      return { enabled: false, path: '' };
    }
  }

  return { enabled: false, path: '' };
}

async function vaultStatus(vaultPath) {
  const claudeMd = path.join(vaultPath, 'CLAUDE.md');
  const memoryFile = path.join(vaultPath, '_memory', 'current-state.md');
  const decisionsDir = path.join(vaultPath, '_decisions');
  const learningsDir = path.join(vaultPath, '_learnings');

  const claudeOk = await fs.pathExists(claudeMd);
  const memoryOk = await fs.pathExists(memoryFile);

  let decisionsCount = 0;
  let learningsCount = 0;

  if (await fs.pathExists(decisionsDir)) {
    const entries = await fs.readdir(decisionsDir, { withFileTypes: true });
    decisionsCount = entries.filter((e) => e.isFile() && e.name.endsWith('.md')).length;
    // Count subdirs (like hseos/)
    for (const entry of entries.filter((e) => e.isDirectory())) {
      const sub = await fs.readdir(path.join(decisionsDir, entry.name));
      decisionsCount += sub.filter((f) => f.endsWith('.md')).length;
    }
  }

  if (await fs.pathExists(learningsDir)) {
    const entries = await fs.readdir(learningsDir);
    learningsCount = entries.filter((f) => f.endsWith('.md')).length;
  }

  return { claudeOk, memoryOk, decisionsCount, learningsCount };
}

async function syncEpicToVault(directory, vaultPath) {
  const outputDir = path.join(directory, '.hseos-output');
  if (!(await fs.pathExists(outputDir))) {
    await prompts.log.warn('No .hseos-output directory found. Run an epic first.');
    return;
  }

  const yaml = require('js-yaml');
  const hseosDirInVault = path.join(vaultPath, '_decisions', 'hseos');
  await fs.ensureDir(hseosDirInVault);

  const epicDirs = (await fs.readdir(outputDir, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  if (epicDirs.length === 0) {
    await prompts.log.warn('No epic directories found in .hseos-output/');
    return;
  }

  let synced = 0;

  for (const epicId of epicDirs) {
    const epicPath = path.join(outputDir, epicId);

    // Sync decisions
    const decisionPatterns = ['decisions', 'adrs', 'decision'];
    for (const pattern of decisionPatterns) {
      const decDir = path.join(epicPath, pattern);
      if (await fs.pathExists(decDir)) {
        const files = (await fs.readdir(decDir)).filter((f) => f.endsWith('.md'));
        for (const file of files) {
          const target = path.join(hseosDirInVault, file);
          if (!(await fs.pathExists(target))) {
            await fs.copy(path.join(decDir, file), target);
            synced++;
          }
        }
      }
    }

    // Sync learnings
    const learningPatterns = ['learnings', 'learning', 'insights'];
    for (const pattern of learningPatterns) {
      const learnDir = path.join(epicPath, pattern);
      if (await fs.pathExists(learnDir)) {
        const files = (await fs.readdir(learnDir)).filter((f) => f.endsWith('.md'));
        for (const file of files) {
          const prefix = file.startsWith('hseos-') ? '' : 'hseos-';
          const target = path.join(vaultPath, '_learnings', `${prefix}${file}`);
          if (!(await fs.pathExists(target))) {
            await fs.copy(path.join(learnDir, file), target);
            synced++;
          }
        }
      }
    }

    // Append epic summary to current-state.md
    const statePath = path.join(vaultPath, '_memory', 'current-state.md');
    if (await fs.pathExists(statePath)) {
      const stateContent = await fs.readFile(statePath, 'utf8');
      const today = new Date().toISOString().split('T')[0];
      const marker = `## HSEOS — ${epicId}`;

      if (!stateContent.includes(marker)) {
        const block = `\n---\n\n${marker} (${today})\n\n**Épico sincronizado via** \`hseos brain sync\`\n**Artefatos:** ${synced} arquivo(s) copiado(s) para o vault\n`;
        await fs.appendFile(statePath, block, 'utf8');
        await prompts.log.success(`Appended HSEOS block to _memory/current-state.md`);
      }
    }
  }

  await prompts.log.success(`Sync complete: ${synced} artifact(s) copied to vault`);
  await prompts.log.message('Tip: run /end-session in your second-brain to capture full conversation context.');
}

module.exports = {
  command: 'brain <action>',
  description: 'Manage second-brain vault integration (status, sync)',
  options: [['--directory <path>', 'Project directory (default: current directory)']],
  action: async (action, options) => {
    const directory = path.resolve(options.directory || process.cwd());
    const config = await loadConfig(directory);

    switch (action) {
      case 'status': {
        if (!config.enabled || !config.path) {
          await prompts.log.message(
            'Second-brain: disabled\n' +
              '  To enable: run `hseos install` and configure your vault path,\n' +
              '  or manually set second_brain.enabled = true + second_brain.path in .hseos/config/hseos.config.yaml'
          );
          break;
        }

        const vaultExists = await fs.pathExists(config.path);
        if (!vaultExists) {
          await prompts.log.warn(`Vault path not found: ${config.path}`);
          break;
        }

        const stats = await vaultStatus(config.path);
        await prompts.log.message(
          `Second-brain: enabled\n` +
            `  path:          ${config.path}\n` +
            `  CLAUDE.md:     ${stats.claudeOk ? 'OK' : 'MISSING'}\n` +
            `  current-state: ${stats.memoryOk ? 'OK' : 'MISSING'}\n` +
            `  _decisions:    ${stats.decisionsCount} file(s)\n` +
            `  _learnings:    ${stats.learningsCount} file(s)`
        );
        break;
      }

      case 'sync': {
        if (!config.enabled || !config.path) {
          await prompts.log.warn('Second-brain is not configured. Run `hseos brain status` for setup instructions.');
          process.exit(1);
        }

        if (!(await fs.pathExists(config.path))) {
          await prompts.log.error(`Vault path not found: ${config.path}`);
          process.exit(1);
        }

        await prompts.log.info(`Syncing epic artifacts to vault at ${config.path}...`);
        await syncEpicToVault(directory, config.path);
        break;
      }

      default: {
        await prompts.log.error(`Unknown action: ${action}. Use status or sync.`);
        process.exit(1);
      }
    }
  },
};
