'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const yaml = require('yaml');

const REPO_ROOT = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

const cases = [
  {
    name: 'worktree-manager validates the task worktree script',
    fn: () => {
      const script = read('scripts/governance/worktree-manager.sh');
      assert.match(script, /bash "\$\{wt_path\}\/scripts\/governance\/quality-gates\.sh"/);
    },
  },
  {
    name: 'worktree-manager generated merge message is conventional',
    fn: () => {
      execFileSync('bash', ['scripts/governance/validate-commit-msg.sh', 'chore(merge): integrate task sample'], {
        cwd: REPO_ROOT,
        stdio: 'pipe',
      });
    },
  },
  {
    name: 'branch protection desired state includes master',
    fn: () => {
      const config = yaml.parse(read('.github/branch-protection.yaml'));
      const master = config.branches.find((branch) => branch.name === 'master');
      assert.ok(master, 'master branch protection entry missing');
      assert.strictEqual(master.protection.allow_force_pushes, false);
      assert.strictEqual(master.protection.allow_deletions, false);
      assert.strictEqual(master.protection.required_pull_request_reviews.required_approving_review_count, 1);
    },
  },
  {
    name: 'branch naming policy is aligned with check-branch guard',
    fn: () => {
      const config = yaml.parse(read('.github/branch-protection.yaml'));
      const script = read('scripts/governance/check-branch.sh');
      for (const pattern of config.branch_naming.allowed_patterns) {
        const prefix = pattern.replace('/*', '/');
        assert.ok(script.includes(prefix), `check-branch.sh missing ${prefix}`);
      }
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

console.log(`\nGovernance script tests: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
