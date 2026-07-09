/**
 * Behavior tests for the blocking PreToolUse hooks.
 *
 * Unlike test-hook-handlers.js (syntax/smoke over every handler), this suite
 * asserts the DECISIONS the three blocking gates emit for concrete inputs:
 *   - swarm-gate: model routing guard + dev-squad gate (+ active-run bypass)
 *   - claude-md-guard: deny direct CLAUDE.md writes, allow everything else
 *   - ado-branch-guard: block `git push` to trunk only when ado.enabled=true
 *
 * All scenarios run against the COMPILED handlers in .agents/hooks/handlers/
 * (the exact files wired into .claude/hooks.json), with hermetic temp dirs so
 * repository state (e.g., historic dev-squad runs) cannot flip a verdict.
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');
const HANDLERS = path.join(REPO_ROOT, '.agents', 'hooks', 'handlers');

let passed = 0;
let failed = 0;

function assertPass(label, condition, details = '') {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}${details ? ` - ${details}` : ''}`);
    failed++;
  }
}

function runHandler(script, { input = '', args = [], env = {}, cwd = REPO_ROOT } = {}) {
  const cleanEnv = { ...process.env, ...env };
  delete cleanEnv.DEV_SQUAD_ACTIVE_FLAG;
  delete cleanEnv.DEV_SQUAD_ACTIVE_ENV;
  Object.assign(cleanEnv, env);
  const result = spawnSync('bash', [path.join(HANDLERS, script), ...args], {
    input,
    cwd,
    env: cleanEnv,
    encoding: 'utf8',
    timeout: 15_000,
  });
  let decision = null;
  try {
    decision = JSON.parse(result.stdout.trim()).hookSpecificOutput;
  } catch {
    decision = null;
  }
  return { ...result, decision };
}

function agentPayload(toolInput) {
  return JSON.stringify({ tool_name: 'Agent', tool_input: toolInput });
}

function testSwarmGateModelRouting(emptyProjectDir) {
  const base = { env: { CLAUDE_PROJECT_DIR: emptyProjectDir } };

  const noModel = runHandler('swarm-gate.sh', {
    ...base,
    input: agentPayload({ prompt: 'implemente o fix no módulo de auth', description: 'fix auth' }),
  });
  assertPass(
    'swarm-gate: execution agent without model → ask (missing sonnet)',
    noModel.decision?.permissionDecision === 'ask' && noModel.decision?.permissionDecisionReason === 'execution-agent-missing-sonnet-model',
    JSON.stringify(noModel.decision),
  );

  const sonnet = runHandler('swarm-gate.sh', {
    ...base,
    input: agentPayload({ prompt: 'implemente o fix no módulo de auth', description: 'fix auth', model: 'sonnet' }),
  });
  assertPass(
    'swarm-gate: execution agent with model=sonnet → allow',
    sonnet.decision?.permissionDecision === 'allow',
    JSON.stringify(sonnet.decision),
  );

  const opus = runHandler('swarm-gate.sh', {
    ...base,
    input: agentPayload({ prompt: 'implemente o fix no módulo de auth', description: 'fix auth', model: 'opus' }),
  });
  assertPass(
    'swarm-gate: execution agent with model=opus (no strategic opt-in) → ask',
    opus.decision?.permissionDecision === 'ask' &&
      opus.decision?.permissionDecisionReason === 'execution-agent-opus-not-allowed-without-opt-in',
    JSON.stringify(opus.decision),
  );
}

function testSwarmGateDevSquadGate(emptyProjectDir) {
  const devSquadPrompt = agentPayload({
    prompt: 'dispare 5 agentes em paralelo em worktrees para o batch',
    description: 'batch paralelo',
    model: 'sonnet',
  });

  const gated = runHandler('swarm-gate.sh', {
    input: devSquadPrompt,
    env: { CLAUDE_PROJECT_DIR: emptyProjectDir },
  });
  assertPass(
    'swarm-gate: dev-squad pattern without active run → ask (blocking gate)',
    gated.decision?.permissionDecision === 'ask' && gated.decision?.permissionDecisionReason === 'swarm-gate-dev-squad-not-invoked',
    JSON.stringify(gated.decision),
  );

  const bypassed = runHandler('swarm-gate.sh', {
    input: devSquadPrompt,
    env: { CLAUDE_PROJECT_DIR: emptyProjectDir, DEV_SQUAD_ACTIVE_FLAG: '1' },
  });
  assertPass(
    'swarm-gate: dev-squad pattern with active-run flag → allow (bypass)',
    bypassed.decision?.permissionDecision === 'allow' && bypassed.decision?.permissionDecisionReason === 'dev-squad-run-active',
    JSON.stringify(bypassed.decision),
  );
}

function testClaudeMdGuard() {
  const denyByArg = runHandler('claude-md-guard.sh', { args: ['CLAUDE.md'] });
  assertPass(
    'claude-md-guard: CLAUDE.md path argument → deny',
    denyByArg.decision?.permissionDecision === 'deny',
    JSON.stringify(denyByArg.decision),
  );

  const denyByStdin = runHandler('claude-md-guard.sh', {
    input: JSON.stringify({ tool_input: { file_path: '/some/project/CLAUDE.md' } }),
  });
  assertPass(
    'claude-md-guard: CLAUDE.md via stdin payload → deny',
    denyByStdin.decision?.permissionDecision === 'deny',
    JSON.stringify(denyByStdin.decision),
  );

  const allowOther = runHandler('claude-md-guard.sh', { args: ['src/index.js'] });
  assertPass(
    'claude-md-guard: non-CLAUDE.md path → silent allow (exit 0, no decision)',
    allowOther.status === 0 && allowOther.decision === null,
    `status=${allowOther.status} stdout=${allowOther.stdout}`,
  );
}

function makeGitProject({ adoEnabled }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-hook-'));
  spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' });
  if (adoEnabled) {
    fs.mkdirSync(path.join(dir, '.hseos', 'config'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.hseos', 'config', 'hseos.config.yaml'), 'ado:\n  enabled: true\n', 'utf8');
  }
  return dir;
}

function testAdoBranchGuard() {
  const enabledRepo = makeGitProject({ adoEnabled: true });
  const disabledRepo = makeGitProject({ adoEnabled: false });

  const blocked = runHandler('ado-branch-guard.sh', {
    cwd: enabledRepo,
    env: { CLAUDE_TOOL_COMMAND: 'git push origin main' },
  });
  assertPass(
    'ado-branch-guard: push to trunk with ado.enabled → blocked (exit 2)',
    blocked.status === 2 && /bloqueado/.test(blocked.stderr),
    `status=${blocked.status} stderr=${blocked.stderr.slice(0, 120)}`,
  );

  const featurePush = runHandler('ado-branch-guard.sh', {
    cwd: enabledRepo,
    env: { CLAUDE_TOOL_COMMAND: 'git push origin feature/wave-w001-example' },
  });
  assertPass(
    'ado-branch-guard: push to feature branch → allowed (exit 0)',
    featurePush.status === 0,
    `status=${featurePush.status} stderr=${featurePush.stderr.slice(0, 120)}`,
  );

  const flagOff = runHandler('ado-branch-guard.sh', {
    cwd: disabledRepo,
    env: { CLAUDE_TOOL_COMMAND: 'git push origin main' },
  });
  assertPass(
    'ado-branch-guard: feature flag off → silent no-op even for trunk push',
    flagOff.status === 0,
    `status=${flagOff.status} stderr=${flagOff.stderr.slice(0, 120)}`,
  );

  fs.rmSync(enabledRepo, { recursive: true, force: true });
  fs.rmSync(disabledRepo, { recursive: true, force: true });
}

console.log('blocking-hooks behavior tests');

const emptyProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-gate-'));
testSwarmGateModelRouting(emptyProjectDir);
testSwarmGateDevSquadGate(emptyProjectDir);
testClaudeMdGuard();
testAdoBranchGuard();
fs.rmSync(emptyProjectDir, { recursive: true, force: true });

console.log(`\nBlocking-hook tests: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
