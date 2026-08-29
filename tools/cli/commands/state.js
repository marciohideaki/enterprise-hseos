const path = require('node:path');
const { spawn } = require('node:child_process');
const fs = require('fs-extra');
const prompts = require('../lib/prompts');
const {
  createInstanceRecord,
  inspectInstance,
  instanceRecordPath,
  parsePort,
  stopInstance,
  writeInstanceRecord,
} = require('../lib/sidecar-lifecycle');

const MCP_SERVER = path.join(__dirname, '..', '..', 'mcp-project-state', 'index.js');
const CLI_SH = path.join(__dirname, '..', '..', 'cli-project-state', 'project-state.sh');
const SERVER_ID = 'hseos-project-state';

async function loadConfig(directory) {
  const yaml = require('js-yaml');
  const configPath = path.join(directory, '.hseos', 'config', 'hseos.config.yaml');
  if (await fs.pathExists(configPath)) {
    try {
      const doc = yaml.load(await fs.readFile(configPath, 'utf8'));
      return doc?.state_management || { mode: 'skill-only', mcp_port: 3100, db_path: '.hseos/state/project.db' };
    } catch {
      return { mode: 'skill-only', mcp_port: 3100, db_path: '.hseos/state/project.db' };
    }
  }
  return { mode: 'skill-only', mcp_port: 3100, db_path: '.hseos/state/project.db' };
}

module.exports = {
  command: 'state <action>',
  description: 'Manage project state (start/stop/status MCP server)',
  options: [
    ['--directory <path>', 'Project directory (default: current directory)'],
    ['--port <port>', 'MCP server port override'],
  ],
  action: async (action, options) => {
    const directory = path.resolve(options.directory || process.cwd());
    const config = await loadConfig(directory);
    const port = parsePort(options.port ?? config.mcp_port ?? 3100);
    const dbPath = path.join(directory, config.db_path || '.hseos/state/project.db');
    const recordPath = instanceRecordPath(directory, 'project-state-mcp');
    const expected = { server: SERVER_ID, entrypoint: MCP_SERVER };

    switch (action) {
      case 'start': {
        if (config.mode === 'skill-only') {
          await prompts.log.warn(
            'State mode is skill-only — MCP server not available. Change mode in hseos.config.yaml to mcp-sqlite or hybrid.',
          );
          process.exit(0);
        }
        const existing = await inspectInstance(recordPath, expected);
        if (existing.state === 'running') {
          await prompts.log.info(`Project-state MCP server already running on port ${existing.record.port}.`);
          break;
        }
        if (existing.state === 'unhealthy') {
          throw new Error(`recorded project-state MCP process ${existing.record.pid} is running but failed its identity health check`);
        }
        await prompts.log.info(`Starting project-state MCP server on port ${port}...`);
        const record = createInstanceRecord({ server: SERVER_ID, entrypoint: MCP_SERVER, port });
        const child = spawn(process.execPath, [MCP_SERVER, `--port=${port}`, `--db=${dbPath}`, `--instance-id=${record.instanceId}`], {
          detached: true,
          stdio: 'ignore',
        });
        writeInstanceRecord(recordPath, { ...record, pid: child.pid });
        child.unref();
        await prompts.log.success(`MCP server started (PID ${child.pid}) — http://127.0.0.1:${port}`);
        break;
      }

      case 'stop': {
        if ((await stopInstance(recordPath, expected)) === 0) {
          await prompts.log.warn('No managed MCP server instance found.');
          break;
        }
        await prompts.log.success('Verified managed MCP server instance stopped (SIGTERM).');
        break;
      }

      case 'status': {
        const instance = await inspectInstance(recordPath, expected);
        const mcpStatus = instance.state === 'running' ? `running on port ${instance.record.port}` : instance.state;

        const dbExists = await fs.pathExists(dbPath);
        const cliExists = await fs.pathExists(CLI_SH);

        await prompts.log.message(
          `State management status:\n` +
            `  mode:       ${config.mode}\n` +
            `  mcp server: ${mcpStatus}\n` +
            `  db path:    ${dbPath} (${dbExists ? 'exists' : 'not created yet'})\n` +
            `  cli script: ${cliExists ? CLI_SH : 'not found'}\n` +
            `  fallback:   ${config.fallback_chain ? config.fallback_chain.join(' → ') : 'none'}`,
        );
        break;
      }

      default: {
        await prompts.log.error(`Unknown action: ${action}. Use start, stop, or status.`);
        process.exit(1);
      }
    }
  },
  _internal: { parsePort },
};
