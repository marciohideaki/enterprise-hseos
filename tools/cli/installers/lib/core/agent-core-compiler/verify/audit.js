'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('fs-extra');
const yaml = require('yaml');
const { runIntegrity } = require('./integrity');

async function fileHash(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
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

  const activeHooks = (Array.isArray(registry.hooks) ? registry.hooks : []).filter(
    (h) => !h.status || h.status === 'active',
  );

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
        details: ok
          ? `hash matches`
          : `hash mismatch: signed ${hash.slice(0, 12)}…, observed ${observed.slice(0, 12)}…`,
        remedy: ok ? undefined : 'Run `hseos agent-core compile` to refresh, or investigate manual edits.',
      });
    }
  }

  return checks;
}

async function runAudit(projectDir) {
  const integrity = await runIntegrity(projectDir);
  const integrityChecks = integrity.checks.map((c) => ({ ...c, source: 'integrity' }));

  const [adapterDrift, signatureDrift] = await Promise.all([
    checkAdapterDrift(projectDir),
    checkSignatureDrift(projectDir),
  ]);

  const checks = [...integrityChecks, ...adapterDrift, ...signatureDrift];
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
