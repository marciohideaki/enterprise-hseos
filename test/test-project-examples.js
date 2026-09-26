'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createProjectExample } = require('../tools/examples/project-task');
const { runEngineeringTask, inspectEngineeringTask } = require('../tools/cli/lib/engineering-task-runtime');

for (const name of ['typescript-report', 'python-inventory']) {
  test(`real ${name} project is rejected, diagnosed, corrected and independently approved`, async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-project-example-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const example = createProjectExample(name, directory, { correction: true });
    const taskContract = path.join(directory, 'contract.json');
    const scriptedResponses = path.join(directory, 'responses.json');
    fs.writeFileSync(taskContract, JSON.stringify(example.contract));
    fs.writeFileSync(scriptedResponses, JSON.stringify(example.responses));
    const result = await runEngineeringTask({ taskContract, scriptedResponses });
    t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
    assert.equal(result.task_result, 'approved', JSON.stringify(result));
    assert.equal(result.correction_reviews[0].approved, false);
    assert.equal(result.correction_diagnoses.length, 1);
    assert.equal((await inspectEngineeringTask({ state: result.state })).task_run_id, result.task_run_id);
  });
}

test('patch cannot bypass required diagnosis after protected rejection', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-project-example-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const example = createProjectExample('typescript-report', directory, { correction: true });
  example.responses = example.responses.filter((response) => response.name !== 'engineering.diagnose');
  const taskContract = path.join(directory, 'contract.json');
  const scriptedResponses = path.join(directory, 'responses.json');
  fs.writeFileSync(taskContract, JSON.stringify(example.contract));
  fs.writeFileSync(scriptedResponses, JSON.stringify(example.responses));
  const result = await runEngineeringTask({ taskContract, scriptedResponses });
  t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
  assert.equal(result.task_result, 'failed', JSON.stringify(result));
  assert.equal(result.correction_diagnoses.length, 0);
});
