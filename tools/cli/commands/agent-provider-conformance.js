'use strict';

const path = require('node:path');

const { buildAgentProviderConformance } = require('../../lib/agent-provider-conformance');
const { findProjectRoot } = require('../lib/project-root');

function render(report) {
  const lines = [
    `Agent provider conformance: ${report.status}`,
    `  verified: ${report.conformance_verified ? 'yes' : 'no'}`,
    '  operational activation: no',
  ];
  for (const provider of report.providers) {
    const level = provider.declared_conformance_level || (provider.provider_kind === 'kernel-runtime' ? 'native AgentRuntime' : 'n/a');
    lines.push(`  ${provider.provider_id}: ${provider.status} (${level})`);
  }
  return lines.join('\n');
}

module.exports = {
  command: 'agent-provider-conformance',
  description: 'Generate the provider/profile matrix and optionally execute its hash-bound conformance suites.',
  options: [
    ['--repository <path>', 'HSEOS repository root (default: auto-detected)'],
    ['--verify', 'Execute every provider conformance suite'],
    ['--json', 'Output machine-readable JSON'],
    ['--require-ready', 'Exit non-zero unless every declared provider suite passed'],
  ],
  async action(options) {
    const repositoryRoot = path.resolve(options.repository || findProjectRoot(__dirname));
    const report = buildAgentProviderConformance({ root: repositoryRoot, verify: options.verify === true });
    console.log(options.json ? JSON.stringify(report, null, 2) : render(report));
    if (options.requireReady && !report.conformance_verified) process.exitCode = 2;
    return report;
  },
  render,
};
