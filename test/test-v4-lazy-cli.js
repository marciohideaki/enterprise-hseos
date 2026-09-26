'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { createEngineeringExample } = require('../tools/examples/engineering-task');

function fixture(check) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-lazy-cli-'));
  const guard = path.join(directory, 'guard.cjs');
  fs.writeFileSync(
    guard,
    `
const Module=require('node:module');
const original=Module._load;
Module._load=function(name,parent,main){
  const filename=Module._resolveFilename(name,parent,main);
  if (/managed-governance|delegated-(?:codex|claude|deepseek)|openai-compatible-provider|(?:commands|lib)\\/(?:brain|kanban|ado|gitops)/.test(filename)) throw new Error('OPTIONAL_MODULE_LOADED:'+filename);
  return original.apply(this,arguments);
};
const cp=require('node:child_process');
for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']) cp[name]=()=>{throw new Error('UNEXPECTED_PROCESS:'+name)};
global.fetch=()=>{throw new Error('UNEXPECTED_NETWORK')};
`,
  );
  try {
    check(directory, (args) =>
      spawnSync(process.execPath, ['--require', guard, path.join(__dirname, '../tools/cli/hseos-cli.js'), ...args], {
        env: { PATH: process.env.PATH, HOME: directory, TMPDIR: os.tmpdir() },
        encoding: 'utf8',
        timeout: 15_000,
      }),
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('help and structural validation do not load optional integrations or query updates', () =>
  fixture((directory, run) => {
    for (const args of [['--help'], ['agent', '--help'], ['workflow', '--help']]) {
      const result = run(args);
      assert.equal(result.status, 0, result.stderr);
    }
    const contract = path.join(directory, 'task.json');
    fs.writeFileSync(contract, JSON.stringify(createEngineeringExample('addition').contract));
    const result = run(['agent', 'validate-task', '--task-contract', contract, '--json']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, 'structurally-valid');
  }));

test('fresh minimal and engineering materialization excludes optional implementations and services', () =>
  fixture((directory, run) => {
    for (const profile of ['minimal', 'disposable-engineering-candidate']) {
      const target = path.join(directory, profile);
      const result = run(['install', '--directory', target, '--profile', profile, '--yes', '--json']);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const receipt = JSON.parse(result.stdout);
      assert.equal(receipt.hooks, 0);
      assert.equal(receipt.skills, 0);
      assert.equal(receipt.mcp_servers, 0);
      if (profile !== 'minimal') assert.ok(receipt.components.includes('runtime:agent-kernel'));
      for (const absent of [
        '.agents/skills/ado-ops',
        '.agents/hooks/handlers',
        '.agents/plugins',
        '.hseos/workflows',
        '.enterprise/governance/agent-skills/second-brain',
        'packages/managed-governance-client',
        'tools/kanban-central',
      ])
        assert.equal(fs.existsSync(path.join(target, absent)), false, absent);
      assert.equal(fs.existsSync(path.join(target, '.enterprise/.specs/constitution/Enterprise-Constitution.md')), true);
      assert.equal(fs.existsSync(path.join(target, 'AGENTS.md')), true);
    }
  }));

test('npx wrapper preserves literal arguments without invoking a shell', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-npx-wrapper-'));
  try {
    const tools = path.join(directory, '_npx', 'tools');
    fs.mkdirSync(path.join(tools, 'cli'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, '../tools/hseos-npx-wrapper.js'), path.join(tools, 'wrapper.js'));
    fs.writeFileSync(path.join(tools, 'cli/hseos-cli.js'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
    const marker = path.join(directory, 'unrequested-effect');
    const args = [
      'agent',
      'validate-task',
      '--task-contract',
      'path with spaces/task.json',
      '',
      `$(touch ${marker})`,
      ';echo unsafe',
      '"quoted"',
    ];
    const result = spawnSync(process.execPath, [path.join(tools, 'wrapper.js'), ...args], { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), args);
    assert.equal(fs.existsSync(marker), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
