const path = require('node:path');
const { AgentCoreCompiler } = require('../installers/lib/core/agent-core-compiler');
const prompts = require('../lib/prompts');

module.exports = {
  command: 'agent-core <action>',
  description: 'Manage the vendor-neutral .agents core',
  options: [['--directory <path>', 'Project directory (default: current directory)']],
  action: async (action, options = {}) => {
    if (action !== 'compile') {
      throw new Error(`Unsupported agent-core action: ${action}`);
    }

    const projectDir = path.resolve(options.directory || process.cwd());
    const hseosDir = path.join(projectDir, '.hseos');
    const compiler = new AgentCoreCompiler();
    const result = await compiler.compile(projectDir, hseosDir);

    await prompts.log.success(
      `Agent core compiled: ${result.skills} skills, ${result.hooks} hooks, ${result.commands} commands -> ${result.manifest}`,
    );
  },
};
