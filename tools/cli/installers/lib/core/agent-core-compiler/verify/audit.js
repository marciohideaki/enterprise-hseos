'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('fs-extra');
const yaml = require('yaml');
const { normalizeSkill } = require('../sources/skills-source');

async function fileHash(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function contentHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function normalizedFileHash(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return contentHash(content.replaceAll('\r\n', '\n'));
}

// Triangular verdict: given the three hash points (fresh recompute from the
// .enterprise source, the compiled output on disk, and the manifest pin),
// name WHICH side moved and the specific remedy — this is what separates
// `audit` (explain the drift) from `verify` (detect the drift).
function triangulate(fresh, compiled, manifestPin) {
  if (compiled === manifestPin && fresh === manifestPin) {
    return { ok: true, verdict: 'in sync' };
  }
  if (compiled === manifestPin && fresh !== manifestPin) {
    return {
      ok: false,
      verdict: 'source edited since last compile',
      remedy: 'Run `hseos agent-core compile` to propagate the .enterprise source change into .agents/ and the manifest.',
    };
  }
  if (fresh === manifestPin && compiled !== manifestPin) {
    return {
      ok: false,
      verdict: 'compiled output hand-edited',
      remedy:
        'Discard the hand edit by running `hseos agent-core compile` — the .enterprise source is authoritative; port the change there if it was intentional.',
    };
  }
  if (fresh === compiled && compiled !== manifestPin) {
    return {
      ok: false,
      verdict: 'manifest stale (source and output agree)',
      remedy: 'Run `hseos agent-core compile` to refresh the manifest pin.',
    };
  }
  return {
    ok: false,
    verdict: 'source AND compiled output diverged independently since the manifest pin',
    remedy: 'Reconcile manually: port intentional output edits into the .enterprise source, then run `hseos agent-core compile`.',
  };
}

async function checkTriangularDrift(projectDir) {
  const manifestPath = path.join(projectDir, '.agents', 'manifest.yaml');
  if (!(await fs.pathExists(manifestPath))) return [];

  let manifest;
  try {
    manifest = yaml.parse(await fs.readFile(manifestPath, 'utf8')) || {};
  } catch {
    return [];
  }

  const checks = [];

  // Skills: fresh = re-run of normalizeSkill over the .enterprise source.
  for (const entry of Array.isArray(manifest.skills) ? manifest.skills : []) {
    if (!entry || !entry.output || !entry.hash) continue;

    const outputPath = path.join(projectDir, entry.output);
    const sourcePath = entry.source ? path.join(projectDir, entry.source) : null;
    const quickPath = entry.quick ? path.join(projectDir, entry.quick) : null;

    if (!(await fs.pathExists(outputPath))) {
      checks.push({
        id: `drift:skill:${entry.name}`,
        title: `Skill ${entry.name} drift`,
        source: 'triangular',
        ok: false,
        details: `compiled output missing: ${entry.output}`,
        remedy: 'Run `hseos agent-core compile` to regenerate.',
      });
      continue;
    }
    const compiled = await fileHash(outputPath);

    if (!sourcePath || !(await fs.pathExists(sourcePath))) {
      // Installed projects may not carry the .enterprise source — fall back to
      // the two-point comparison and say so explicitly.
      const ok = compiled === entry.hash;
      checks.push({
        id: `drift:skill:${entry.name}`,
        title: `Skill ${entry.name} drift`,
        source: 'triangular',
        ok,
        details: ok
          ? 'in sync (output↔manifest; source unavailable for triangulation)'
          : 'compiled output differs from manifest (source unavailable — direction unknown)',
        remedy: ok ? undefined : 'Run `hseos agent-core compile` to regenerate from the canonical source.',
      });
      continue;
    }

    const sourceContent = await fs.readFile(sourcePath, 'utf8');
    const quickContent = quickPath && (await fs.pathExists(quickPath)) ? await fs.readFile(quickPath, 'utf8') : '';
    const fresh = contentHash(
      normalizeSkill(sourceContent, quickContent, {
        name: entry.name,
        sourcePath: entry.source,
        quickPath: entry.quick || null,
      }).content,
    );

    const verdict = triangulate(fresh, compiled, entry.hash);
    checks.push({
      id: `drift:skill:${entry.name}`,
      title: `Skill ${entry.name} drift`,
      source: 'triangular',
      ok: verdict.ok,
      details: verdict.verdict,
      remedy: verdict.remedy,
    });
  }

  // Handlers: fresh = CRLF-normalized .enterprise source; compiled = normalized output.
  for (const entry of Array.isArray(manifest.handlers) ? manifest.handlers : []) {
    if (!entry || !entry.file || !entry.sha256) continue;
    const label = entry.file.split('/').pop();
    const outputPath = path.join(projectDir, entry.file);
    const sourcePath = entry.source ? path.join(projectDir, entry.source) : null;

    if (!(await fs.pathExists(outputPath))) {
      checks.push({
        id: `drift:handler:${label}`,
        title: `Handler ${label} drift`,
        source: 'triangular',
        ok: false,
        details: `compiled handler missing: ${entry.file}`,
        remedy: 'Run `hseos agent-core compile` to regenerate.',
      });
      continue;
    }
    const compiled = await normalizedFileHash(outputPath);

    if (!sourcePath || !(await fs.pathExists(sourcePath))) {
      const ok = compiled === entry.sha256;
      checks.push({
        id: `drift:handler:${label}`,
        title: `Handler ${label} drift`,
        source: 'triangular',
        ok,
        details: ok
          ? 'in sync (output↔manifest; source unavailable for triangulation)'
          : 'compiled handler differs from manifest (source unavailable — direction unknown)',
        remedy: ok ? undefined : 'Run `hseos agent-core compile` to regenerate from the canonical source.',
      });
      continue;
    }

    const fresh = await normalizedFileHash(sourcePath);
    const verdict = triangulate(fresh, compiled, entry.sha256);
    checks.push({
      id: `drift:handler:${label}`,
      title: `Handler ${label} drift`,
      source: 'triangular',
      ok: verdict.ok,
      details: verdict.verdict,
      remedy: verdict.remedy,
    });
  }

  // Agents: the .agent.yaml IS the source (no transformation), so this is a
  // two-point comparison by construction — say which action fixes it.
  for (const entry of Array.isArray(manifest.agents) ? manifest.agents : []) {
    if (!entry || !entry.file || !entry.sha256) continue;
    const label = entry.code || entry.file;
    const agentPath = path.join(projectDir, entry.file);
    if (!(await fs.pathExists(agentPath))) {
      checks.push({
        id: `drift:agent:${label}`,
        title: `Agent ${label} drift`,
        source: 'triangular',
        ok: false,
        details: `agent definition missing: ${entry.file}`,
        remedy: 'Restore the file or run `hseos agent-core compile` to re-register the catalog.',
      });
      continue;
    }
    const observed = await normalizedFileHash(agentPath);
    const ok = observed === entry.sha256;
    checks.push({
      id: `drift:agent:${label}`,
      title: `Agent ${label} drift`,
      source: 'triangular',
      ok,
      details: ok ? 'in sync' : 'agent definition edited since the manifest pin (the .agent.yaml is itself the source)',
      remedy: ok ? undefined : 'Run `hseos agent-core compile` to refresh the manifest pin.',
    });
  }

  return checks;
}

async function checkAdapterDrift(projectDir) {
  const registryPath = path.join(projectDir, '.agents', 'hooks', 'registry.yaml');
  const claudeHooksPath = path.join(projectDir, '.claude', 'hooks.json');

  if (!(await fs.pathExists(registryPath)) || !(await fs.pathExists(claudeHooksPath))) {
    return [];
  }

  let registry, claudeHooks;
  try {
    registry = yaml.parse(await fs.readFile(registryPath, 'utf8')) || {};
    claudeHooks = JSON.parse(await fs.readFile(claudeHooksPath, 'utf8'));
  } catch {
    return [];
  }

  const activeHooks = (Array.isArray(registry.hooks) ? registry.hooks : []).filter((h) => !h.status || h.status === 'active');

  const claudeHookCommands = new Set();
  const hooksSection = claudeHooks && claudeHooks.hooks ? claudeHooks.hooks : {};
  for (const event of Object.values(hooksSection)) {
    if (!Array.isArray(event)) continue;
    for (const group of event) {
      if (!Array.isArray(group.hooks)) continue;
      for (const h of group.hooks) {
        if (h.command) claudeHookCommands.add(h.command);
      }
    }
  }

  const checks = [];
  for (const hook of activeHooks) {
    if (!hook.command || !hook.platform_support?.includes('claude-code')) continue;
    const emitted = claudeHookCommands.has(hook.command);
    checks.push({
      id: `adapter-drift:claude-code:${hook.id}`,
      title: `Adapter drift — ${hook.id}`,
      source: 'adapter-drift',
      ok: emitted,
      details: emitted
        ? `hook ${hook.id} present in .claude/hooks.json`
        : `hook ${hook.id} active in registry but absent from .claude/hooks.json`,
      remedy: emitted ? undefined : 'Run `hseos agent-core compile --target claude-code` to re-emit.',
    });
  }
  return checks;
}

async function checkSignatureDrift(projectDir) {
  const signaturesDir = path.join(projectDir, '.agents', '.signatures');
  if (!(await fs.pathExists(signaturesDir))) {
    return [];
  }

  const sigFiles = (await fs.readdir(signaturesDir)).filter((f) => f.endsWith('.sha256'));
  const checks = [];

  for (const sigFile of sigFiles) {
    const sigPath = path.join(signaturesDir, sigFile);
    let entries;
    try {
      const raw = await fs.readFile(sigPath, 'utf8');
      entries = raw
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [hash, ...rest] = line.split('  ');
          return { hash, filePath: rest.join('  ') };
        });
    } catch {
      continue;
    }

    for (const { hash, filePath } of entries) {
      if (!filePath) continue;
      const absPath = path.join(projectDir, filePath);
      if (!(await fs.pathExists(absPath))) {
        checks.push({
          id: `signature:${sigFile}:${filePath}`,
          title: `Signature drift — ${filePath}`,
          source: 'signature',
          ok: false,
          details: `signed file missing: ${filePath}`,
          remedy: 'Run `hseos agent-core compile` to regenerate signatures.',
        });
        continue;
      }
      const observed = await fileHash(absPath);
      const ok = observed === hash;
      checks.push({
        id: `signature:${sigFile}:${filePath}`,
        title: `Signature drift — ${filePath}`,
        source: 'signature',
        ok,
        details: ok ? `hash matches` : `hash mismatch: signed ${hash.slice(0, 12)}…, observed ${observed.slice(0, 12)}…`,
        remedy: ok ? undefined : 'Run `hseos agent-core compile` to refresh, or investigate manual edits.',
      });
    }
  }

  return checks;
}

async function runAudit(projectDir) {
  // Unlike `verify` (binary integrity detection), `audit` triangulates every
  // pinned asset against its .enterprise source to explain WHICH side moved.
  const [triangular, adapterDrift, signatureDrift] = await Promise.all([
    checkTriangularDrift(projectDir),
    checkAdapterDrift(projectDir),
    checkSignatureDrift(projectDir),
  ]);

  const checks = [...triangular, ...adapterDrift, ...signatureDrift];
  const failed = checks.filter((c) => !c.ok);
  const errors = failed.filter((c) => !c.remedy).map((c) => c.details);
  const warnings = failed.filter((c) => c.remedy).map((c) => `${c.title}: ${c.remedy}`);

  return {
    ok: failed.length === 0,
    checks,
    warnings,
    errors,
  };
}

module.exports = { runAudit };
