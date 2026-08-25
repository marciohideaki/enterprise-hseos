'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

test('provider conformance stable-runner fixture fails', () => {
  assert.fail('intentional conformance failure');
});
