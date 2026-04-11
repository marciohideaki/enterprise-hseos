/**
 * Installation Components Tests
 *
 * Validates that critical HSEOS installation artifacts are present and well-formed.
 */

const path = require('node:path');
const fs = require('node:fs');
const yaml = require('yaml');

const REPO_ROOT = path.join(__dirname, '..');

const REQUIRED_PATHS = [
  '.hseos/AGENT-MANIFEST.md',
  '.hseos/config/hseos.config.yaml',
  '.enterprise/.specs/constitution/Enterprise-Constitution.md',
  'CLAUDE.md',
];

const REQUIRED_AGENT_FILES = [
  'nyx', 'vector', 'cipher', 'ghost', 'razor', 'glitch', 'prism', 'blitz', 'quill',
  'orbit', 'forge', 'kube', 'sable',
];

function run() {
  let passed = 0;
  let failed = 0;

  // Check required paths
  for (const p of REQUIRED_PATHS) {
    const fullPath = path.join(REPO_ROOT, p);
    if (fs.existsSync(fullPath)) {
      console.log(`  PASS  ${p}`);
      passed++;
    } else {
      console.error(`  FAIL  Missing: ${p}`);
      failed++;
    }
  }

  // Check agent YAML files
  for (const code of REQUIRED_AGENT_FILES) {
    const agentFile = path.join(REPO_ROOT, '.hseos', 'agents', `${code}.agent.yaml`);
    if (fs.existsSync(agentFile)) {
      console.log(`  PASS  .hseos/agents/${code}.agent.yaml`);
      passed++;
    } else {
      console.error(`  FAIL  Missing agent: .hseos/agents/${code}.agent.yaml`);
      failed++;
    }
  }

  // Validate hseos.config.yaml is parseable
  const configPath = path.join(REPO_ROOT, '.hseos', 'config', 'hseos.config.yaml');
  if (fs.existsSync(configPath)) {
    try {
      yaml.parse(fs.readFileSync(configPath, 'utf8'));
      console.log('  PASS  hseos.config.yaml is valid YAML');
      passed++;
    } catch (error) {
      console.error(`  FAIL  hseos.config.yaml parse error: ${error.message}`);
      failed++;
    }
  }

  console.log(`\nInstallation tests: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

run();
