'use strict';
// Minimal native test runner laid out like a pnpm package: its dependencies are reached through symlinks.
const path = require('node:path');
const assert = require('mini-assert');
const kit = require('@scope/kit');

let failed = 0;
for (const file of process.argv.slice(2)) {
  const suite = require(path.resolve(file));
  for (const [name, run] of Object.entries(suite)) {
    try {
      run(assert);
      console.log(kit.pass(name));
    } catch {
      failed += 1;
      console.log(kit.fail(name));
    }
  }
}
process.exitCode = failed === 0 ? 0 : 1;
