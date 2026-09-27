'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

test('optional Antigravity client restricts SDK tools to pinned kernel actions', () => {
  execFileSync('python3', ['-B', path.join(__dirname, 'test_antigravity_client.py')], {
    encoding: 'utf8',
    timeout: 30_000,
    stdio: 'pipe',
  });
});
