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

// [id, group, matrix case (anchored name pattern), file, [[anchor, replacement], ...], options?]; every anchor must occur once.
// A mutant that the matrix cannot reach (a second guard behind the public one, a guard only a seam-level test can distinguish)
// names its own detecting suite in `options.suite`; `options.failure` is the assertion text the failing run must show (default
// ERR_ASSERTION). The matrix stays the default so the 28 original mutants are untouched.
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
  // Mutants declared without detection by the W5 residue register (T-5 triage). Each is killed by a unit-level suite, not by the
  // matrix, because the guard sits behind a public one or a seam is needed to distinguish it.
  [
    'lsp_scope_resolved',
    'scope',
    '^every reported location is mapped',
    'packages/agent-environment/lsp.js',
    [
      [
        "if (!within(workspace, real)) throw new LspError('location resolves outside the workspace root', 'ENV_LSP_OUT_OF_SCOPE');",
        'void 0;',
      ],
    ],
    { suite: 'test/test-environment-lsp.js' },
  ],
  [
    'mcp_run_id',
    'scope',
    null,
    'tools/mcp-hseos-swarm/lib/run-scope.js',
    [["if (typeof value !== 'string' || !RUN_ID_PATTERN.test(value)) {", 'if (false) {']],
    {
      suite: 'test/test-mcp-hseos-swarm-scope.js',
      failure: /consolidate_handoff refused .* with an unexpected error: tools\/call: Path escapes allowed directory/,
    },
  ],
  [
    'approval_screenshot_digest',
    'approval',
    '^an approved action runs once, bound',
    'packages/agent-environment/computer.js',
    [['screenshot_digest: current.lastShot?.digest,', "screenshot_digest: 'a'.repeat(64),"]],
    { suite: 'test/test-environment-computer.js' },
  ],
  [
    'screenshot_ceiling',
    'provenance',
    '^a screenshot becomes untrusted display data',
    'packages/agent-environment/computer.js',
    [['png.length <= LIMITS.max_screenshot_bytes &&', 'true &&']],
    { suite: 'test/test-environment-computer.js' },
  ],
  [
    'computer_display_env',
    'scope',
    '^host children never inherit',
    'packages/agent-environment/computer-host.js',
    [
      [
        "const BASE_ENV = Object.freeze({ PATH: '/usr/bin:/bin', HOME: '/tmp', LANG: 'C' });",
        "const BASE_ENV = Object.freeze({ PATH: '/usr/bin:/bin', HOME: '/tmp', LANG: 'C', DISPLAY: process.env.DISPLAY });",
      ],
    ],
    { suite: 'test/test-environment-computer.js' },
  ],
  [
    'browser_preflight',
    'scope',
    '^a navigation outside the allowlist is refused by the controller',
    'packages/agent-environment/browser.js',
    [['if (!broker.allow.includes(urlAuthority(url))) {', 'if (false) {']],
    { suite: 'test/test-environment-browser.js' },
  ],
  [
    'zip_extract_traversal',
    'scope',
    '^extractZip defends itself',
    'tools/lib/environment-toolchain-pins.js',
    [['if (destination !== base && !destination.startsWith(`${base}${path.sep}`))', 'if (false)']],
    { suite: 'test/test-toolchain-zip-streaming.js' },
  ],
  [
    'run_scope_nofollow',
    'scope',
    null,
    'tools/mcp-hseos-swarm/lib/run-scope.js',
    [['flags | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK', 'flags | fs.constants.O_NONBLOCK']],
    {
      suite: 'test/test-mcp-hseos-swarm-scope.js',
      failure:
        /did not match the regular expression .*Symlink not allowed: NOFOLLOW-READ[^]*Input:\s*#?\s*'Path escapes allowed directory: NOFOLLOW-READ\.md'/,
    },
  ],
  [
    'run_scope_parent_realpath',
    'scope',
    null,
    'tools/mcp-hseos-swarm/lib/run-scope.js',
    [['if (!isInside(canonicalBase, fs.realpathSync(`/proc/self/fd/${parentFd}`))) {', 'if (false) {']],
    {
      suite: 'test/test-mcp-hseos-swarm-scope.js',
      failure: /an ancestor swapped for a symlink[^]{0,200}nothing may be created outside the base/,
    },
  ],
  [
    'run_scope_open_by_path',
    'scope',
    null,
    'tools/mcp-hseos-swarm/lib/run-scope.js',
    [['target = `/proc/self/fd/${parentFd}/${path.basename(file)}`;', 'target = file;']],
    {
      suite: 'test/test-mcp-hseos-swarm-scope.js',
      failure: /the file is opened relative to the validated parent descriptor[^]{0,80}Path escapes allowed directory: NEW\.md/,
    },
  ],
  [
    'toolchain_restore',
    'scope',
    '^a failed final rename puts the previous install back',
    'tools/lib/environment-toolchain-pins.js',
    [['if (replaced) fs.renameSync(previous, target);', 'void 0;']],
    { suite: 'test/test-toolchain-zip-streaming.js' },
  ],
  [
    'toolchain_stale_staging',
    'scope',
    '^a staging or previous directory left by an earlier run',
    'tools/lib/environment-toolchain-pins.js',
    [['removeQuietly(staging);\n      removeQuietly(previous);', 'removeQuietly(previous);']],
    { suite: 'test/test-toolchain-zip-streaming.js' },
  ],
  [
    'toolchain_stale_previous',
    'scope',
    '^a staging or previous directory left by an earlier run',
    'tools/lib/environment-toolchain-pins.js',
    [['removeQuietly(staging);\n      removeQuietly(previous);', 'removeQuietly(staging);']],
    { suite: 'test/test-toolchain-zip-streaming.js' },
  ],
  [
    'store_pin_at_assembly',
    'scope',
    '^a harmless-looking addition to the store between assembly',
    'tools/cli/lib/engineering-task-runtime.js',
    [['if (storeMount) pinStoreMount(policy, contract.workspace.root, storeMount);', 'void 0;']],
    { suite: 'test/test-engineering-project.js' },
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

function runSuite(suite, pattern, extraEnv) {
  const env = { ...process.env, NODE_V8_COVERAGE: '', ...extraEnv };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  if (extraEnv.NODE_OPTIONS) env.NODE_OPTIONS = extraEnv.NODE_OPTIONS;
  const selection = pattern === null ? [] : [`--test-name-pattern=${pattern}`];
  return spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', ...selection, suite], {
    cwd: REPO,
    env,
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

const status = () => spawnSync('git', ['-C', REPO, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }).stdout;

for (const [id, group, pattern, file, replacements, options = {}] of MUTANTS) {
  const suite = options.suite ?? MATRIX;
  test(`the ${options.suite ? 'unit suite' : 'negative matrix'} detects removal of the ${id} guard (${group})`, () => {
    const dirty = status();
    const control = runSuite(suite, pattern, {});
    assert.equal(control.error, undefined);
    assert.equal(control.status, 0, control.stdout + control.stderr);
    assert.match(control.stdout, /^# tests 1$/m, 'the pattern selects exactly one case');
    assert.match(control.stdout, /^# fail 0$/m);
    assert.doesNotMatch(control.stdout + control.stderr, /HSEOS_TEST_MUTATION_APPLIED/);

    const specFile = path.join(scratch, `${id}.json`);
    fs.writeFileSync(specFile, JSON.stringify({ id, repo: REPO, file, replacements }));
    const mutant = runSuite(suite, pattern, { HSEOS_W5_MUTATION_SPEC: specFile, NODE_OPTIONS: `--require ${loader}` });
    assert.equal(mutant.error, undefined);
    assert.equal(mutant.status, 1, mutant.stdout + mutant.stderr);
    assert.match(mutant.stdout + mutant.stderr, new RegExp(`HSEOS_TEST_MUTATION_APPLIED:${id}`), 'the mutation was applied');
    assert.match(mutant.stdout, /^# fail 1$/m);
    if (options.failure) assert.match(mutant.stdout + mutant.stderr, options.failure);
    else assert.match(mutant.stdout, /ERR_ASSERTION/);
    assert.equal(status(), dirty, 'the working tree is exactly as before the mutant');
  });
}

test('every mutation group of the W5 contract has at least one mutant', () => {
  const groups = new Set(MUTANTS.map((mutant) => mutant[1]));
  for (const group of ['authority', 'provenance', 'approval', 'weak', 'args']) assert.ok(groups.has(group), group);
  assert.equal(new Set(MUTANTS.map((mutant) => mutant[0])).size, MUTANTS.length, 'mutant ids are unique');
});
