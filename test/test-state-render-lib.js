/**
 * Snapshot tests for the pure render functions in state-render-lib.
 * No DB dependency — feeds fixed sample inputs and asserts exact string match.
 */

const assert = require('node:assert');
const { renderPlan, renderStatus, renderResumePrompt } = require('../tools/cli/lib/state-render-lib');

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

const sampleRun = {
  id: 'R-sample',
  workflow_id: 'dev-squad',
  project: '/opt/sample',
  phase: 'execute',
  gate_status: 'PASSED',
  status: 'active',
  base_branch: 'feature/foo',
  session_id: 'sess-abc',
};

const sampleTasks = [
  { id: 'T1', wave: 1, effort: 'small', model_tier: 'haiku', status: 'OK', goal: 'do thing' },
  { id: 'T2', wave: 1, effort: 'medium', model_tier: 'sonnet', status: 'IN_PROGRESS', goal: 'pipe | escape' },
];

const sampleAgentRuns = [
  { id: 1, agent_name: 'A', task_id: 'T1', status: 'completed' },
  { id: 2, agent_name: 'B', task_id: 'T2', status: 'running' },
];

console.log('state-render-lib snapshot tests');

it('renderPlan produces deterministic markdown with table', () => {
  const out = renderPlan(sampleRun, sampleTasks);
  const expected =
    '# PLAN — R-sample\n' +
    '\n' +
    '**Workflow:** dev-squad\n' +
    '**Project:** /opt/sample\n' +
    '**Phase:** execute    Gate: PASSED\n' +
    '\n' +
    '**Base branch:** feature/foo\n' +
    '**Session:** sess-abc\n' +
    '\n' +
    '## Tasks\n' +
    '\n' +
    '| ID | Wave | Effort | Tier | Status | Goal |\n' +
    '|---|---|---|---|---|---|\n' +
    '| T1 | 1 | small | haiku | OK | do thing |\n' +
    String.raw`| T2 | 1 | medium | sonnet | IN_PROGRESS | pipe \| escape |` +
    '\n';
  assert.strictEqual(out, expected);
});

it('renderStatus lists tasks and agent runs', () => {
  const out = renderStatus(sampleRun, sampleTasks, sampleAgentRuns);
  assert.ok(out.startsWith('# STATUS — R-sample\n'));
  assert.ok(out.includes('- T1: OK\n'));
  assert.ok(out.includes('- T2: IN_PROGRESS\n'));
  assert.ok(out.includes('- #1 agent=A task=T1 status=completed'));
  assert.ok(out.includes('- #2 agent=B task=T2 status=running'));
});

it('renderResumePrompt emits run id and source-of-truth pointer', () => {
  const out = renderResumePrompt(sampleRun);
  assert.ok(out.startsWith('# RESUME-PROMPT — R-sample\n'));
  assert.ok(out.includes('Run id: R-sample'));
  assert.ok(out.includes('Session: sess-abc'));
  assert.ok(out.includes('hseos state-describe R-sample'));
});

it('renderResumePrompt elides session line when absent', () => {
  const runNoSession = { ...sampleRun, session_id: null };
  const out = renderResumePrompt(runNoSession);
  assert.ok(!out.includes('Session:'));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
