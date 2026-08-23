'use strict';

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const { GovernedEntrypointAdapter } = require('../../lib/governed-execution/entrypoint-adapters');
const { createOperationalExecution } = require('../../lib/governed-execution/operational-runtime');
const { openOperationalStateDatabase } = require('../../mcp-project-state/lib/operational-state-db');
const { McpLegacyUsageStore } = require('../../mcp-project-state/lib/mcp-legacy-usage-store');
const { LEGACY_SUNSET } = require('../../lib/legacy-mcp-server');

const GOVERNED_CLI_COMMANDS = Object.freeze({
  'state-describe': Object.freeze({ reversibility: 'read_only' }),
  'state-emit': Object.freeze({ reversibility: 'idempotent_mutation', provider_accepts_idempotency: true }),
  'state-list': Object.freeze({ reversibility: 'read_only' }),
  'state-purge': Object.freeze({ reversibility: 'irreversible_mutation', requires_approval: true, exclusive: true }),
  'state-render': Object.freeze({ reversibility: 'idempotent_mutation', exclusive: true, provider_accepts_idempotency: true }),
  'state-session': Object.freeze({ reversibility: 'idempotent_mutation', provider_accepts_idempotency: true }),
  'state-snapshot': Object.freeze({ reversibility: 'idempotent_mutation', exclusive: true, provider_accepts_idempotency: true }),
  'state-stale-sweep': Object.freeze({ reversibility: 'idempotent_mutation', provider_accepts_idempotency: true }),
});

function strictJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(strictJson);
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, strictJson(child)]));
  }
  throw new TypeError('CLI execution arguments must be strict JSON');
}

function actionDirectory(commandName, options) {
  if (commandName === 'state-session') return path.resolve(options.directory || os.homedir());
  return path.resolve(options.directory || process.cwd());
}

async function runGovernedCliAction(commandName, originalAction, originalArguments) {
  const configuredGovernance = GOVERNED_CLI_COMMANDS[commandName];
  if (!configuredGovernance) return originalAction(...originalArguments);
  const optionsIndex = originalArguments.findLastIndex(
    (value) => value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype,
  );
  const options = optionsIndex === -1 ? {} : originalArguments[optionsIndex];
  const governance =
    commandName === 'state-purge' && options.force !== true
      ? options.archive === true
        ? { reversibility: 'compensatable_mutation', exclusive: true }
        : { reversibility: 'read_only' }
      : configuredGovernance;
  const directory = actionDirectory(commandName, options);
  const dbPath = path.join(directory, '.hseos', 'state', 'project.db');
  const fixtureActivation = process.env.NODE_ENV === 'test' && process.env.HSEOS_GOVERNED_EXECUTION_FIXTURE === '1';
  const temporaryRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
  const parent = path.dirname(dbPath);
  if (!fixtureActivation) {
    if (commandName === 'state-purge' && options.force === true) {
      const error = new Error('Forced purge requires the governed approval boundary, which is pending activation');
      error.code = 'EXECUTION_APPROVAL_REQUIRED';
      throw error;
    }
    fs.mkdirSync(parent, { recursive: true });
    if (fs.existsSync(dbPath)) {
      const operationalDb = openOperationalStateDatabase(dbPath);
      operationalDb.close();
    }
    const usage = new McpLegacyUsageStore(path.join(parent, 'mcp-legacy-usage.db'));
    try {
      usage.record({
        client_identity: `cli:${commandName}`,
        protocol_version: 'legacy-cli-v1',
        server_id: 'cli',
        sunset: LEGACY_SUNSET,
      });
      return await originalAction(...originalArguments);
    } finally {
      usage.close();
    }
  }
  if (!path.resolve(dbPath).startsWith(temporaryRoot)) {
    const error = new Error('Governed CLI fixture activation requires a temporary project');
    error.code = 'EXECUTION_ACTIVATION_PENDING';
    throw error;
  }
  fs.mkdirSync(parent, { recursive: true });
  const fixturePathIsSafe = `${fs.realpathSync(parent)}${path.sep}`.startsWith(temporaryRoot);
  if (fs.existsSync(dbPath) && fs.statSync(dbPath).nlink !== 1) {
    const error = new Error('Governed CLI fixture database must not be hard-linked');
    error.code = 'EXECUTION_ACTIVATION_PENDING';
    throw error;
  }
  if (!fixturePathIsSafe) {
    const error = new Error('Governed CLI activation is pending ADR-0022 compatibility evidence');
    error.code = 'EXECUTION_ACTIVATION_PENDING';
    throw error;
  }
  const db = openOperationalStateDatabase(dbPath, { activatePendingFixture: true });
  const tool = `cli.${commandName}`;
  const input = strictJson({ arguments: optionsIndex === -1 ? originalArguments : originalArguments.slice(0, optionsIndex), options });
  const toolMap = new Map([
    [
      tool,
      {
        name: tool,
        inputSchema: { type: 'object', required: ['arguments', 'options'], properties: { arguments: { type: 'array' }, options: { type: 'object' } } },
      },
    ],
  ]);
  const execution = createOperationalExecution({
    db,
    serverId: 'cli',
    tools: toolMap,
    toolGovernance: { [tool]: governance },
    async invokeTool(_name, _input, context) {
      await originalAction(...originalArguments, context);
      return { completed: true };
    },
  });
  const localUser = os.userInfo();
  const principal = typeof process.getuid === 'function' ? `uid:${process.getuid()}` : `user:${localUser.username}`;
  const actor = { id: `local:${principal}`, type: 'local_process' };
  const resourceScope = {
    project: directory,
    surface: 'cli',
    ...(commandName === 'state-purge'
      ? { target: { kind: 'run', id: String(optionsIndex === -1 ? originalArguments[0] : originalArguments.slice(0, optionsIndex)[0]) } }
      : {}),
  };
  const idempotencyKey = options.idempotencyKey || randomUUID();
  const approvalContext = options.approvalId ? { approval_id: options.approvalId } : null;
  const adapter = new GovernedEntrypointAdapter({
    surface: 'cli',
    scheduler: execution.scheduler,
    resolveActor: async () => actor,
    resolveResourceScope: async () => resourceScope,
  });
  try {
    const outcome = await adapter.invoke({ tool, input, idempotencyKey, approvalContext });
    if (!outcome.ok) throw Object.assign(new Error(outcome.error.message), { code: outcome.error.code });
    return outcome.data.result;
  } finally {
    await execution.scheduler.close({ cancelQueued: true, cancelRunning: true });
    if (db.open) db.close();
  }
}

module.exports = { GOVERNED_CLI_COMMANDS, runGovernedCliAction };
