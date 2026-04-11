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

  console.log(`\nAgent schema tests: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

run();
