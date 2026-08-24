'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const Database = require('better-sqlite3');
const { runMigrations } = require('../tools/mcp-project-state/lib/migrations');

const ROOT = path.join(__dirname, '..');
const DISPOSITION_PATH = path.join(ROOT, '_graph', 'agentic-framework', 'CLAUDE-CODE-HARDENING-DISPOSITION.json');
const PROPOSALS = Object.freeze(JSON.parse(fs.readFileSync(DISPOSITION_PATH, 'utf8')).proposals);
const NEUTRAL_CORE = Object.freeze([
  'packages/agent-policy-lattice',
  'packages/agent-isolation-attestation',
  'packages/agent-message-transport',
  'packages/delegated-runtime-host',
  'packages/agent-trace-lineage',
  'tools/cli/lib/provider-egress-broker.js',
]);

function javascriptFiles(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  if (fs.statSync(absolutePath).isFile()) return [absolutePath];
  return fs.readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(absolutePath, entry.name);
    if (entry.isDirectory()) return javascriptFiles(path.relative(ROOT, child));
    return entry.isFile() && entry.name.endsWith('.js') ? [child] : [];
  });
}

test('Claude Code learning disposition is exact, complete, and executable', () => {
  assert.deepEqual(
    PROPOSALS.map(({ id, verdict }) => ({ id, verdict })),
    [
      { id: 1, verdict: 'adopted' },
      { id: 2, verdict: 'adopted' },
      { id: 3, verdict: 'adopted' },
      { id: 4, verdict: 'adopted' },
      { id: 5, verdict: 'adopted' },
      { id: 6, verdict: 'partially_adopted' },
      { id: 7, verdict: 'adopted' },
    ],
  );
  const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;
  for (const proposal of PROPOSALS) {
    assert.equal(typeof scripts[proposal.suite], 'string', `missing ${proposal.suite}`);
    const publicSurface = require(path.join(ROOT, proposal.module));
    for (const exportName of proposal.exports) {
      assert.equal(typeof publicSurface[exportName], 'function', `missing ${proposal.module}#${exportName}`);
    }
  }
  assert.equal(PROPOSALS[5].rejected, 'generic sentinel substitution');
  assert.match(scripts.test, /test:agentic-hardening-conformance/u);
});

test('all seven hardened seams remain provider-neutral by explicit core allowlist', () => {
  const vendorBranch = /\b(?:anthropic|claude|codex|deepseek|gemini|openai)\b/iu;
  for (const relativePath of NEUTRAL_CORE) {
    for (const filename of javascriptFiles(relativePath)) {
      assert.doesNotMatch(fs.readFileSync(filename, 'utf8'), vendorBranch, path.relative(ROOT, filename));
    }
  }
});

test('hardening closeout preserves the operational cutover gates', () => {
  const state = fs.readFileSync(path.join(ROOT, '_graph', 'agentic-framework', 'STATE.md'), 'utf8');
  assert.match(state, /30 complete G9 zero-use days/u);
  assert.match(state, /explicit human cutover authorization/u);
  assert.match(state, /A15–A20 Claude Code hardening/u);
  const database = new Database(':memory:');
  try {
    const result = runMigrations(database, path.join(ROOT, 'tools', 'mcp-project-state', 'migrations'), { log() {} });
    assert.equal(result.current, 4);
    assert.deepEqual(result.applied, [
      '001-agent-state-tables.sql',
      '002-events-fts.sql',
      '003-session-tracking.sql',
      '004-session-context.sql',
    ]);
    assert.equal(database.pragma('user_version', { simple: true }), 4);
    for (const table of ['as_agent_runs', 'as_events', 'as_runs', 'as_sessions', 'as_tasks']) {
      assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
    }
  } finally {
    database.close();
  }
});
