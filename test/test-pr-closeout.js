'use strict';

const assert = require('node:assert');
const { assertCanMerge, assertChecksPassing } = require('../tools/cli/lib/pr-closeout');

function passingPr(overrides = {}) {
  return {
    number: 123,
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    headRefName: 'feature/example',
    statusCheckRollup: [
      { name: 'test (20.x)', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'test (22.x)', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'Standalone clean-env smoke (node:20)', status: 'COMPLETED', conclusion: 'SUCCESS' },
    ],
    ...overrides,
  };
}

const cases = [
  {
    name: 'accepts approved mergeable PR with passing checks',
    fn: () => assert.doesNotThrow(() => assertCanMerge(passingPr(), true)),
  },
  {
    name: 'requires explicit human approval',
    fn: () => assert.throws(() => assertCanMerge(passingPr(), false), /Explicit human approval/),
  },
  {
    name: 'rejects pending checks',
    fn: () =>
      assert.throws(
        () =>
          assertChecksPassing(
            passingPr({
              statusCheckRollup: [{ name: 'test', status: 'IN_PROGRESS', conclusion: null }],
            })
          ),
        /non-passing checks/
      ),
  },
  {
    name: 'rejects missing checks',
    fn: () => assert.throws(() => assertChecksPassing(passingPr({ statusCheckRollup: [] })), /no status checks/),
  },
  {
    name: 'rejects protected head branch',
    fn: () => assert.throws(() => assertCanMerge(passingPr({ headRefName: 'master' }), true), /protected head/),
  },
  {
    name: 'rejects non-mergeable PR',
    fn: () => assert.throws(() => assertCanMerge(passingPr({ mergeable: 'CONFLICTING' }), true), /not mergeable/),
  },
];

let passed = 0;
let failed = 0;

for (const tc of cases) {
  try {
    tc.fn();
    console.log(`  PASS  ${tc.name}`);
    passed++;
  } catch (error) {
    console.error(`  FAIL  ${tc.name} - ${error.message}`);
    failed++;
  }
}

console.log(`\nPR closeout tests: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
