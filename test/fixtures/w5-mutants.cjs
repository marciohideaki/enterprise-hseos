'use strict';

// Data only: the W5 mutant table. test/test-w5-mutations.js runs it and scripts/governance/check-w5-mutations.js derives
// the expected test count from its length. Nothing here executes a test at require time.
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

module.exports = { MUTANTS };
