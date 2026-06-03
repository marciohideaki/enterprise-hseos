/**
 * Agent Schema Tests
 *
 * Validates that all *.agent.yaml files in .hseos/agents/ are parseable YAML
 * and contain the required HSEOS agent structure fields.
 */

const path = require('node:path');
const fs = require('node:fs');
const yaml = require('yaml');

const REPO_ROOT = path.join(__dirname, '..');
const AGENTS_DIR = path.join(REPO_ROOT, '.hseos', 'agents');
const WORKFLOW_REGISTRY = path.join(REPO_ROOT, '.hseos', 'workflows', 'registry.yaml');

const REQUIRED_FIELDS = ['metadata', 'persona', 'authority', 'bootstrap', 'menu'];
const REQUIRED_METADATA = ['id', 'code', 'name', 'title', 'framework', 'capabilities'];

function validateAgent(filePath, content) {
  const issues = [];
  const parsed = yaml.parse(content);

  if (!parsed || !parsed.agent) {
    issues.push('Missing top-level "agent" key');
    return issues;
  }

  const agent = parsed.agent;

  for (const field of REQUIRED_FIELDS) {
    if (!agent[field]) {
      issues.push(`Missing agent.${field}`);
    }
  }

  if (agent.metadata) {
    for (const field of REQUIRED_METADATA) {
      if (!agent.metadata[field]) {
        issues.push(`Missing agent.metadata.${field}`);
      }
    }
  }

  for (const item of agent.menu || []) {
    if (item.exec) {
      // Menu execs may anchor into a workflow file (e.g. workflow.md#section);
      // strip the anchor before checking that the file exists.
      const target = path.join(REPO_ROOT, item.exec.split('#')[0]);
      if (!fs.existsSync(target)) {
        issues.push(`Menu exec not found: ${item.exec}`);
      }
    }
  }

  return issues;
}

function run() {
  if (!fs.existsSync(AGENTS_DIR)) {
    console.log('No .hseos/agents/ directory found — skipping agent schema tests.');
    return;
  }

  const files = fs.readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.agent.yaml'));

  if (files.length === 0) {
    console.log('No agent YAML files found — skipping.');
    return;
  }

  let passed = 0;
  let failed = 0;

  for (const file of files) {
    const filePath = path.join(AGENTS_DIR, file);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const issues = validateAgent(filePath, content);
      if (issues.length > 0) {
        console.error(`  FAIL  ${file}: ${issues.join(', ')}`);
        failed++;
      } else {
        console.log(`  PASS  ${file}`);
        passed++;
      }
    } catch (error) {
      console.error(`  FAIL  ${file}: ${error.message}`);
      failed++;
    }
  }

  if (fs.existsSync(WORKFLOW_REGISTRY)) {
    const registry = yaml.parse(fs.readFileSync(WORKFLOW_REGISTRY, 'utf8')) || {};
    for (const workflow of registry.workflows || []) {
      if (!workflow.entrypoint) {
        console.error(`  FAIL  workflow:${workflow.id}: Missing entrypoint`);
        failed++;
        continue;
      }
      if (!fs.existsSync(path.join(REPO_ROOT, workflow.entrypoint))) {
        console.error(`  FAIL  workflow:${workflow.id}: entrypoint not found: ${workflow.entrypoint}`);
        failed++;
      }
    }
  }

  console.log(`\nAgent schema tests: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

run();
