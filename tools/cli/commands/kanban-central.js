/**
 * `hseos kanban-central` — manage and run the central multi-project kanban.
 *
 * Lifecycle mirrors `tools/cli/commands/state-ui.js`. Adds register/deregister/list
 * subcommands that mutate an explicit project-scoped registry.
 */

const path = require('node:path');
const { spawn } = require('node:child_process');
const fs = require('fs-extra');
const { healthCheck, parsePort, stopPort } = require('../lib/sidecar-lifecycle');

const SERVER = path.join(__dirname, '..', '..', 'state-ui-server', 'index.js');
const { loadRegistry, saveRegistry, addProject, removeProject, validate, registryPath } = require('../../state-ui-server/lib/registry');

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

function cmdRegister(options, target) {
  const reg = loadRegistry(options.registry);
  const entry = addProject(reg, {
    id: options.id,
    path: target,
    label: options.label,
    color: options.color,
  });
  saveRegistry(reg, options.registry);
  console.log(`[kanban-central] registered ${entry.id} → ${entry.path}`);
  console.log(`[kanban-central] registry: ${reg._path || registryPath(options.registry)}`);
}

function cmdDeregister(options, id) {
  const reg = loadRegistry(options.registry);
  const removed = removeProject(reg, id);
  saveRegistry(reg, options.registry);
  if (removed) console.log(`[kanban-central] deregistered ${id}`);
  else console.log(`[kanban-central] no project with id "${id}"`);
}

function cmdList(options) {
  const reg = loadRegistry(options.registry);
  const status = validate(reg);
  if (status.length === 0) {
    console.log('(no projects registered)');
    console.log(`Registry: ${reg._path}`);
    return;
  }
  const widths = [
    Math.max('id'.length, ...status.map((s) => s.id.length)),
    Math.max('status'.length, ...status.map((s) => s.status.length)),
    Math.max('path'.length, ...status.map((s) => s.path.length)),
  ];
  const fmt = (cols) => cols.map((c, i) => String(c).padEnd(widths[i])).join('  ');
  console.log(fmt(['id', 'status', 'path']));
  console.log(fmt(widths.map((w) => '-'.repeat(w))));
  for (const s of status) console.log(fmt([s.id, s.status, s.path]));
  console.log(`\nRegistry: ${reg._path}`);
}

async function cmdStart(options) {
  const directory = path.resolve(options.directory || process.cwd());
  const config = await loadConfig(directory);
  const port = parsePort(options.port, config.central_port || 3210);
  const host = options.host || config.central_host || '127.0.0.1';
  const authTokenEnv = options.authTokenEnv || config.central_auth_token_env || null;
  const authToken = authTokenEnv ? process.env[authTokenEnv] : null;
  const pollMs = options.pollMs || config.web_poll_ms || 1000;
  const staleMinutes = options.staleMinutes || config.stale_minutes || 10;
  const reg = registryPath(options.registry);

  if (await healthCheck({ port, token: authToken })) {
    console.log(`[kanban-central] already running on http://${host}:${port}`);
    return;
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && (!authTokenEnv || !authToken)) {
    throw new Error('non-loopback binding requires --auth-token-env naming a populated environment variable');
  }
  const serverArgs = [
    SERVER,
    `--port=${port}`,
    `--host=${host}`,
    `--registry=${reg}`,
    `--poll-ms=${pollMs}`,
    `--stale-minutes=${staleMinutes}`,
  ];
  if (authTokenEnv) serverArgs.push(`--auth-token-env=${authTokenEnv}`);
  const child = spawn(process.execPath, serverArgs, { detached: true, stdio: 'ignore' });
  child.unref();
  await new Promise((r) => setTimeout(r, 400));
  if (await healthCheck({ port, token: authToken })) console.log(`[kanban-central] started on http://${host}:${port} (PID ${child.pid})`);
  else console.log(`[kanban-central] started in background (PID ${child.pid}); not yet responding on ${port}`);
}

async function cmdStop(options) {
  const config = await loadConfig(path.resolve(options.directory || process.cwd()));
  const port = parsePort(options.port, config.central_port || 3210);
  if (stopPort(port) > 0) {
    console.log(`[kanban-central] sent SIGTERM to processes on port ${port}`);
  } else {
    console.log('[kanban-central] no process found to stop');
  }
}

async function cmdStatus(options) {
  const config = await loadConfig(path.resolve(options.directory || process.cwd()));
  const port = parsePort(options.port, config.central_port || 3210);
  const authTokenEnv = options.authTokenEnv || config.central_auth_token_env || null;
  const authToken = authTokenEnv ? process.env[authTokenEnv] : null;
  if (await healthCheck({ port, token: authToken })) console.log(`[kanban-central] running on http://127.0.0.1:${port}`);
  else {
    console.log('[kanban-central] not running');
    process.exit(1);
  }
}

module.exports = {
  command: 'kanban-central <action> [target]',
  description: 'Manage the central multi-project kanban (register/deregister/list/start/stop/status).',
  options: [
    ['--directory <path>', 'Project directory for config lookup (default: cwd)'],
    ['--registry <path>', 'Registry JSON path (default: .hseos/config/projects.json)'],
    ['--id <id>', 'Project id (register only)'],
    ['--label <label>', 'Project display label (register only)'],
    ['--color <hex>', 'Project color hex (register only)'],
    ['--port <port>', 'Central server port'],
    ['--host <host>', 'Bind interface'],
    ['--auth-token-env <name>', 'Environment variable containing the bearer token'],
    ['--poll-ms <ms>', 'Snapshot poll interval'],
    ['--stale-minutes <n>', 'Orphan threshold'],
  ],
  action: async (action, target, options) => {
    const directory = path.resolve(options.directory || process.cwd());
    const config = await loadConfig(directory);
    const effectiveOptions = {
      ...options,
      directory,
      registry: options.registry || config.central_registry || path.join(directory, '.hseos', 'config', 'projects.json'),
    };
    switch (action) {
      case 'register': {
        if (!target) {
          console.error('register requires <path>');
          process.exit(1);
        }
        cmdRegister(effectiveOptions, target);
        break;
      }
      case 'deregister': {
        if (!target) {
          console.error('deregister requires <id>');
          process.exit(1);
        }
        cmdDeregister(effectiveOptions, target);
        break;
      }
      case 'list': {
        cmdList(effectiveOptions);
        break;
      }
      case 'start': {
        await cmdStart(effectiveOptions);
        break;
      }
      case 'stop': {
        await cmdStop(effectiveOptions);
        break;
      }
      case 'status': {
        await cmdStatus(effectiveOptions);
        break;
      }
      default: {
        console.error(`Unknown action: ${action}. Expected register|deregister|list|start|stop|status.`);
        process.exit(1);
      }
    }
  },
};
