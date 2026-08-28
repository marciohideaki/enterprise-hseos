'use strict';

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('yaml');
const { getProjectRoot } = require('./project-root');

const WORKFLOW_SCHEMA_VERSION = '2.0';
const WORKFLOW_KINDS = new Set(['executable', 'subsystem']);
const SUPPORTED_PROFILES = new Set(['core', 'release', 'runtime', 'full']);
const CHECK_KINDS = new Set([
  'git_repo',
  'path_exists',
  'any_path_exists',
  'glob_exists',
  'command_exists',
  'package_script',
  'config_flag',
  'env_var',
]);
const WORKFLOW_KEYS = new Set([
  'id',
  'kind',
  'execution_mode',
  'name',
  'owner',
  'entrypoint',
  'description',
  'profiles',
  'state',
  'phases',
  'checks',
  'batch',
  'depends_on',
  'feature_flag',
  'cli_commands',
  'mcp_tools',
  'surfaces',
]);

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function assertId(value, label) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]*$/.test(value)) throw new Error(`${label} has invalid id`);
}

function assertUniqueStrings(values, label, allowed = null) {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    new Set(values).size !== values.length ||
    values.some((value) => typeof value !== 'string' || !value.trim() || (allowed && !allowed.has(value)))
  ) {
    throw new Error(`${label} must contain unique supported values`);
  }
}

function assertSafeRelative(value, label) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    path.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    value.split(/[\\/]/).includes('..')
  ) {
    throw new Error(`${label} must be a safe relative path`);
  }
}

function assertExactKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`${label} has unknown field(s): ${unknown.join(', ')}`);
}

function normalizeWorkflowCatalogDocument(document) {
  if (Number(document?.version) !== 1 || document.schema_version !== undefined) return document;
  return {
    version: 2,
    schema_version: WORKFLOW_SCHEMA_VERSION,
    workflows: Array.isArray(document.workflows)
      ? document.workflows.map((workflow) => {
          const executable = Array.isArray(workflow?.phases) || Array.isArray(workflow?.checks);
          return {
            ...workflow,
            kind: executable ? 'executable' : 'subsystem',
            ...(executable ? { execution_mode: 'sequential' } : {}),
          };
        })
      : document.workflows,
  };
}

function validateWorkflowCatalogDocument(document, root = getProjectRoot()) {
  document = normalizeWorkflowCatalogDocument(document);
  assertObject(document, 'Workflow registry');
  const unknownTopLevel = Object.keys(document).filter((key) => !new Set(['version', 'schema_version', 'workflows']).has(key));
  if (unknownTopLevel.length > 0) throw new Error(`Workflow registry has unknown field(s): ${unknownTopLevel.join(', ')}`);
  if (Number(document.version) !== 2 || String(document.schema_version) !== WORKFLOW_SCHEMA_VERSION) {
    throw new Error('Workflow registry requires version 2 and schema_version 2.0');
  }
  if (!Array.isArray(document.workflows) || document.workflows.length === 0) {
    throw new Error('Workflow registry requires workflows');
  }

  const ids = new Set();
  for (const workflow of document.workflows) {
    assertObject(workflow, 'Workflow entry');
    assertExactKeys(workflow, WORKFLOW_KEYS, 'Workflow entry');
    assertId(workflow.id, 'Workflow entry');
    if (ids.has(workflow.id)) throw new Error(`Workflow registry has duplicate id: ${workflow.id}`);
    ids.add(workflow.id);
    if (!WORKFLOW_KINDS.has(workflow.kind)) throw new Error(`Workflow ${workflow.id} requires an explicit kind`);
    for (const field of ['name', 'owner', 'description']) {
      if (typeof workflow[field] !== 'string' || !workflow[field].trim()) throw new Error(`Workflow ${workflow.id} requires ${field}`);
    }
    assertSafeRelative(workflow.entrypoint, `Workflow ${workflow.id}.entrypoint`);
    if (!fs.existsSync(path.join(root, workflow.entrypoint))) throw new Error(`Workflow ${workflow.id} entrypoint does not exist`);
    assertUniqueStrings(workflow.profiles, `Workflow ${workflow.id}.profiles`, SUPPORTED_PROFILES);
    if (workflow.state !== undefined) {
      assertObject(workflow.state, `Workflow ${workflow.id}.state`);
      assertExactKeys(workflow.state, new Set(['runs_dir', 'template', 'db_path']), `Workflow ${workflow.id}.state`);
      assertSafeRelative(workflow.state.runs_dir, `Workflow ${workflow.id}.state.runs_dir`);
      for (const field of ['template', 'db_path']) {
        if (workflow.state[field] !== undefined) assertSafeRelative(workflow.state[field], `Workflow ${workflow.id}.state.${field}`);
      }
    }

    for (const dependency of workflow.depends_on || []) {
      assertObject(dependency, `Workflow ${workflow.id} dependency`);
      assertExactKeys(dependency, new Set(['workflow', 'profiles']), `Workflow ${workflow.id} dependency`);
      assertId(dependency.workflow, `Workflow ${workflow.id} dependency`);
      assertUniqueStrings(dependency.profiles, `Workflow ${workflow.id} dependency profiles`, SUPPORTED_PROFILES);
    }

    if (workflow.kind === 'subsystem') {
      if (workflow.phases !== undefined || workflow.checks !== undefined || workflow.execution_mode !== undefined) {
        throw new Error(`Subsystem ${workflow.id} cannot declare executable workflow fields`);
      }
      continue;
    }

    if (workflow.execution_mode !== 'sequential') {
      throw new Error(`Executable workflow ${workflow.id} requires sequential phase execution`);
    }
    if (!Array.isArray(workflow.phases) || workflow.phases.length === 0) {
      throw new Error(`Executable workflow ${workflow.id} requires phases`);
    }
    const phaseIds = new Set();
    for (const phase of workflow.phases) {
      assertObject(phase, `Workflow ${workflow.id} phase`);
      assertExactKeys(phase, new Set(['id', 'name', 'agent', 'supporting_agents', 'outputs']), `Workflow ${workflow.id} phase`);
      assertId(phase.id, `Workflow ${workflow.id} phase`);
      if (phaseIds.has(phase.id)) throw new Error(`Workflow ${workflow.id} has duplicate phase: ${phase.id}`);
      phaseIds.add(phase.id);
      for (const field of ['name', 'agent']) {
        if (typeof phase[field] !== 'string' || !phase[field].trim())
          throw new Error(`Workflow ${workflow.id} phase ${phase.id} requires ${field}`);
      }
      assertUniqueStrings(phase.outputs, `Workflow ${workflow.id} phase ${phase.id}.outputs`);
      if (phase.supporting_agents !== undefined) {
        assertUniqueStrings(phase.supporting_agents, `Workflow ${workflow.id} phase ${phase.id}.supporting_agents`);
      }
    }
    if (workflow.batch !== undefined) {
      assertObject(workflow.batch, `Workflow ${workflow.id}.batch`);
      assertExactKeys(
        workflow.batch,
        new Set(['enabled', 'handoff_after_phase', 'packet_dir', 'log_dir']),
        `Workflow ${workflow.id}.batch`,
      );
      if (typeof workflow.batch.enabled !== 'boolean') throw new Error(`Workflow ${workflow.id}.batch.enabled must be boolean`);
      if (workflow.batch.handoff_after_phase !== undefined && !phaseIds.has(workflow.batch.handoff_after_phase)) {
        throw new Error(`Workflow ${workflow.id} batch handoff references an unknown phase`);
      }
      for (const field of ['packet_dir', 'log_dir']) {
        if (workflow.batch[field] !== undefined) assertSafeRelative(workflow.batch[field], `Workflow ${workflow.id}.batch.${field}`);
      }
    }
    if (!Array.isArray(workflow.checks)) throw new Error(`Executable workflow ${workflow.id} requires a checks list`);
    const checkIds = new Set();
    for (const check of workflow.checks) {
      assertObject(check, `Workflow ${workflow.id} check`);
      assertExactKeys(
        check,
        new Set(['id', 'kind', 'required', 'profiles', 'prepare', 'path', 'paths', 'glob', 'command', 'scripts', 'key', 'var']),
        `Workflow ${workflow.id} check`,
      );
      assertId(check.id, `Workflow ${workflow.id} check`);
      if (checkIds.has(check.id)) throw new Error(`Workflow ${workflow.id} has duplicate check: ${check.id}`);
      checkIds.add(check.id);
      if (!CHECK_KINDS.has(check.kind)) throw new Error(`Workflow ${workflow.id} check ${check.id} has unsupported kind`);
      if (typeof check.required !== 'boolean') throw new Error(`Workflow ${workflow.id} check ${check.id} requires required boolean`);
      assertUniqueStrings(check.profiles, `Workflow ${workflow.id} check ${check.id}.profiles`, SUPPORTED_PROFILES);
      if (typeof check.prepare !== 'string' || !check.prepare.trim()) {
        throw new Error(`Workflow ${workflow.id} check ${check.id} requires prepare guidance`);
      }
    }
  }

  for (const workflow of document.workflows) {
    for (const dependency of workflow.depends_on || []) {
      if (!ids.has(dependency.workflow) || dependency.workflow === workflow.id) {
        throw new Error(`Workflow ${workflow.id} has invalid dependency: ${dependency.workflow}`);
      }
    }
  }
  const dependencies = new Map(
    document.workflows.map((workflow) => [workflow.id, (workflow.depends_on || []).map((item) => item.workflow)]),
  );
  const visiting = new Set();
  const visited = new Set();
  function visit(workflowId) {
    if (visiting.has(workflowId)) throw new Error(`Workflow dependency cycle includes: ${workflowId}`);
    if (visited.has(workflowId)) return;
    visiting.add(workflowId);
    for (const dependencyId of dependencies.get(workflowId) || []) visit(dependencyId);
    visiting.delete(workflowId);
    visited.add(workflowId);
  }
  for (const workflowId of dependencies.keys()) visit(workflowId);
  return document.workflows;
}

function loadWorkflowCatalog(root = getProjectRoot()) {
  const registryPath = path.join(root, '.hseos', 'workflows', 'registry.yaml');
  const document = yaml.parse(fs.readFileSync(registryPath, 'utf8')) || {};
  return validateWorkflowCatalogDocument(document, root);
}

module.exports = {
  CHECK_KINDS,
  SUPPORTED_PROFILES,
  WORKFLOW_KINDS,
  WORKFLOW_SCHEMA_VERSION,
  loadWorkflowCatalog,
  normalizeWorkflowCatalogDocument,
  validateWorkflowCatalogDocument,
};
