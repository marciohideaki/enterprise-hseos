'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const yaml = require('yaml');
const { checkRepoHygiene, trackedFiles } = require('./helpers/repo-hygiene');

const REPO_ROOT = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function hygieneFixture({ files = [], manifests }) {
  const policy = {
    allowedRoots: ['README.md', 'docs/', 'scripts/', '.hseos/'],
    runsRoot: '.hseos/runs',
    docsEvolutionEntries: ['PLAN.md', 'w0/'],
    removalManifests: manifests || ['removed.txt'],
  };
  const base = ['README.md', 'docs/evolution/PLAN.md', 'docs/evolution/w0/a.md', '.hseos/runs/cat/run1/STATUS.md'];
  return {
    files: [...base, ...files],
    policy,
    readFile: (name) => {
      if (name !== 'removed.txt') throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return 'scripts/gone.sh\n\n';
    },
  };
}

const cases = [
  {
    name: 'quality gate selects runtime and schema checks with large staged lists under pipefail',
    fn: () => {
      const script = read('scripts/governance/quality-gates.sh');
      const gate = script.slice(script.indexOf('gate_code()'), script.indexOf('gate_security()'));
      const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'hseos-gate-scope-'));
      try {
        fs.writeFileSync(path.join(directory, 'package.json'), '{}');
        fs.mkdirSync(path.join(directory, 'tools'));
        fs.writeFileSync(path.join(directory, 'tools/validate-agent-schema.js'), '');
        const list = path.join(directory, 'staged.txt');
        const harness = `
set -euo pipefail
info() { :; }
pass() { printf 'PASS %s\\n' "$*"; }
record_fail() { printf 'FAIL %s\\n' "$*"; }
git() { cat "$GATE_LIST"; }
node() { return 0; }
run_node_check() { printf 'CHECK %s\\n' "$*"; }
${gate}
gate_code
`;
        for (const first of ['packages/runtime/index.js', 'src/hsm/agents/example.yaml']) {
          fs.writeFileSync(list, first + '\n' + 'docs/unchanged.md\n'.repeat(20_000));
          const output = execFileSync('bash', ['-c', harness], {
            encoding: 'utf8',
            env: {
              ...process.env,
              GATE_CODE_MODE: 'full',
              REPO_ROOT: directory,
              GATE_LIST: list,
              LOG_FILE: path.join(directory, 'gate.log'),
            },
          });
          assert.match(output, /CHECK npm run lint/);
          assert.match(output, /CHECK npm test/);
          if (first.startsWith('src/')) assert.match(output, /Agent schema validation: passed/);
        }
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
  },
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
        'test (22.x)',
        'test (24.x)',
        'Standalone clean-env smoke (node:22)',
        'compose',
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
          const backendIndex = steps.findIndex((step) => typeof step.run === 'string' && step.run.includes('bubblewrap'));
          const userNamespaceIndex = steps.findIndex(
            (step) => typeof step.run === 'string' && step.run.includes('kernel.apparmor_restrict_unprivileged_userns=0'),
          );
          assert.ok(backendIndex !== -1, `${workflowPath}:${jobName} does not install bubblewrap`);
          assert.ok(backendIndex < testIndex, `${workflowPath}:${jobName} installs bubblewrap after npm test`);
          assert.ok(userNamespaceIndex !== -1, `${workflowPath}:${jobName} does not enable user namespaces`);
          assert.ok(userNamespaceIndex < testIndex, `${workflowPath}:${jobName} enables user namespaces after npm test`);
        }
      }
    },
  },
  {
    name: 'release assets have portable checksums and version-bound notes',
    fn: () => {
      const workflow = yaml.parse(read('.github/workflows/release.yaml'));
      const steps = workflow.jobs.publish.steps;
      const build = steps.find((step) => step.name === 'Build immutable release artifact');
      const publish = steps.find((step) => step.name === 'Create GitHub prerelease');
      assert.ok(build?.run.includes('cd dist'), 'checksum generation does not enter the asset directory');
      assert.match(build.run, /sha256sum[\s\\]+\n\s+"hseos-\$\{release_version\}\.tgz"/);
      assert.doesNotMatch(build.run, /sha256sum[\s\S]*?"dist\/hseos-/);
      assert.ok(build.run.includes('sha256sum -c SHA256SUMS'), 'workflow does not verify its generated checksums');
      assert.ok(publish?.run.includes('docs/releases/${GITHUB_REF_NAME}.md'), 'release notes are hard-coded');
    },
  },
  {
    name: 'repository hygiene: the real repository has no violations',
    fn: () => {
      const policy = JSON.parse(read('docs/hygiene/repo-hygiene-policy.json'));
      const violations = checkRepoHygiene({ files: trackedFiles(REPO_ROOT), policy, readFile: read });
      assert.deepStrictEqual(violations, []);
    },
  },
  {
    name: 'repository hygiene: synthetic clean listing has no violations',
    fn: () => {
      assert.deepStrictEqual(checkRepoHygiene(hygieneFixture({})), []);
    },
  },
  ...[
    ['R1', 'root-not-allowed', { files: ['zz-tmp/x.txt'] }],
    ['R2', 'run-without-status', { files: ['.hseos/runs/cat/run2/PLAN.md'] }],
    ['R3 (runs root)', 'loose-run-file', { files: ['.hseos/runs/loose.md'] }],
    ['R3 (category)', 'loose-run-file', { files: ['.hseos/runs/cat/loose.md'] }],
    ['R4', 'docs-evolution-entry', { files: ['docs/evolution/new-report.md'] }],
    ['R5', 'removed-path-returned', { files: ['scripts/gone.sh'] }],
    ['R5 missing manifest', 'removed-path-returned', { manifests: ['MISSING.txt'] }],
  ].map(([label, rule, change]) => ({
    name: `repository hygiene: ${label} violation is reported as ${rule}`,
    fn: () => {
      const violations = checkRepoHygiene(hygieneFixture(change));
      assert.ok(
        violations.some((violation) => violation.rule === rule),
        `expected ${rule}, got ${JSON.stringify(violations)}`,
      );
    },
  })),
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
