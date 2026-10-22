'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { GOVERNED_CLI_COMMANDS } = require('../tools/cli/lib/governed-action');
const root = path.join(__dirname, '..');
const directory = path.join(root, 'tools/cli/commands');
const target = path.join(root, 'tools/cli/command-manifest.json');
const entries = fs
  .readdirSync(directory)
  .filter((name) => name.endsWith('.js'))
  .sort()
  .flatMap((filename) => {
    const module_ = require(path.join(directory, filename));
    const sha = createHash('sha256')
      .update(fs.readFileSync(path.join(directory, filename)))
      .digest('hex');
    // A module may register extra commands (companions) so thematically related commands need no extra file.
    return [module_, ...(module_.companions || []).map((companion) => ({ ...companion, companionOf: module_ }))].map((command) =>
      entryFor(filename, command, sha),
    );
  });
function entryFor(filename, command, sha) {
  const options = command.options || [];
  const serialized = JSON.stringify(options, (_key, value) => {
    if (typeof value === 'function' || value === undefined) throw new Error(`Command metadata is not JSON: ${filename}`);
    return value;
  });
  const entry = {
    filename,
    command: command.command,
    description: command.description,
    options: JSON.parse(serialized),
    governed: Boolean(GOVERNED_CLI_COMMANDS[command.command.split(/\s+/, 1)[0]]),
    source_sha256: sha,
  };
  if (command.companionOf) entry.companion = command.command.split(/\s+/, 1)[0];
  return entry;
}
const output = `${JSON.stringify({ schema_version: 1, entries }, null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8') !== output) throw new Error('CLI command manifest is stale; run npm run compile:cli');
} else fs.writeFileSync(target, output);
