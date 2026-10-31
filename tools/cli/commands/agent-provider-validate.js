'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { validateProviderEnvironment } = require('../../lib/agent-provider-binding');
const { findProjectRoot } = require('../lib/project-root');

const ADR_IDENTIFIER = /^ADR-\d{4}$/;
const ACTIVATION_PATH_FLAGS = [
  ['activationDb', '--activation-db'],
  ['activationReceipt', '--activation-receipt'],
  ['activationWindow', '--activation-window'],
];

/** Resolves the optional activation evidence flags; a path that is not a regular file or a malformed ADR is refused up front. */
function resolveActivation(options) {
  const [database, receipt, window] = ACTIVATION_PATH_FLAGS.map(([key, flag]) => {
    const value = options[key];
    if (value === undefined) return null;
    const resolved = path.resolve(String(value));
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile())
      throw new TypeError(`${flag} ${path.basename(resolved)} does not exist as a file`);
    return resolved;
  });
  if (!database && (receipt || window)) throw new TypeError('--activation-receipt and --activation-window require --activation-db');
  if (options.activationAdr !== undefined && !ADR_IDENTIFIER.test(String(options.activationAdr))) {
    throw new TypeError('--activation-adr must match ADR-NNNN');
  }
  const adr = options.activationAdr === undefined ? undefined : String(options.activationAdr);
  const activation = {
    databasePath: database || undefined,
    receiptPath: receipt || undefined,
    windowPath: window || undefined,
    ...(adr ? { adr } : {}),
  };
  const name = (file) => (file ? path.basename(file) : null);
  return { activation, inputs: { database: name(database), receipt: name(receipt), window: name(window), adr: adr || 'ADR-0048' } };
}

function render(report) {
  const { configuration, provider_probe: probe, sandbox } = report.evidence;
  return [
    `Agent provider environment: ${report.status}`,
    '  operational activation: no',
    `  binding: ${configuration.binding_id} (${configuration.binding_sha256})`,
    `  provider/model: ${configuration.provider_id} / ${configuration.model}`,
    `  secret values loaded during validation: ${configuration.secret_values_loaded ? 'yes' : 'no'}`,
    `  required sandbox: ${sandbox.ready ? 'ready' : 'blocked'}`,
    `  provider probe: ${probe.status}`,
    `  remaining gates: ${report.remaining_gates.join(', ')}`,
  ].join('\n');
}

module.exports = {
  command: 'agent-provider-validate',
  description: 'Validate an immutable model-provider binding and optionally probe it after required sandbox checks pass.',
  options: [
    ['--binding <path>', 'Provider binding YAML (required)'],
    ['--directory <path>', 'Project used for environment checks (default: current directory)'],
    ['--repository <path>', 'HSEOS repository root (default: auto-detected)'],
    ['--probe', 'Resolve the declared secret and contact the provider after required sandbox checks pass'],
    ['--activation-db <path>', 'Activated project database to check against the ADR activation criterion (read-only)'],
    ['--activation-receipt <path>', 'Activation receipt written beside the backup by the apply command'],
    ['--activation-window <path>', 'Supervised-window record (operator, stopped consumers, database digest)'],
    ['--activation-adr <id>', 'ADR that defines the activation criterion, format ADR-NNNN (default: ADR-0048)'],
    ['--json', 'Output machine-readable JSON'],
    ['--require-ready', 'Exit non-zero unless the sandbox and requested provider probe pass'],
  ],
  async action(options) {
    if (!options.binding) throw new TypeError('--binding is required');
    const repositoryRoot = path.resolve(options.repository || findProjectRoot(__dirname));
    const projectDirectory = path.resolve(options.directory || process.cwd());
    const { activation, inputs } = resolveActivation(options);
    const validation = await validateProviderEnvironment({
      bindingPath: path.resolve(options.binding),
      repositoryRoot,
      projectDirectory,
      probe: options.probe === true,
      activation,
    });
    const report = { ...validation, evidence: { ...validation.evidence, activation_inputs: inputs } };
    console.log(options.json ? JSON.stringify(report, null, 2) : render(report));
    if (options.requireReady && !report.ready_for_g9_gate) process.exitCode = 2;
    return report;
  },
  render,
};
