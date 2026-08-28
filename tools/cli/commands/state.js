const path = require('node:path');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('fs-extra');
const prompts = require('../lib/prompts');

const MCP_SERVER = path.join(__dirname, '..', '..', 'mcp-project-state', 'index.js');
const CLI_SH = path.join(__dirname, '..', '..', 'cli-project-state', 'project-state.sh');

function parsePort(value) {
  const text = String(value ?? '').trim();
  if (!/^[0-9]+$/.test(text)) throw new TypeError('port must be an integer between 1 and 65535');
  const port = Number(text);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new RangeError('port must be an integer between 1 and 65535');
  }
  return port;
}

function listeningPids(port) {
  try {
    const output = execFileSync('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    });
    return [
      ...new Set(
        output
          .split(/\s+/)
          .filter((value) => /^[1-9][0-9]*$/.test(value))
          .map(Number),
      ),
    ];
  } catch {
    return [];
  }
}

async function healthStatus(port) {
  return new Promise((resolve) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: '/health', timeout: 2000 }, (response) => {
      response.resume();
      resolve(response.statusCode === 200 ? `running on port ${port}` : 'not running');
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve('not running'));
  });
}

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

    switch (action) {
      case 'start': {
        if (config.mode === 'skill-only') {
          await prompts.log.warn(
            'State mode is skill-only — MCP server not available. Change mode in hseos.config.yaml to mcp-sqlite or hybrid.',
          );
          process.exit(0);
        }
        await prompts.log.info(`Starting project-state MCP server on port ${port}...`);
        const child = spawn(process.execPath, [MCP_SERVER, `--port=${port}`, `--db=${dbPath}`], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
        await prompts.log.success(`MCP server started (PID ${child.pid}) — http://127.0.0.1:${port}`);
        break;
      }

      case 'stop': {
        const pids = listeningPids(port);
        if (pids.length === 0) {
          await prompts.log.warn(`No MCP server found on port ${port}.`);
          break;
        }
        for (const pid of pids) process.kill(pid, 'SIGTERM');
        await prompts.log.success(`MCP server on port ${port} stopped (${pids.length} process(es), SIGTERM).`);
        break;
      }

      case 'status': {
        const mcpStatus = await healthStatus(port);

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
  _internal: { parsePort, listeningPids, healthStatus },
};
