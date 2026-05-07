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
  '.agents/instructions/PROJECT.md',
  '.agents/hooks/registry.yaml',
  '.agents/manifest.yaml',
  '.agents/skills/secure-coding/SKILL.md',
  'CLAUDE.md',
  'AGENTS.md',
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

  // Validate portable agent manifest is parseable and has generated skills
  const agentManifestPath = path.join(REPO_ROOT, '.agents', 'manifest.yaml');
  if (fs.existsSync(agentManifestPath)) {
    try {
      const manifest = yaml.parse(fs.readFileSync(agentManifestPath, 'utf8'));
      if (manifest?.counts?.skills >= 40 && manifest?.adapters?.codex && manifest?.adapters?.claude_code) {
        console.log('  PASS  .agents/manifest.yaml has portable adapters and skills');
        passed++;
      } else {
        console.error('  FAIL  .agents/manifest.yaml missing expected adapters or skill count');
        failed++;
      }
    } catch (error) {
      console.error(`  FAIL  .agents/manifest.yaml parse error: ${error.message}`);
      failed++;
    }
  }

  console.log(`\nInstallation tests: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

run();
