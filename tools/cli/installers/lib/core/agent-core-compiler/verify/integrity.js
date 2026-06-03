'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('fs-extra');
const yaml = require('yaml');

async function fileHash(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Agent hashes are computed by the compiler over CRLF-normalized content
// (see sources/agents-source.js). Verification must normalize identically so a
// clean checkout matches on every platform.
async function agentHash(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return crypto.createHash('sha256').update(content.replaceAll('\r\n', '\n')).digest('hex');
}

async function runIntegrity(projectDir) {
  const manifestPath = path.join(projectDir, '.agents', 'manifest.yaml');
  if (!(await fs.pathExists(manifestPath))) {
    return {
      ok: false,
      checks: [],
      warnings: [],
      errors: [`manifest.yaml not found at ${manifestPath}`],
    };
  }

  const manifestRaw = await fs.readFile(manifestPath, 'utf-8');
  const manifest = yaml.parse(manifestRaw);
  const skills = Array.isArray(manifest && manifest.skills) ? manifest.skills : [];

  const checks = [];
  const errors = [];
  const warnings = [];

  for (const entry of skills) {
    if (!entry || !entry.output || !entry.hash) {
      continue;
    }
    const outputPath = path.join(projectDir, entry.output);
    if (!(await fs.pathExists(outputPath))) {
      checks.push({
        id: `skill:${entry.name}`,
        title: `Skill ${entry.name} integrity`,
        ok: false,
        details: `output file missing: ${entry.output}`,
        remedy: 'Run `hseos agent-core compile` to regenerate.',
      });
      errors.push(`Missing skill output: ${entry.output}`);
      continue;
    }
    const observed = await fileHash(outputPath);
    if (observed !== entry.hash) {
      checks.push({
        id: `skill:${entry.name}`,
        title: `Skill ${entry.name} integrity`,
        ok: false,
        details: `hash mismatch: expected ${entry.hash.slice(0, 12)}…, observed ${observed.slice(0, 12)}…`,
        remedy: 'Run `hseos agent-core compile` to refresh hashes, or `hseos agent-core audit` to inspect drift.',
      });
      errors.push(`Drift on ${entry.output}`);
      continue;
    }
    checks.push({
      id: `skill:${entry.name}`,
      title: `Skill ${entry.name} integrity`,
      ok: true,
    });
  }

  // Agent catalog integrity (manifest `agents[]`, additive). Entries without a
  // sha256 are skipped; present hashes are verified so an agent definition
  // edited without recompiling is caught the same way skill drift is.
  const agents = Array.isArray(manifest && manifest.agents) ? manifest.agents : [];
  for (const entry of agents) {
    if (!entry || !entry.file || !entry.sha256) {
      continue;
    }
    const label = entry.code || entry.file;
    const agentPath = path.join(projectDir, entry.file);
    if (!(await fs.pathExists(agentPath))) {
      checks.push({
        id: `agent:${label}`,
        title: `Agent ${label} integrity`,
        ok: false,
        details: `agent file missing: ${entry.file}`,
        remedy: 'Run `hseos agent-core compile` to regenerate.',
      });
      errors.push(`Missing agent file: ${entry.file}`);
      continue;
    }
    const observed = await agentHash(agentPath);
    if (observed !== entry.sha256) {
      checks.push({
        id: `agent:${label}`,
        title: `Agent ${label} integrity`,
        ok: false,
        details: `hash mismatch: expected ${entry.sha256.slice(0, 12)}…, observed ${observed.slice(0, 12)}…`,
        remedy: 'Run `hseos agent-core compile` to refresh hashes, or `hseos agent-core audit` to inspect drift.',
      });
      errors.push(`Drift on ${entry.file}`);
      continue;
    }
    checks.push({
      id: `agent:${label}`,
      title: `Agent ${label} integrity`,
      ok: true,
    });
  }

  // Per-asset signatures under .agents/.signatures/ and adapters[].sha256 remain
  // Wave 6 (ADR-0007). Plugins and MCP servers carry no content hash today, so
  // they are catalog-only entries (registered, not integrity-checked).

  return {
    ok: errors.length === 0,
    checks,
    warnings,
    errors,
  };
}

module.exports = { runIntegrity };
