'use strict';

const path = require('node:path');

const { validateProviderEnvironment } = require('../../lib/agent-provider-binding');
const { findProjectRoot } = require('../lib/project-root');

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
    ['--json', 'Output machine-readable JSON'],
    ['--require-ready', 'Exit non-zero unless the sandbox and requested provider probe pass'],
  ],
  async action(options) {
    if (!options.binding) throw new TypeError('--binding is required');
    const repositoryRoot = path.resolve(options.repository || findProjectRoot(__dirname));
    const projectDirectory = path.resolve(options.directory || process.cwd());
    const report = await validateProviderEnvironment({
      bindingPath: path.resolve(options.binding),
      repositoryRoot,
      projectDirectory,
      probe: options.probe === true,
    });
    console.log(options.json ? JSON.stringify(report, null, 2) : render(report));
    if (options.requireReady && !report.ready_for_g9_gate) process.exitCode = 2;
    return report;
  },
  render,
};
