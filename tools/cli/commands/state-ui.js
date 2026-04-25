/**
 * `hseos state-ui` — start/stop/status the kanban web side-car.
 *
 * Mirrors the lifecycle pattern of `tools/cli/commands/state.js` (MCP server).
 */

const path = require('node:path');
const { spawn, execSync } = require('node:child_process');
const fs = require('fs-extra');

const SERVER = path.join(__dirname, '..', '..', 'state-ui-server', 'index.js');

async function loadConfig(directory) {
  const yaml = require('js-yaml');
  const configPath = path.join(directory, '.hseos', 'config', 'hseos.config.yaml');
  if (await fs.pathExists(configPath)) {
    try {
      const doc = yaml.load(await fs.readFile(configPath, 'utf8'));
      return doc?.state_management || {};
    } catch {
      return {};
    }
  }
  return {};
}

function isRunning(port) {
  try {
    execSync(`curl -fs http://127.0.0.1:${port}/health`, { stdio: 'ignore', timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  command: 'state-ui <action>',
  description: 'Manage the kanban web side-car (start/stop/status).',
  options: [
    ['--directory <path>', 'Project directory (default: current)'],
    ['--port <port>', 'Web UI port override'],
    ['--poll-ms <ms>', 'Snapshot poll interval in ms'],
    ['--stale-minutes <n>', 'Orphan threshold in minutes'],
  ],
  action: async (action, options) => {
    const directory = path.resolve(options.directory || process.cwd());
    const config = await loadConfig(directory);
    const port = options.port || config.web_port || 3200;
    const dbPath = path.join(directory, config.db_path || '.hseos/state/project.db');
    const pollMs = options.pollMs || config.web_poll_ms || 1000;
    const staleMinutes = options.staleMinutes || config.stale_minutes || 10;

    switch (action) {
      case 'start': {
        if (isRunning(port)) {
          console.log(`[state-ui] already running on http://127.0.0.1:${port}`);
          return;
        }
        const child = spawn(
          process.execPath,
          [SERVER, `--port=${port}`, `--db=${dbPath}`, `--poll-ms=${pollMs}`, `--stale-minutes=${staleMinutes}`],
          { detached: true, stdio: 'ignore' }
        );
        child.unref();
        await new Promise((r) => setTimeout(r, 400));
        if (isRunning(port)) {
          console.log(`[state-ui] started on http://127.0.0.1:${port}  (PID ${child.pid})`);
        } else {
          console.log(`[state-ui] started in background (PID ${child.pid}); not yet responding on ${port}`);
        }
        break;
      }
      case 'stop': {
        try {
          execSync(`lsof -ti tcp:${port} | xargs -r kill -15`, { stdio: 'ignore' });
          console.log(`[state-ui] sent SIGTERM to processes on port ${port}`);
        } catch {
          console.log('[state-ui] no process found to stop');
        }
        break;
      }
      case 'status': {
        if (isRunning(port)) {
          console.log(`[state-ui] running on http://127.0.0.1:${port}`);
        } else {
          console.log('[state-ui] not running');
          process.exit(1);
        }
        break;
      }
      default: {
        console.error(`[state-ui] unknown action: ${action}. Expected start|stop|status.`);
        process.exit(1);
      }
    }
  },
};
