'use strict';

const { createManagedGovernanceAction } = require('../lib/managed-governance/commands');

const execute = createManagedGovernanceAction();

module.exports = {
  command: 'governance <area> <action>',
  description: 'Query and operate the optional managed governance control plane',
  options: [
    ['--plan', 'Build a deterministic import plan without writes'],
    ['--apply', 'Apply an import through the configured control plane'],
    ['--source <path>', 'Governance source directory (default: .enterprise)'],
    ['--endpoint <url>', 'Loopback control-plane endpoint'],
    ['--database-config <path>', 'Explicit sidecar database configuration reference'],
    ['--canonical-remote <reference>', 'Stable canonical source reference recorded with an import'],
    ['--actor <id>', 'Authenticated actor identity for mutations'],
    ['--token-env <name>', 'Environment variable containing the authentication token'],
    ['--type <type>', 'Artifact type filter'],
    ['--context <path>', 'Policy evaluation context JSON file'],
    ['--bind <address>', 'Shell-only server loopback bind address'],
    ['--port <port>', 'Shell-only server port (default: 4319)'],
    ['--json', 'Emit the canonical machine-readable envelope'],
  ],
  action: async (area, action, options) => {
    const result = await execute(area, action, options);
    console.log(result.output);
    if (result.exitCode) process.exitCode = result.exitCode;
  },
};
