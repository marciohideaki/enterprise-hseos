'use strict';
// Pinned acceptance entrypoint: the runner itself is reached through the read-only pnpm store mount.
process.argv = [process.argv[0], 'mini-test', 'test/sum.test.js'];
require('../node_modules/.pnpm/mini-test@1.0.0/node_modules/mini-test/bin.js');
