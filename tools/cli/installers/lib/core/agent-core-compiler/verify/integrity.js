'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('fs-extra');
const yaml = require('yaml');

async function fileHash(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
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

  // v2 manifests will additionally carry adapters[].sha256 and per-asset
  // signatures under .agents/.signatures/. Those branches are pending
  // Wave 6 implementation; this skeleton only walks the v1 skill array
  // so today's manifest passes through cleanly.

  return {
    ok: errors.length === 0,
    checks,
    warnings,
    errors,
  };
}

module.exports = { runIntegrity };
