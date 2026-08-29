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
    name: 'worktree-manager validates from inside the task worktree',
    fn: () => {
      const script = read('scripts/governance/worktree-manager.sh');
      const validation = script.slice(script.indexOf('cmd_validate()'), script.indexOf('cmd_commit()'));
      assert.match(validation, /cd "\$\{wt_path\}"/);
      assert.match(validation, /env -u REPO_ROOT .*bash "\.\/scripts\/governance\/quality-gates\.sh"/);
      assert.doesNotMatch(validation, /bash "\$\{wt_path\}\/scripts\/governance\/quality-gates\.sh"/);
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
      assert.strictEqual(master.protection.required_pull_request_reviews, null);
    },
  },
  {
    name: 'branch protection apply tool emits GitHub REST payload',
    fn: () => {
      const raw = execFileSync('node', ['scripts/governance/apply-branch-protection.js', '--dry-run', '--branch', 'master'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
      });
      const request = JSON.parse(raw);
      assert.strictEqual(request.method, 'PUT');
      assert.strictEqual(request.endpoint, 'repos/marciohideaki/enterprise-hseos/branches/master/protection');
      assert.deepStrictEqual(request.body.required_status_checks.contexts, [
        'test (20.x)',
        'test (22.x)',
        'Standalone clean-env smoke (node:20)',
        'governance',
      ]);
      assert.strictEqual(request.body.allow_force_pushes, false);
      assert.strictEqual(request.body.allow_deletions, false);
    },
  },
  {
    name: 'branch protection apply tool detects GitHub Actions repository',
    fn: () => {
      const raw = execFileSync('node', ['scripts/governance/apply-branch-protection.js', '--dry-run', '--branch', 'master'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_REPOSITORY: 'example/project' },
        stdio: 'pipe',
      });
      const request = JSON.parse(raw);
      assert.strictEqual(request.endpoint, 'repos/example/project/branches/master/protection');
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
  {
    name: 'every workflow that runs the full suite installs the required isolation backend first',
    fn: () => {
      const workflows = ['.github/workflows/ci.yaml', '.github/workflows/standalone-smoke.yaml', '.github/workflows/release.yaml'];
      for (const workflowPath of workflows) {
        const workflow = yaml.parse(read(workflowPath));
        for (const [jobName, job] of Object.entries(workflow.jobs)) {
          const steps = job.steps ?? [];
          const testIndex = steps.findIndex((step) => typeof step.run === 'string' && step.run.includes('npm test'));
          if (testIndex === -1) continue;
          const backendIndex = steps.findIndex(
            (step) => typeof step.run === 'string' && step.run.includes('bubblewrap'),
          );
          assert.ok(backendIndex !== -1, `${workflowPath}:${jobName} does not install bubblewrap`);
          assert.ok(backendIndex < testIndex, `${workflowPath}:${jobName} installs bubblewrap after npm test`);
        }
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
