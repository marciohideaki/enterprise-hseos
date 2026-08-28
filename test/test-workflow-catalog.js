'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const yaml = require('yaml');
const { loadWorkflowCatalog, validateWorkflowCatalogDocument } = require('../tools/cli/lib/workflow-catalog');
const { listWorkflows } = require('../tools/mcp-hseos-governance/lib/spec-reader');

const REPO_ROOT = path.join(__dirname, '..');

function registryDocument() {
  return yaml.parse(fs.readFileSync(path.join(REPO_ROOT, '.hseos', 'workflows', 'registry.yaml'), 'utf8'));
}

test('workflow catalog distinguishes executable workflows from side-car subsystems', () => {
  const workflows = loadWorkflowCatalog(REPO_ROOT);
  assert.equal(workflows.length, 8);
  assert.equal(workflows.find((workflow) => workflow.id === 'state-tracking').kind, 'subsystem');
  assert.ok(
    workflows
      .filter((workflow) => workflow.kind === 'executable')
      .every((workflow) => workflow.execution_mode === 'sequential' && workflow.phases.length > 0),
  );
});

test('workflow schema fails closed on ambiguous kinds, duplicate phases, and unsafe entrypoints', () => {
  const missingKind = registryDocument();
  delete missingKind.workflows[0].kind;
  assert.throws(() => validateWorkflowCatalogDocument(missingKind, REPO_ROOT), /explicit kind/);

  const duplicatePhase = registryDocument();
  duplicatePhase.workflows[0].phases.push({ ...duplicatePhase.workflows[0].phases[0] });
  assert.throws(() => validateWorkflowCatalogDocument(duplicatePhase, REPO_ROOT), /duplicate phase/);

  const unsafeEntrypoint = registryDocument();
  unsafeEntrypoint.workflows[0].entrypoint = '../outside.md';
  assert.throws(() => validateWorkflowCatalogDocument(unsafeEntrypoint, REPO_ROOT), /safe relative path/);
});

test('workflow schema rejects invalid dependencies and executable fields on subsystems', () => {
  const invalidDependency = registryDocument();
  invalidDependency.workflows[1].depends_on = [{ workflow: 'missing', profiles: ['core'] }];
  assert.throws(() => validateWorkflowCatalogDocument(invalidDependency, REPO_ROOT), /invalid dependency/);

  const executableSubsystem = registryDocument();
  const subsystem = executableSubsystem.workflows.find((workflow) => workflow.id === 'state-tracking');
  subsystem.phases = [];
  assert.throws(() => validateWorkflowCatalogDocument(executableSubsystem, REPO_ROOT), /cannot declare executable/);
});

test('MCP workflow discovery uses the parsed catalog and profile membership', () => {
  const all = listWorkflows();
  const runtime = listWorkflows('runtime');
  assert.equal(all.total, 8);
  assert.ok(all.workflows.some((workflow) => workflow.id === 'state-tracking' && workflow.kind === 'subsystem'));
  assert.ok(runtime.workflows.every((workflow) => workflow.profiles.includes('runtime')));
  assert.ok(runtime.workflows.some((workflow) => workflow.id === 'runtime-deploy'));
});
