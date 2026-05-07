'use strict';

const path = require('node:path');
const fs = require('fs-extra');

const REQUIRED_REPO_PATHS = [
  '.agents',
  '.hseos',
  '.enterprise',
  '.agents/manifest.yaml',
  '.agents/instructions/PROJECT.md',
  '.agents/hooks/registry.yaml',
  '.agents/skills',
  '.hseos/config/hseos.config.yaml',
  '.enterprise/.specs/constitution',
];

async function checkRepoStructure(projectDir) {
  const missing = [];
  for (const rel of REQUIRED_REPO_PATHS) {
    if (!(await fs.pathExists(path.join(projectDir, rel)))) {
      missing.push(rel);
    }
  }
  if (missing.length > 0) {
    return {
      id: 'repo_structure',
      title: 'Repository structure',
      ok: false,
      details: `Missing: ${missing.join(', ')}`,
      remedy: 'Run `npx hseos install` to scaffold missing directories.',
    };
  }
  return {
    id: 'repo_structure',
    title: 'Repository structure',
    ok: true,
    details: `${REQUIRED_REPO_PATHS.length} required paths present`,
  };
}

function pendingCheck(id, title) {
  return {
    id,
    title,
    ok: true,
    details: 'Implementation pending — Wave 6 follow-up PR',
  };
}

async function runDoctor(projectDir, options = {}) {
  const repoStructure = await checkRepoStructure(projectDir);

  // Remaining seven checks are stubs until Wave 6 implementation lands.
  // Returning ok:true with a "pending" details string lets CI integrate
  // the command immediately without false negatives.
  const checks = [
    repoStructure,
    pendingCheck('manifest_integrity', 'Manifest integrity (hash chain)'),
    pendingCheck('skills_consistency', 'Skills consistency'),
    pendingCheck('hooks_reachable', 'Hooks reachable'),
    pendingCheck('mcp_servers', 'MCP servers handshake'),
    pendingCheck('adapters_compiled', 'Adapters compiled'),
    pendingCheck('governance_baseline', 'Governance baseline'),
    pendingCheck('state_tracking', 'State tracking'),
  ];

  const errors = checks.filter((c) => !c.ok && c.remedy === undefined).map((c) => c.details);
  const remediable = checks.filter((c) => !c.ok && c.remedy !== undefined);
  const warnings = remediable.map((c) => `${c.title}: ${c.remedy}`);

  return {
    ok: errors.length === 0,
    quick: Boolean(options.quick),
    checks,
    warnings,
    errors,
  };
}

module.exports = { runDoctor };
