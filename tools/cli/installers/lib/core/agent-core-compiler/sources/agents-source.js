'use strict';

/**
 * Agents source (per ADR-0007 module layout).
 *
 * Discovers HSEOS agent definitions and returns a catalog for the manifest's
 * `agents[]` field (+ `counts.agents`). This is the v1-compatible first step of
 * the v2.0 agents catalog: it registers `{code, file, sha256}` per agent so the
 * manifest reflects the installed agent set. Rendering agents as adapter-specific
 * subagents (the `rendered` map) and agent-hash verification remain Wave 6 scope.
 *
 * Discovery is project-local only: the runtime peer squad lives in
 * `.hseos/agents` and the core executor (hseos-master) in `src/core/agents`.
 * Projects that store agents in another form (e.g. compiled slash commands)
 * simply yield no matches — the manifest then omits the agents catalog, which
 * keeps pre-existing v1.0 behaviour intact (no cross-layout inconsistency).
 */

const path = require('node:path');
const fs = require('fs-extra');
const yaml = require('yaml');
const { hash } = require('../lib/hash');
const { slug } = require('../lib/slug');

const AGENT_SUFFIX = '.agent.yaml';
const AGENT_DIRS = [path.join('.hseos', 'agents'), path.join('src', 'core', 'agents')];

async function findAgentFiles(dir) {
  const results = [];
  if (!(await fs.pathExists(dir))) return results;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findAgentFiles(full)));
    } else if (entry.name.endsWith(AGENT_SUFFIX)) {
      results.push(full);
    }
  }
  return results;
}

function agentCode(parsed, file) {
  const code = parsed && parsed.agent && parsed.agent.metadata && parsed.agent.metadata.code;
  if (code) return String(code).toUpperCase();
  // hseos-master and other core agents carry no `code` — derive a stable one.
  return slug(path.basename(file, AGENT_SUFFIX)).toUpperCase();
}

async function collectAgents(root) {
  const files = [];
  for (const rel of AGENT_DIRS) {
    files.push(...(await findAgentFiles(path.join(root, rel))));
  }

  const byCode = new Map();
  for (const file of files) {
    let content;
    let parsed;
    try {
      content = await fs.readFile(file, 'utf8');
      parsed = yaml.parse(content);
    } catch {
      continue; // skip unreadable / malformed agent definitions
    }
    const code = agentCode(parsed, file);
    if (byCode.has(code)) continue; // first definition wins
    byCode.set(code, {
      code,
      file: path.relative(root, file).replaceAll(path.sep, '/'),
      sha256: hash(content.replaceAll('\r\n', '\n')),
    });
  }

  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

module.exports = { collectAgents };
