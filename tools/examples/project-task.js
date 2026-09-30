'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { prepareProjectTask } = require('../cli/lib/engineering-workspace');
const { engineeringDigest } = require('../cli/lib/engineering-task-state');
const sha = (value) => createHash('sha256').update(value).digest('hex');

function createProjectExample(name, directory, { correction = false } = {}) {
  if (!['typescript-report', 'python-inventory'].includes(name)) throw new Error('Unknown project example');
  const python = name === 'python-inventory';
  const root = path.resolve(directory, name);
  fs.mkdirSync(root, { mode: 0o700 });
  const source = python
    ? 'Calculate inventory availability without negative stock.'
    : 'Build a report that retains zero-valued rows and excludes null amounts.';
  const bad = python
    ? 'def summary(records):\n    available = [r["quantity"] - r["reserved"] for r in records]\n    return {"items": len(records), "available": sum(available)}\n'
    : 'type Row = {label: string; amount: number | null};\nconst cents = require("./money.ts");\nmodule.exports = function report(rows: Row[]) {\n  const selected = rows.filter(row => row.amount);\n  return {count: selected.length, total_cents: selected.reduce((n, row) => n + cents(row.amount), 0), labels: selected.map(row => row.label)};\n};\n';
  const before = python ? 'r["quantity"] - r["reserved"]' : 'row => row.amount';
  const after = python ? 'max(0, r["quantity"] - r["reserved"])' : 'row => row.amount !== null';
  const edited = python ? 'inventory/stock.py' : 'src/report.ts';
  const entry = python ? 'app.py' : 'src/report.ts';
  const files = python
    ? {
        'app.py': 'from inventory.stock import summary\ndef calculate(records): return summary(records)\n',
        'inventory/__init__.py': '',
        'inventory/stock.py': bad,
        'scripts/check.py':
          'import os,sys\nsys.path.insert(0,os.getcwd())\nfrom app import calculate\nassert calculate([]) == {"items": 0, "available": 0}\nprint("project tests passed")\n',
        'README.md': '# Inventory project\nAvailability subtracts reservations without negative stock.\n',
      }
    : {
        'package.json':
          JSON.stringify(
            {
              name: 'hseos-report-example',
              version: '1.0.0',
              private: true,
              scripts: { test: 'node --experimental-strip-types scripts/check.ts' },
            },
            null,
            2,
          ) + '\n',
        'src/report.ts': bad,
        'src/money.ts': 'module.exports = function cents(amount: number): number { return Math.round(amount * 100); };\n',
        'scripts/check.ts':
          'const assert = require("node:assert/strict");\nconst report = require("../src/report.ts");\nassert.deepEqual(report([]), {count: 0, total_cents: 0, labels: []});\nconsole.log("project tests passed");\n',
        'README.md': '# Report project\nSummarizes amounts in integer cents, retaining zero-valued rows.\n',
      };
  for (const [filename, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, filename)), { recursive: true });
    fs.writeFileSync(path.join(root, filename), content, { flag: 'wx', mode: 0o600 });
  }
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 });
  git('init', '-b', 'task/project-example');
  git('config', 'user.name', 'HSEOS Example');
  git('config', 'user.email', 'example@example.invalid');
  git('add', '.');
  git('commit', '-m', 'test(project): establish example baseline');
  const checks = python
    ? [
        {
          args: [
            [
              { quantity: 3, reserved: 5 },
              { quantity: 7, reserved: 2 },
            ],
          ],
          expected: { items: 2, available: 5 },
        },
        { args: [[]], expected: { items: 0, available: 0 } },
        { args: [[{ quantity: 0, reserved: 0 }]], expected: { items: 1, available: 0 } },
      ]
    : [
        {
          args: [
            [
              { label: 'A', amount: 10 },
              { label: 'Zero', amount: 0 },
              { label: 'Null', amount: null },
            ],
          ],
          expected: { count: 2, total_cents: 1000, labels: ['A', 'Zero'] },
        },
        { args: [[]], expected: { count: 0, total_cents: 0, labels: [] } },
        {
          args: [
            [
              { label: 'Credit', amount: -2.5 },
              { label: 'Debit', amount: 2.5 },
            ],
          ],
          expected: { count: 2, total_cents: 0, labels: ['Credit', 'Debit'] },
        },
      ];
  const contract = prepareProjectTask({
    schema_version: 2,
    task_id: name,
    execution_profile: 'managed-project',
    workspace: { root },
    sources: [{ id: 'spec', kind: 'specification', content: source, sha256: sha(source) }],
    requirements: [{ id: 'r1', description: source, source_ids: ['spec'] }],
    acceptance: [{ id: 'a1', description: 'Protected cases validate boundary, empty and ordinary inputs.', requirement_ids: ['r1'] }],
    scope: { read: Object.keys(files), write: [edited] },
    commands: [{ id: 'test', runtime: python ? 'python' : 'node', entrypoint: python ? 'scripts/check.py' : 'scripts/check.ts', args: [] }],
    limits: { max_turns: 12, max_tokens: 500_000, max_duration_ms: 120_000, max_tool_calls: 12, max_children: 0, max_workflow_steps: 0 },
    max_failed_corrections: 1,
    max_artifact_bytes: 65_536,
    max_output_bytes: 8192,
    verifier: {
      reference: `verifier://project/${python ? 'python' : 'node'}-module-v1`,
      acceptance_ids: ['a1'],
      checks: checks.map((check) => ({ path: entry, export_name: python ? 'calculate' : 'default', ...check })),
    },
    rollback: 'discard-disposable-workspace',
  });
  const responses = [
    { name: 'engineering.search', input: { text: before, limit: 10 } },
    ...(correction
      ? [
          { name: 'fixture.submit', input: {} },
          {
            name: 'engineering.diagnose',
            input: {
              cause: source,
              correction: 'Apply the boundary-condition correction and rerun the project tests.',
              requirement_ids: ['r1'],
              files_sha256: engineeringDigest(
                Object.entries(files).map(([filename, content]) => ({ path: filename, content, sha256: sha(content) })),
              ),
            },
          },
        ]
      : []),
    { name: 'engineering.patch', input: { path: edited, expected_sha256: sha(bad), before, after } },
    { name: 'engineering.command', input: { id: 'test' } },
    { name: 'engineering.diff', input: {} },
  ];
  return { contract, responses };
}

if (require.main === module) {
  const example = createProjectExample(process.argv[2], process.argv[3], { correction: process.argv.includes('--correction') });
  const filename = path.resolve(process.argv[3], 'project-example.json');
  fs.writeFileSync(filename, JSON.stringify(example, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify({ example: filename, workspace: example.contract.workspace.root }) + '\n');
}
module.exports = { createProjectExample };
