'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('fs-extra');
const yaml = require('yaml');

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

async function checkManifestIntegrity(projectDir) {
  const manifestPath = path.join(projectDir, '.agents', 'manifest.yaml');
  if (!(await fs.pathExists(manifestPath))) {
    return {
      id: 'manifest_integrity',
      title: 'Manifest integrity',
      ok: false,
      details: 'manifest.yaml not found',
      remedy: 'Run `hseos agent-core compile` to generate the manifest.',
    };
  }
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    const manifest = yaml.parse(raw);
    if (!manifest || !manifest.version) {
      return {
        id: 'manifest_integrity',
        title: 'Manifest integrity',
        ok: false,
        details: 'manifest.yaml missing required `version` field',
        remedy: 'Run `hseos agent-core compile` to regenerate a valid manifest.',
      };
    }
    const skills = Array.isArray(manifest.skills) ? manifest.skills : [];
    let driftCount = 0;
    for (const entry of skills) {
      if (!entry || !entry.output || !entry.hash) continue;
      const outputPath = path.join(projectDir, entry.output);
      if (!(await fs.pathExists(outputPath))) {
        driftCount++;
        continue;
      }
      const observed = crypto
        .createHash('sha256')
        .update(await fs.readFile(outputPath))
        .digest('hex');
      if (observed !== entry.hash) driftCount++;
    }
    if (driftCount > 0) {
      return {
        id: 'manifest_integrity',
        title: 'Manifest integrity',
        ok: false,
        details: `${driftCount} skill(s) have hash mismatches or missing outputs`,
        remedy: 'Run `hseos agent-core compile` to refresh, or `hseos agent-core audit` to inspect drift.',
      };
    }
    return {
      id: 'manifest_integrity',
      title: 'Manifest integrity',
      ok: true,
      details: `manifest v${manifest.version}, ${skills.length} skill(s) clean`,
    };
  } catch (error) {
    return {
      id: 'manifest_integrity',
      title: 'Manifest integrity',
      ok: false,
      details: `manifest.yaml parse error: ${error.message}`,
      remedy: 'Run `hseos agent-core compile` to regenerate.',
    };
  }
}

async function checkSkillsConsistency(projectDir) {
  const skillsDir = path.join(projectDir, '.agents', 'skills');
  if (!(await fs.pathExists(skillsDir))) {
    return {
      id: 'skills_consistency',
      title: 'Skills consistency',
      ok: true,
      details: 'No skills directory — skipped',
    };
  }
  const entries = await fs.readdir(skillsDir);
  const missing = [];
  for (const entry of entries) {
    const skillMd = path.join(skillsDir, entry, 'SKILL.md');
    if (!(await fs.pathExists(skillMd))) missing.push(entry);
  }
  if (missing.length > 0) {
    return {
      id: 'skills_consistency',
      title: 'Skills consistency',
      ok: false,
      details: `${missing.length} skill dir(s) missing SKILL.md: ${missing.join(', ')}`,
      remedy: 'Each skill directory must contain a SKILL.md file.',
    };
  }
  return {
    id: 'skills_consistency',
    title: 'Skills consistency',
    ok: true,
    details: `${entries.length} skill(s) — all have SKILL.md`,
  };
}

async function checkHooksReachable(projectDir) {
  const registryPath = path.join(projectDir, '.agents', 'hooks', 'registry.yaml');
  if (!(await fs.pathExists(registryPath))) {
    return {
      id: 'hooks_reachable',
      title: 'Hooks reachable',
      ok: false,
      details: 'registry.yaml not found',
      remedy: 'Run `hseos agent-core compile` to regenerate the hook registry.',
    };
  }
  try {
    const raw = await fs.readFile(registryPath, 'utf8');
    const registry = yaml.parse(raw) || {};
    const hooks = Array.isArray(registry.hooks) ? registry.hooks : [];
    const activeHooks = hooks.filter((h) => !h.status || h.status === 'active');
    const unreachable = [];
    for (const hook of activeHooks) {
      if (!hook.command) continue;
      for (const scriptRef of extractBashScriptRefs(hook.command)) {
        const scriptPath = path.join(projectDir, scriptRef);
        if (!(await fs.pathExists(scriptPath))) unreachable.push(scriptRef);
      }
    }
    if (unreachable.length > 0) {
      return {
        id: 'hooks_reachable',
        title: 'Hooks reachable',
        ok: false,
        details: `${unreachable.length} hook script(s) not found: ${unreachable.join(', ')}`,
        remedy: 'Ensure hook handler scripts exist at the declared paths.',
      };
    }
    return {
      id: 'hooks_reachable',
      title: 'Hooks reachable',
      ok: true,
      details: `${activeHooks.length} active hook(s) — all scripts reachable`,
    };
  } catch (error) {
    return {
      id: 'hooks_reachable',
      title: 'Hooks reachable',
      ok: false,
      details: `registry.yaml parse error: ${error.message}`,
      remedy: 'Run `hseos agent-core compile` to regenerate.',
    };
  }
}

function extractBashScriptRefs(command) {
  const refs = [];
  const bashInvocations = command.matchAll(/\bbash\s+("[^"]+"|'[^']+'|[^\s;|&]+)/g);

  for (const match of bashInvocations) {
    let token = match[1];
    if (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"))
    ) {
      token = token.slice(1, -1);
    }
    token = token.replace(/^\$\(git rev-parse --show-toplevel 2>\/dev\/null\)\//, '');

    if (token.startsWith('$(')) {
      const repoRelative = token.match(/\)\/([^"' ]+\.sh)\b/);
      if (repoRelative) token = repoRelative[1];
    }

    if (!token || token.startsWith('-') || token.includes('$') || path.isAbsolute(token)) continue;
    if (!token.endsWith('.sh')) continue;
    refs.push(token);
  }

  return refs;
}

async function checkMcpBundles(projectDir) {
  const bundlesDir = path.join(projectDir, '.agents', 'mcp', 'bundles');
  if (!(await fs.pathExists(bundlesDir))) {
    return {
      id: 'mcp_servers',
      title: 'MCP bundle declarations',
      ok: true,
      details: 'No MCP bundles declared — skipped',
    };
  }
  const files = await fs.readdir(bundlesDir);
  const yamlFiles = files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  if (yamlFiles.length === 0) {
    return {
      id: 'mcp_servers',
      title: 'MCP bundle declarations',
      ok: true,
      details: 'Bundles directory exists but no YAML files declared',
    };
  }
  let totalServers = 0;
  const parseErrors = [];
  for (const f of yamlFiles) {
    try {
      const raw = await fs.readFile(path.join(bundlesDir, f), 'utf8');
      const bundle = yaml.parse(raw) || {};
      const servers = Array.isArray(bundle.servers) ? bundle.servers : [];
      totalServers += servers.length;
    } catch (error) {
      parseErrors.push(`${f}: ${error.message}`);
    }
  }
  if (parseErrors.length > 0) {
    return {
      id: 'mcp_servers',
      title: 'MCP bundle declarations',
      ok: false,
      details: `Parse errors in ${parseErrors.length} bundle file(s): ${parseErrors.join('; ')}`,
      remedy: 'Fix YAML syntax in the affected bundle files.',
    };
  }
  return {
    id: 'mcp_servers',
    title: 'MCP bundle declarations',
    ok: true,
    details: `${yamlFiles.length} bundle file(s), ${totalServers} server(s) declared`,
  };
}

async function checkAdaptersCompiled(projectDir) {
  const claudeHooksPath = path.join(projectDir, '.claude', 'hooks.json');
  if (!(await fs.pathExists(claudeHooksPath))) {
    return {
      id: 'adapters_compiled',
      title: 'Adapters compiled',
      ok: false,
      details: '.claude/hooks.json not found',
      remedy: 'Run `hseos agent-core compile --target claude-code` to emit platform adapters.',
    };
  }
  try {
    const raw = await fs.readFile(claudeHooksPath, 'utf8');
    JSON.parse(raw);
    return {
      id: 'adapters_compiled',
      title: 'Adapters compiled',
      ok: true,
      details: '.claude/hooks.json present and valid JSON',
    };
  } catch {
    return {
      id: 'adapters_compiled',
      title: 'Adapters compiled',
      ok: false,
      details: '.claude/hooks.json exists but is not valid JSON',
      remedy: 'Run `hseos agent-core compile --target claude-code` to regenerate.',
    };
  }
}

async function checkGovernanceBaseline(projectDir) {
  const constitutionDir = path.join(projectDir, '.enterprise', '.specs', 'constitution');
  const decisionsDir = path.join(projectDir, '.enterprise', '.specs', 'decisions');
  const missing = [];
  if (!(await fs.pathExists(constitutionDir))) missing.push('constitution/');
  if (!(await fs.pathExists(decisionsDir))) missing.push('decisions/');
  if (missing.length > 0) {
    return {
      id: 'governance_baseline',
      title: 'Governance baseline',
      ok: false,
      details: `Missing governance paths: ${missing.join(', ')}`,
      remedy: 'Run `npx hseos install` to scaffold governance directories.',
    };
  }
  const constitutionFiles = await fs.readdir(constitutionDir);
  const adrFiles = (await fs.readdir(decisionsDir)).filter((f) => f.startsWith('ADR-'));
  return {
    id: 'governance_baseline',
    title: 'Governance baseline',
    ok: true,
    details: `${constitutionFiles.length} constitution file(s), ${adrFiles.length} ADR(s)`,
  };
}

async function checkStateTracking(projectDir) {
  const runsDirPath = path.join(projectDir, '.hseos', 'runs');
  const configPath = path.join(projectDir, '.hseos', 'config', 'hseos.config.yaml');
  if (!(await fs.pathExists(configPath))) {
    return {
      id: 'state_tracking',
      title: 'State tracking',
      ok: false,
      details: 'hseos.config.yaml not found',
      remedy: 'Run `npx hseos install` to scaffold the HSEOS config.',
    };
  }
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    yaml.parse(raw);
  } catch (error) {
    return {
      id: 'state_tracking',
      title: 'State tracking',
      ok: false,
      details: `hseos.config.yaml parse error: ${error.message}`,
      remedy: 'Fix the YAML syntax in hseos.config.yaml.',
    };
  }
  const runsExist = await fs.pathExists(runsDirPath);
  return {
    id: 'state_tracking',
    title: 'State tracking',
    ok: true,
    details: `hseos.config.yaml valid; runs dir ${runsExist ? 'present' : 'absent (will be created on first run)'}`,
  };
}

async function runDoctor(projectDir, options = {}) {
  const checks = await Promise.all([
    checkRepoStructure(projectDir),
    checkManifestIntegrity(projectDir),
    checkSkillsConsistency(projectDir),
    checkHooksReachable(projectDir),
    checkMcpBundles(projectDir),
    checkAdaptersCompiled(projectDir),
    checkGovernanceBaseline(projectDir),
    checkStateTracking(projectDir),
  ]);

  const failed = checks.filter((c) => !c.ok);
  const errors = failed.filter((c) => !c.remedy).map((c) => c.details);
  const warnings = failed.filter((c) => c.remedy).map((c) => `${c.title}: ${c.remedy}`);

  return {
    ok: failed.length === 0,
    quick: Boolean(options.quick),
    checks,
    warnings,
    errors,
  };
}

module.exports = { runDoctor };
