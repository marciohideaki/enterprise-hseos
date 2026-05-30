/**
 * Sandbox CLI tests — verifies HSEOS builds ai-jail commands without requiring
 * ai-jail to be installed, and fails only when sandboxing is explicitly required.
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const yaml = require('yaml');
const { buildSandboxCommand, sandboxDoctor } = require('../tools/cli/lib/sandbox');

const REPO_ROOT = path.join(__dirname, '..');
const HSEOS_CLI = path.join(REPO_ROOT, 'tools', 'cli', 'hseos-cli.js');

let pass = 0;
let fail = 0;

function it(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (error) {
    console.log(`  ✗ ${name}\n    ${error.message}`);
    fail++;
  }
}

function makeTempProject(sandbox) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-sandbox-test-'));
  const configDir = path.join(dir, '.hseos', 'config');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'hseos.config.yaml'), yaml.stringify(sandbox ? { sandbox } : {}));
  return dir;
}

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [HSEOS_CLI, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
    ...opts,
  });
}

console.log('Sandbox CLI tests');

it('builds standard ai-jail command with HSEOS safe defaults', () => {
  const dir = makeTempProject();
  const built = buildSandboxCommand({
    projectDir: dir,
    command: ['codex'],
  });
  const command = built.display;
  if (!command.includes('ai-jail --private-home')) throw new Error(command);
  if (!command.includes('--no-docker')) throw new Error(command);
  if (!command.includes('--no-display')) throw new Error(command);
  if (!command.includes('--no-gpu')) throw new Error(command);
  if (!command.includes('--mask .env')) throw new Error(command);
  if (!command.endsWith('-- codex')) throw new Error(command);
});

it('sandbox doctor passes when ai-jail is missing but required=false', () => {
  const dir = makeTempProject({ provider: 'ai-jail', required: false });
  const result = sandboxDoctor(dir, { PATH: '' });
  if (!result.ok) throw new Error(JSON.stringify(result, null, 2));
  const binaryCheck = result.checks.find((check) => check.id === 'ai_jail_binary');
  if (!binaryCheck || binaryCheck.required || binaryCheck.ok) {
    throw new Error(JSON.stringify(binaryCheck));
  }
});

it('sandbox doctor fails when ai-jail is missing and required=true', () => {
  const dir = makeTempProject({ provider: 'ai-jail', required: true });
  const result = sandboxDoctor(dir, { PATH: '' });
  if (result.ok) throw new Error(JSON.stringify(result, null, 2));
  const binaryCheck = result.checks.find((check) => check.id === 'ai_jail_binary');
  if (!binaryCheck || !binaryCheck.required || binaryCheck.ok) {
    throw new Error(JSON.stringify(binaryCheck));
  }
});

it('hseos sandbox run --dry-run prints command and does not require ai-jail', () => {
  const dir = makeTempProject();
  const result = runCli(['sandbox', 'run', '--directory', dir, '--dry-run', '--', 'codex', '--model', 'test']);
  if (result.status !== 0) throw new Error(`exit ${result.status}: ${result.stderr || result.stdout}`);
  if (!result.stdout.includes('ai-jail --private-home')) throw new Error(result.stdout);
  if (!result.stdout.includes('-- codex --model test')) throw new Error(result.stdout);
});

it('hseos sandbox doctor --json returns structured output', () => {
  const dir = makeTempProject();
  const result = runCli(['sandbox', 'doctor', '--directory', dir, '--json']);
  if (result.status !== 0) throw new Error(`exit ${result.status}: ${result.stderr || result.stdout}`);
  const body = JSON.parse(result.stdout);
  if (body.provider !== 'ai-jail') throw new Error(result.stdout);
  if (!Array.isArray(body.checks) || body.checks.length === 0) throw new Error(result.stdout);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
