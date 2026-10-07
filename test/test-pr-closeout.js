'use strict';

const assert = require('node:assert');
const {
  assertCanMerge,
  assertChecksPassing,
  assertEngineeringLeadershipApproval,
  closeoutPullRequest,
  loadEngineeringLeadershipConfig,
} = require('../tools/cli/lib/pr-closeout');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EL_CONFIG = { logins: ['marciohideaki'], paths: ['.enterprise/.specs/core/'] };
const HEAD = 'b'.repeat(40);
const OLD = 'a'.repeat(40);

function elPr(overrides = {}) {
  return passingPr({
    baseRefName: 'master',
    headRefOid: HEAD,
    files: [{ path: '.enterprise/.specs/core/X.md' }],
    comments: [],
    ...overrides,
  });
}

function approval(sha, login = 'marciohideaki') {
  return { author: { login }, body: `**Engineering Leadership approval - recorded**\nHead: ${sha}` };
}

function closeoutStub({ user, pr, calls, files }) {
  return (command, args) => {
    calls.push([command, ...args].join(' '));
    if (command === 'gh' && args[0] === 'pr' && args[1] === 'view') {
      return JSON.stringify(pr);
    }
    if (command === 'gh' && args[0] === 'api' && args[1] === '--paginate') {
      return files
        ? files.map((f) => JSON.stringify(f)).join('\n')
        : (() => {
            throw new Error('no api');
          })();
    }
    if (command === 'gh' && args[0] === 'api') {
      return JSON.stringify({ login: user });
    }
    return '';
  };
}

function passingPr(overrides = {}) {
  return {
    number: 123,
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    headRefName: 'feature/example',
    statusCheckRollup: [
      { name: 'test (22.x)', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'test (24.x)', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'Standalone clean-env smoke (node:22)', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'compose', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'governance', status: 'COMPLETED', conclusion: 'SUCCESS' },
    ],
    ...overrides,
  };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'pr-closeout-'));
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
            }),
          ),
        /non-passing checks/,
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
  {
    name: 'EL: PR without restricted paths does not require approval',
    fn: () => assert.strictEqual(assertEngineeringLeadershipApproval(elPr({ files: [{ path: 'README.md' }] }), EL_CONFIG).required, false),
  },
  {
    name: 'EL: restricted path without comment is refused',
    fn: () => assert.throws(() => assertEngineeringLeadershipApproval(elPr(), EL_CONFIG), /needs a comment from @marciohideaki/),
  },
  {
    name: 'EL: comment from login outside the list is refused',
    fn: () =>
      assert.throws(
        () => assertEngineeringLeadershipApproval(elPr({ comments: [approval(HEAD, 'someone')] }), EL_CONFIG),
        /needs a comment/,
      ),
  },
  {
    name: 'EL: old SHA with later change on restricted paths is refused',
    fn: () => {
      const run = (cmd, args) => (args.some((a) => a.endsWith(OLD)) ? 'diff-old' : 'diff-new');
      assert.throws(() => assertEngineeringLeadershipApproval(elPr({ comments: [approval(OLD)] }), EL_CONFIG, { run }), /stale head/);
    },
  },
  {
    name: 'EL: old SHA with base-only merge (restricted diff identical) is accepted',
    fn: () => {
      const run = () => 'same-restricted-diff';
      const result = assertEngineeringLeadershipApproval(elPr({ comments: [approval(OLD)] }), EL_CONFIG, { run });
      assert.strictEqual(result.approvedBy, 'marciohideaki');
    },
  },
  {
    name: 'EL: missing config falls back to marciohideaki and default paths',
    fn: () => {
      const config = loadEngineeringLeadershipConfig(tmpDir());
      assert.deepStrictEqual(config.logins, ['marciohideaki']);
      assert.deepStrictEqual(config.paths, ['.enterprise/.specs/constitution/', '.enterprise/.specs/core/']);
    },
  },
  {
    name: 'EL: flag with leader user publishes approval and proceeds',
    fn: () => {
      const calls = [];
      const result = closeoutPullRequest({
        number: 9,
        cwd: tmpDir(),
        approved: true,
        engineeringLeadershipApproval: true,
        run: closeoutStub({ user: 'MarcioHideaki', pr: elPr(), calls }),
      });
      assert.strictEqual(result.action, 'merged');
      assert.ok(calls.some((c) => c.startsWith('gh pr comment 9 --body') && c.includes(HEAD)));
    },
  },
  {
    name: 'EL: flag with non-leader user is refused',
    fn: () => {
      const calls = [];
      assert.throws(
        () =>
          closeoutPullRequest({
            number: 9,
            cwd: tmpDir(),
            approved: true,
            engineeringLeadershipApproval: true,
            run: closeoutStub({ user: 'someone', pr: elPr(), calls }),
          }),
        /not in engineering_leadership/,
      );
      assert.ok(!calls.some((c) => c.startsWith('gh pr comment')));
    },
  },
  {
    name: 'EL: restricted file past the 100-file cap is found via paginated list',
    fn: () => {
      const capped = Array.from({ length: 100 }, (_, i) => ({ path: `src/f${i}.js` }));
      const files = [...capped, { path: '.enterprise/.specs/core/Hidden.md' }];
      assert.throws(
        () =>
          closeoutPullRequest({
            number: 9,
            cwd: tmpDir(),
            approved: true,
            run: closeoutStub({ user: 'x', pr: elPr({ files: capped }), calls: [], files }),
          }),
        /needs a comment/,
      );
    },
  },
  {
    name: 'EL: 100 listed files with no complete list fails closed',
    fn: () => {
      const capped = Array.from({ length: 100 }, (_, i) => ({ path: `src/f${i}.js` }));
      assert.throws(
        () =>
          closeoutPullRequest({
            number: 9,
            cwd: tmpDir(),
            approved: true,
            run: closeoutStub({ user: 'x', pr: elPr({ files: capped }), calls: [] }),
          }),
        /complete file list could not be fetched/,
      );
    },
  },
  {
    name: 'EL: rename out of a restricted path requires approval',
    fn: () => {
      const files = [{ path: '.enterprise/.specs/cross/X.md', previousPath: '.enterprise/.specs/core/X.md' }];
      assert.throws(
        () =>
          closeoutPullRequest({
            number: 9,
            cwd: tmpDir(),
            approved: true,
            run: closeoutStub({ user: 'x', pr: elPr({ files: [] }), calls: [], files }),
          }),
        /needs a comment/,
      );
    },
  },
  {
    name: 'EL: stray hex token without Head label is not an approval',
    fn: () => {
      const comment = { author: { login: 'marciohideaki' }, body: `Engineering Leadership approval? no, see ${HEAD}` };
      assert.throws(() => assertEngineeringLeadershipApproval(elPr({ comments: [comment] }), EL_CONFIG), /stale head/);
    },
  },
  {
    name: 'EL: dry-run does not fetch or comment',
    fn: () => {
      const calls = [];
      const result = closeoutPullRequest({
        number: 9,
        cwd: tmpDir(),
        approved: true,
        dryRun: true,
        run: closeoutStub({ user: 'x', pr: elPr({ comments: [approval(HEAD)] }), calls }),
      });
      assert.strictEqual(result.engineeringLeadership, 'ok');
      assert.ok(!calls.some((c) => c.startsWith('git fetch') || c.startsWith('gh pr comment')));
    },
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
