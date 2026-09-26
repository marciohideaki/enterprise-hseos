'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const mutations = {
  authority: ['packages/agent-policy-lattice/index.js', 'if (widened.length > 0)', 'if (false)'],
  budget: ['packages/agent-policy-lattice/index.js', 'if (requestedLimit > parentLimit)', 'if (false)'],
  recovery: ['packages/agent-session-store/replay.js', "execution.outcome?.status !== 'uncertain'", 'false'],
};
const selected = mutations[process.env.HSEOS_TEST_MUTATION];
if (!selected) throw new Error('Unknown test mutation');
const [relative, before, after] = selected;
const target = path.resolve(__dirname, '../..', relative);
const original = Module._extensions['.js'];
Module._extensions['.js'] = function (module, filename) {
  if (filename !== target) return original(module, filename);
  const source = fs.readFileSync(filename, 'utf8');
  if (source.split(before).length !== 2) throw new Error('Mutation anchor must occur exactly once');
  process.stderr.write(`HSEOS_TEST_MUTATION_APPLIED:${process.env.HSEOS_TEST_MUTATION}\n`);
  module._compile(source.replace(before, after), filename);
};
