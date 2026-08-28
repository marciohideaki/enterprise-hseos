/**
 * `hseos state-ui` — start/stop/status the kanban web side-car.
 *
 * Mirrors the lifecycle pattern of `tools/cli/commands/state.js` (MCP server).
 */

const path = require('node:path');
const { spawn } = require('node:child_process');
const fs = require('fs-extra');
const { healthCheck, parsePort, stopPort } = require('../lib/sidecar-lifecycle');

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

module.exports = {
  command: 'state-ui <action>',
  description: 'Manage the kanban web side-car (start/stop/status).',
  options: [
    ['--directory <path>', 'Project directory (default: current)'],
    ['--port <port>', 'Web UI port override'],
    ['--host <host>', 'Bind interface (non-loopback requires --auth-token-env)'],
    ['--auth-token-env <name>', 'Environment variable containing the bearer token'],
    ['--poll-ms <ms>', 'Snapshot poll interval in ms'],
    ['--stale-minutes <n>', 'Orphan threshold in minutes'],
  ],
  action: async (action, options) => {
    const directory = path.resolve(options.directory || process.cwd());
    const config = await loadConfig(directory);
    const port = parsePort(options.port, config.web_port || 3200);
    const host = options.host || config.web_host || '127.0.0.1';
    const authTokenEnv = options.authTokenEnv || config.web_auth_token_env || null;
    const authToken = authTokenEnv ? process.env[authTokenEnv] : null;
    const dbPath = path.join(directory, config.db_path || '.hseos/state/project.db');
    const pollMs = options.pollMs || config.web_poll_ms || 1000;
    const staleMinutes = options.staleMinutes || config.stale_minutes || 10;

    switch (action) {
      case 'start': {
        if (await healthCheck({ port, token: authToken })) {
          console.log(`[state-ui] already running on http://${host}:${port}`);
          return;
        }
        if (!['127.0.0.1', 'localhost', '::1'].includes(host) && (!authTokenEnv || !authToken)) {
          throw new Error('non-loopback binding requires --auth-token-env naming a populated environment variable');
        }
        const serverArgs = [
          SERVER,
          `--port=${port}`,
          `--host=${host}`,
          `--db=${dbPath}`,
          `--poll-ms=${pollMs}`,
          `--stale-minutes=${staleMinutes}`,
        ];
        if (authTokenEnv) serverArgs.push(`--auth-token-env=${authTokenEnv}`);
        const child = spawn(process.execPath, serverArgs, { detached: true, stdio: 'ignore' });
        child.unref();
        await new Promise((r) => setTimeout(r, 400));
        if (await healthCheck({ port, token: authToken })) {
          console.log(`[state-ui] started on http://${host}:${port}  (PID ${child.pid})`);
        } else {
          console.log(`[state-ui] started in background (PID ${child.pid}); not yet responding on ${port}`);
        }
        break;
      }
      case 'stop': {
        if (stopPort(port) > 0) {
          console.log(`[state-ui] sent SIGTERM to processes on port ${port}`);
        } else {
          console.log('[state-ui] no process found to stop');
        }
        break;
      }
      case 'status': {
        if (await healthCheck({ port, token: authToken })) {
          console.log(`[state-ui] running on http://${host}:${port}`);
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
