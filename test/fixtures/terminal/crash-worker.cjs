'use strict';
const { EngineeringControl } = require('../../../tools/cli/lib/engineering-control');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (config.phase === 'after-intent') require('../../../packages/agent-isolation-attestation/terminal-executor').startIsolatedTerminal = () => process.kill(process.pid, 'SIGKILL');
const control = new EngineeringControl({ state: config.state });
const append = control.terminals.append.bind(control.terminals);
control.terminals.append = (id, value) => {
  if (config.phase === 'before-intent' && value.kind === 'intent') process.kill(process.pid, 'SIGKILL');
  if (config.phase === 'before-receipt' && value.kind === 'receipt') process.kill(process.pid, 'SIGKILL');
  if (config.phase === 'input-receipt' && value.kind === 'receipt' && value.action === 'input') process.kill(process.pid, 'SIGKILL');
  const result = append(id, value);
  if ((config.phase === 'after-prepared' && value.kind === 'prepared') || (config.phase === 'after-receipt' && value.kind === 'receipt')) process.kill(process.pid, 'SIGKILL');
  return result;
};
(async () => {
  await control.terminals.execute(config.command);
  if (config.phase === 'input-receipt') {
    const state = control.terminals.query(config.command.resource_id);
    await control.terminals.execute({ schema_version: 1, command_id: randomUUID(), resource_id: state.resource_id, expected_sequence: state.current_sequence, action: 'input', input: { data: Buffer.from('once\n').toString('base64') } });
  }
})().catch((error) => { process.stderr.write(String(error.stack)); process.exitCode = 1; });
