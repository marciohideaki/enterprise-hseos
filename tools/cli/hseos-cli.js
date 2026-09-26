'use strict';
const { program } = require('commander');
const path = require('node:path');
const packageJson = require('../../package.json');
const manifest = require('./command-manifest.json');

if (process.stdin?.setMaxListeners) process.stdin.setMaxListeners(Math.max(process.stdin.getMaxListeners(), 50));

program.version(packageJson.version).description('HSEOS CLI - Hideaki Software Engineering Operating System');
for (const entry of manifest.entries) {
  const command = program.command(entry.command).description(entry.description);
  for (const option of entry.options) command.option(...option);
  command.action((...args) => {
    const implementation = require(path.join(__dirname, 'commands', entry.filename));
    if (entry.governed) {
      const { runGovernedCliAction } = require('./lib/governed-action');
      return runGovernedCliAction(entry.command.split(/\s+/, 1)[0], implementation.action, args);
    }
    return implementation.action(...args);
  });
}

void program.parseAsync(process.argv).catch((error) => {
  console.error(`[hseos] ${error.code ? `${error.code}: ` : ''}${error.message}`);
  process.exitCode = 1;
});
if (process.argv.length === 2) program.outputHelp();
