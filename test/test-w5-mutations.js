'use strict';

// W5-11a mutation matrix. Each mutant removes one guard in memory (a loader generated under $TMPDIR and deleted after the
// run, so the working tree is never touched) and the W5 negative matrix must then fail with an assertion. The control run
// without the mutation must pass first, and the mutant must prove it was applied.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { after, test } = require('node:test');

const REPO = path.resolve(__dirname, '..');
const MATRIX = 'test/test-w5-negative-matrix.js';

const IMPORT = '^import: ';
const LSP = '^lsp: ';
const DAP = '^dap: ';
const BROWSER = '^browser: ';
const COMPUTER_NO_APPROVAL = '^computer: an action without an approval';
const COMPUTER_PENDING = '^computer: a requested approval';
const COMPUTER_BINDING = '^computer: an approval is bound';
const COMPUTER_EXPIRY = '^computer: an expired approval';
const COMPUTER_REUSE = '^computer: a single-use approval';
const MEDIA = '^media: bytes changed';
const MEDIA_MAGIC = '^media: a wrong magic';
const MEDIA_SIZE = '^media: a declared size';
const MEMORY = '^memory: ';
const CONTEXT_AUTHORITY = '^context: a source cannot raise';
const CONTEXT_PROVENANCE = '^context: a source that loses';
const LATTICE = '^lattice: ';
const MCP_UNKNOWN = '^mcp: malformed and unknown';
const MCP_SCOPE = '^mcp: a request outside';
const WEAK = '^engineering: static-only';
const ARGS = '^engineering: every argument form';
const UNCOVERED = '^engineering: a criterion without an executable check';

// [id, group, matrix case (anchored name pattern), file, [[anchor, replacement], ...]]; every anchor must occur once.
const MUTANTS = [
  [
    'import_eager',
    'import',
    IMPORT,
    'packages/agent-environment/index.js',
    [["const loadComputer = () => require('./computer');", "const loadComputer = ((loaded) => () => loaded)(require('./computer'));"]],
  ],
  [
    'lsp_scope',
    'scope',
    LSP,
    'packages/agent-environment/lsp.js',
    [["if (!mapped) throw new LspError('location is outside the workspace root', 'ENV_LSP_OUT_OF_SCOPE');", 'if (false) void 0;']],
  ],
  // dap_survivor is deliberately absent: the sandbox kills a survivor three ways (pid namespace, cgroup.kill, group SIGKILL),
  // so removing any one is an equivalent mutant. The matrix case asserts the end result in /proc instead.
  [
    'approval_binding',
    'approval',
    COMPUTER_BINDING,
    'tools/cli/lib/environment-approval.js',
    [['if (bound.digest !== entry.binding) {', 'if (false) {']],
  ],
  [
    'approval_expiry',
    'approval',
    COMPUTER_EXPIRY,
    'tools/cli/lib/environment-approval.js',
    [['const expired = (entry) => now().getTime() >= entry.expires_at_ms;', 'const expired = () => false;']],
  ],
  [
    'approval_reuse',
    'approval',
    COMPUTER_REUSE,
    'tools/cli/lib/environment-approval.js',
    [["if (entry.state === 'consumed') return refuse(", 'if (false) return refuse(']],
  ],
  [
    'media_magic',
    'provenance',
    MEDIA_MAGIC,
    'packages/agent-context/media-store.js',
    [['if (!signature(buffer)) throw mismatch(', 'if (false) throw mismatch(']],
  ],
  [
    'media_size',
    'provenance',
    MEDIA_SIZE,
    'packages/agent-context/media-store.js',
    [['if (buffer.length !== descriptor.bytes)', 'if (false)']],
  ],
  [
    'args_chars_value',
    'args',
    ARGS,
    'tools/cli/lib/engineering-task-contract.js',
    [["const ARG_WORD = '[A-Za-z0-9._@/-]+';", "const ARG_WORD = '[A-Za-z0-9._@/+*|&\"-]+';"]],
  ],
  [
    'args_chars_word',
    'args',
    ARGS,
    'tools/cli/lib/engineering-task-contract.js',
    [['/^[A-Za-z0-9._@/][A-Za-z0-9._@/-]*$/,', '/^[A-Za-z0-9._@/][A-Za-z0-9._@/+*|&\'"-]*$/,']],
  ],
  [
    'args_newline',
    'args',
    ARGS,
    'tools/cli/lib/engineering-task-contract.js',
    [['/^[A-Za-z0-9._@/][A-Za-z0-9._@/-]*$/,', '/^[A-Za-z0-9._@/][A-Za-z0-9._@/-]*$/m,']],
  ],
  ['args_short_digit', 'args', ARGS, 'tools/cli/lib/engineering-task-contract.js', [['/^-[A-Za-z]$/]', '/^-[A-Za-z0-9=]$/]']]],
  [
    'browser_egress',
    'scope',
    BROWSER,
    'tools/cli/lib/environment-egress-broker.js',
    [['if (!allowed.has(authority(target.host, target.port))) {', 'if (false) {']],
  ],
  [
    'approval_required',
    'approval',
    COMPUTER_NO_APPROVAL,
    'packages/agent-environment/computer.js',
    [["if (typeof approvalId !== 'string') return refuse(", 'if (false) return refuse(']],
  ],
  [
    'approval_consume',
    'approval',
    COMPUTER_NO_APPROVAL,
    'packages/agent-environment/computer.js',
    [["if (spent.status !== 'consumed') return refuse(", 'if (false) return refuse(']],
  ],
  [
    'approval_granted',
    'approval',
    COMPUTER_PENDING,
    'tools/cli/lib/environment-approval.js',
    [["if (entry.state !== 'approved') return refuse(", 'if (false) return refuse(']],
  ],
  [
    'media_digest',
    'provenance',
    MEDIA,
    'packages/agent-context/media-store.js',
    [['if (sha256(buffer) !== descriptor.digest)', 'if (false)']],
  ],
  [
    'memory_authority',
    'authority',
    MEMORY,
    'packages/agent-memory/policy.js',
    [['if (input.authority !== undefined && input.authority !== AUTHORITY) {', 'if (false) {']],
  ],
  [
    'memory_trust',
    'authority',
    MEMORY,
    'packages/agent-memory/store.js',
    [["trust: 'untrusted',\n        transform: [", 'trust: entry.trust,\n        transform: [']],
  ],
  [
    'context_authority',
    'authority',
    CONTEXT_AUTHORITY,
    'packages/agent-context/authority.js',
    [['if (AUTHORITY_RANK[authority] > AUTHORITY_RANK[rule.authority]) {', 'if (false) {']],
  ],
  ['lattice_capability', 'authority', LATTICE, 'packages/agent-policy-lattice/index.js', [['if (widened.length > 0) {', 'if (false) {']]],
  ['lattice_budget', 'authority', LATTICE, 'packages/agent-policy-lattice/index.js', [['if (requestedLimit > parentLimit)', 'if (false)']]],
  [
    'provenance_missing',
    'provenance',
    CONTEXT_PROVENANCE,
    'packages/agent-context/authority.js',
    [['if (source.authority === undefined || source.provenance === undefined) {', 'if (false) {']],
  ],
  [
    'provenance_digest',
    'provenance',
    CONTEXT_PROVENANCE,
    'packages/agent-context/authority.js',
    [["if (layer !== 'media' && provenance.digest !== sha256Text(sourceText(source))) {", 'if (false) {']],
  ],
  [
    'mcp_unknown',
    'scope',
    MCP_UNKNOWN,
    'tools/lib/legacy-mcp-server.js',
    [["if (typeof name !== 'string' || !tools.has(name)) {", 'if (false) {']],
  ],
  [
    'mcp_scope',
    'scope',
    MCP_SCOPE,
    'tools/mcp-hseos-swarm/lib/run-scope.js',
    [['function isInside(base, target) {', 'function isInside(base, target) {\n  return true;']],
  ],
  [
    'weak_acceptance',
    'weak',
    WEAK,
    'tools/cli/lib/engineering-task-contract.js',
    [["requireCondition(modules, 'ENGINEERING_ACCEPTANCE_WEAK');", 'void modules;']],
  ],
  [
    'acceptance_uncovered',
    'weak',
    UNCOVERED,
    'tools/cli/lib/engineering-task-contract.js',
    [['(item.check_ids || []).some((id) => executable.has(id)),', 'true,']],
  ],
  [
    'args_unchecked',
    'args',
    ARGS,
    'tools/cli/lib/engineering-task-contract.js',
    [["requireCondition(isConservativeArg(arg), 'ENGINEERING_COMMAND_ARG_INVALID');", 'void arg;']],
  ],
  [
    'args_relaxed',
    'args',
    ARGS,
    'tools/cli/lib/engineering-task-contract.js',
    [
      [
        'const isConservativeArg = (arg) => ARG_FORMS.some((form) => form.test(arg));',
        String.raw`const isConservativeArg = (arg) => ARG_FORMS.some((form) => form.test(arg)) || /^\S+$/u.test(arg);`,
      ],
    ],
  ],
];

// The loader replays the recorded replacement in memory when the target module is compiled.
const LOADER = `'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const spec = JSON.parse(fs.readFileSync(process.env.HSEOS_W5_MUTATION_SPEC, 'utf8'));
const target = path.resolve(spec.repo, spec.file);
const original = Module._extensions['.js'];
Module._extensions['.js'] = function (module, filename) {
  if (filename !== target) return original(module, filename);
  let source = fs.readFileSync(filename, 'utf8');
  for (const [before, after] of spec.replacements) {
    if (source.split(before).length !== 2) throw new Error('Mutation anchor must occur exactly once: ' + before);
    source = source.replace(before, () => after);
  }
  process.stderr.write('HSEOS_TEST_MUTATION_APPLIED:' + spec.id + '\\n');
  module._compile(source, filename);
};
`;

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-w5-mutation-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const loader = path.join(scratch, 'loader.cjs');
fs.writeFileSync(loader, LOADER);

function runMatrix(pattern, extraEnv) {
  const env = { ...process.env, NODE_V8_COVERAGE: '', ...extraEnv };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  if (extraEnv.NODE_OPTIONS) env.NODE_OPTIONS = extraEnv.NODE_OPTIONS;
  return spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', `--test-name-pattern=${pattern}`, MATRIX], {
    cwd: REPO,
    env,
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

const status = () => spawnSync('git', ['-C', REPO, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }).stdout;

for (const [id, group, pattern, file, replacements] of MUTANTS) {
  test(`the negative matrix detects removal of the ${id} guard (${group})`, () => {
    const dirty = status();
    const control = runMatrix(pattern, {});
    assert.equal(control.error, undefined);
    assert.equal(control.status, 0, control.stdout + control.stderr);
    assert.match(control.stdout, /^# tests 1$/m, 'the pattern selects exactly one matrix case');
    assert.match(control.stdout, /^# fail 0$/m);
    assert.doesNotMatch(control.stdout + control.stderr, /HSEOS_TEST_MUTATION_APPLIED/);

    const specFile = path.join(scratch, `${id}.json`);
    fs.writeFileSync(specFile, JSON.stringify({ id, repo: REPO, file, replacements }));
    const mutant = runMatrix(pattern, { HSEOS_W5_MUTATION_SPEC: specFile, NODE_OPTIONS: `--require ${loader}` });
    assert.equal(mutant.error, undefined);
    assert.equal(mutant.status, 1, mutant.stdout + mutant.stderr);
    assert.match(mutant.stdout + mutant.stderr, new RegExp(`HSEOS_TEST_MUTATION_APPLIED:${id}`), 'the mutation was applied');
    assert.match(mutant.stdout, /^# fail 1$/m);
    assert.match(mutant.stdout, /ERR_ASSERTION/);
    assert.equal(status(), dirty, 'the working tree is exactly as before the mutant');
  });
}

test('every mutation group of the W5 contract has at least one mutant', () => {
  const groups = new Set(MUTANTS.map((mutant) => mutant[1]));
  for (const group of ['authority', 'provenance', 'approval', 'weak', 'args']) assert.ok(groups.has(group), group);
  assert.equal(new Set(MUTANTS.map((mutant) => mutant[0])).size, MUTANTS.length, 'mutant ids are unique');
});
