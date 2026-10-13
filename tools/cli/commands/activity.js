/**
 * `hseos activity <action>` — cross-tool activity coordination (W5-CO1).
 * No effect (exit 0, nothing written) unless .hseos/config/activity-coordination.yaml exists with `enabled: true`.
 */
const fs = require('node:fs');
const path = require('node:path');

const ACTIONS = ['register', 'declare', 'heartbeat', 'end', 'reserve', 'release', 'check', 'overlaps', 'list'];
const GUARD_MODULE = '../lib/activity-adapters/guard-publish-command.js';

/**
 * `guard-publish` belongs to the adapters track (W5-CO2): the command is only dispatched here. Until that module is
 * integrated the dispatch fails with an explicit message instead of pretending the guard ran.
 */
const ADAPTER_NAME = /^[a-z][\d_a-z-]{0,31}$/;
const pascal = (name) => name.replaceAll(/(?:^|[_-])([\da-z])/g, (_, letter) => letter.toUpperCase());
const loaders = {
  adapterDir: path.join(__dirname, '..', 'lib', 'activity-adapters'),
  /**
   * Optional mirror adapter `<name>`: `<adapterDir>/<name>-adapter.js`, then `<name>.js`, contained in the adapter
   * directory. The module exports `createAdapter` or `create<Name>Adapter` (e.g. `createAxonAdapter`), or is the adapter
   * itself ({mirror(event)}). Returns null when absent or unusable.
   */
  adapter: (name) => {
    if (!ADAPTER_NAME.test(name)) return null;
    const root = path.resolve(loaders.adapterDir);
    try {
      for (const file of [`${name}-adapter.js`, `${name}.js`]) {
        const candidate = path.resolve(root, file);
        if (!candidate.startsWith(root + path.sep) || !fs.existsSync(candidate)) continue;
        const loaded = require(candidate);
        const factory = [loaded.createAdapter, loaded[`create${pascal(name)}Adapter`]].find((item) => typeof item === 'function');
        const adapter = factory ? factory() : loaded;
        return adapter && typeof adapter.mirror === 'function' ? { name, mirror: (event) => adapter.mirror(event) } : null;
      }
    } catch {
      return null;
    }
    return null;
  },
  guardPublish: () => {
    try {
      return require(GUARD_MODULE).runGuardPublish;
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('guard-publish-command')) return null;
      throw error;
    }
  },
};

function run(action, options, target) {
  const { createCoordination } = require('../../lib/activity-coordination/service');
  const directory = path.resolve(options.directory || process.cwd());
  const { loadConfig } = require('../../lib/activity-coordination/config');
  const configured = loadConfig(directory);
  const adapters = (configured.enabled ? configured.config.store.adapters : []).map((name) => loaders.adapter(name)).filter(Boolean);
  const { coordination, loaded } = createCoordination(directory, { adapters });
  if (!coordination) return { enabled: false, source: loaded.source, warnings: loaded.warnings, exitCode: 0 };
  try {
    const needSession = () => {
      if (!options.session) throw new Error(`--session is required for ${action}`);
      return options.session;
    };
    let result;
    switch (action) {
      case 'register': {
        if (!options.tool) throw new Error('--tool is required for register');
        result = coordination.register({
          session: needSession(),
          tool: options.tool,
          repo: options.repo,
          worktree: options.worktree,
          branch: options.branch,
          base: options.base,
          intent: options.intent,
          paths: options.path,
          identifiers: options.identifier,
        });
        break;
      }
      case 'declare': {
        result = coordination.declare(needSession(), {
          paths: options.path || [],
          identifiers: options.identifier || [],
          intent: options.intent,
        });
        break;
      }
      case 'heartbeat': {
        result = coordination.heartbeat(needSession());
        break;
      }
      case 'end': {
        result = coordination.end(needSession());
        break;
      }
      case 'reserve': {
        if (!target) throw new Error('reserve needs a key: path:<repo>:<glob> | version:<pkg>@<semver> | name:<pkg>');
        result = coordination.reserve(needSession(), target);
        break;
      }
      case 'release': {
        if (!target || !/^\d+$/.test(String(options.fence))) throw new Error('release needs <key> and --fence <n> (integer)');
        result = coordination.release(target, Number(options.fence));
        break;
      }
      case 'check': {
        result = coordination.check(needSession(), { consume: options.consume !== false });
        break;
      }
      case 'overlaps': {
        result = coordination.overlaps(needSession());
        break;
      }
      default: {
        result = coordination.list(options.session);
      }
    }
    let exitCode = 0;
    if (action === 'reserve') {
      if (result.ok === false) exitCode = 2;
      else if (result.conflicted) exitCode = 3;
    }
    return { enabled: true, ...result, exitCode };
  } finally {
    coordination.close();
  }
}

module.exports = {
  command: 'activity <action> [target]',
  description: `Coordinate concurrent tool sessions: ${[...ACTIONS, 'guard-publish'].join('|')} (no effect unless activity-coordination.yaml is enabled).`,
  options: [
    ['--directory <path>', 'Project directory holding .hseos/config/activity-coordination.yaml (default: current)'],
    ['--session <id>', 'Session id of the calling tool'],
    ['--tool <name>', 'Calling tool (claude-code, codex, ...)'],
    ['--repo <remote>', 'Repository remote (default: origin of the worktree)'],
    ['--worktree <path>', 'Worktree path (default: directory)'],
    ['--branch <name>', 'Branch (default: current)'],
    ['--base <ref>', 'Base ref for git diff overlap'],
    ['--intent <text>', 'What the session intends to do'],
    ['--path <globs...>', 'Paths or globs declared'],
    ['--identifier <ids...>', 'Identifiers declared (versions, names)'],
    ['--fence <n>', 'Fence granted at reserve time (release)'],
    ['--no-consume', 'check: peek at the inbox without draining it'],
    ['--json', 'Output machine-readable JSON'],
  ],
  loaders,
  action: async (action, target, options) => {
    if (action === 'guard-publish') {
      const runGuardPublish = loaders.guardPublish();
      if (!runGuardPublish) {
        console.error('[activity] guard-publish indisponível nesta instalação');
        process.exitCode = 2;
        return;
      }
      // Contract: {exitCode, decision, reason, ...} (a bare number is accepted too). 0 allow/warn/skip, 1 refuse, 2 invalid.
      const guard = await runGuardPublish(target, options);
      const code = Number.isInteger(guard) ? guard : guard && Number.isInteger(guard.exitCode) ? guard.exitCode : null;
      if (code === null) console.error('[activity] guard-publish returned no exit code; treated as invalid (2)');
      process.exitCode = code === null ? 2 : code;
      return;
    }
    if (!ACTIONS.includes(action)) {
      console.error(`[activity] unknown action "${action}" (expected ${[...ACTIONS, 'guard-publish'].join('|')})`);
      process.exitCode = 1;
      return;
    }
    let outcome;
    try {
      outcome = run(action, options, target);
    } catch (error) {
      console.error(`[activity] ${error.message}`);
      process.exitCode = 1;
      return;
    }
    const { exitCode, ...payload } = outcome;
    if (options.json) console.log(JSON.stringify(payload));
    else if (payload.enabled) {
      console.log(
        `[activity] ${action}: ${payload.ok === false ? `refused (${payload.reason_code})` : payload.conflicted ? 'acquired with conflicts' : 'ok'}`,
      );
      for (const overlap of payload.overlaps || [])
        console.log(`  overlap ${overlap.severity}: ${overlap.file} with ${overlap.tool}:${overlap.with}`);
      for (const conflict of payload.conflicts || []) console.log(`  conflict ${conflict.source}: ${conflict.detail || conflict.held_by}`);
      for (const reservation of payload.foreign_reservations || [])
        console.log(`  reserved by ${reservation.tool}:${reservation.owner}: ${reservation.key}${reservation.overdue ? ' (overdue)' : ''}`);
      for (const entry of payload.inbox || []) console.log(`  inbox: ${entry.reason}`);
    } else {
      console.log('[activity] coordination disabled (no effect)');
    }
    for (const warning of payload.warnings || []) console.error(`[activity] warning: ${warning}`);
    if (exitCode) process.exitCode = exitCode;
  },
};
