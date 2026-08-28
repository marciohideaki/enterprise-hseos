'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadWorkflowCatalog } = require('../../cli/lib/workflow-catalog');

// lib/ → mcp-hseos-governance/ → tools/ → worktree root
const REPO_ROOT = path.join(__dirname, '..', '..', '..');

const cache = new Map();

function read(filePath) {
  if (cache.has(filePath)) return cache.get(filePath);
  const text = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  cache.set(filePath, text);
  return text;
}

function readConstitution(article) {
  const dir = path.join(REPO_ROOT, '.enterprise', '.specs', 'constitution');
  if (!fs.existsSync(dir)) return { article, text: null, path: dir, error: 'constitution dir not found' };
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  if (!article) {
    const texts = files.map((f) => ({ file: f, text: read(path.join(dir, f)) }));
    return { article: 'all', files: texts, path: dir };
  }
  const match = files.find((f) => f.toLowerCase().includes(article.toLowerCase()));
  if (!match) return { article, text: null, path: dir, error: `no constitution file matching: ${article}` };
  const filePath = path.join(dir, match);
  return { article, text: read(filePath), path: filePath };
}

function listAdrs() {
  const dir = path.join(REPO_ROOT, '.enterprise', '.specs', 'decisions');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('ADR-') && f.endsWith('.md'))
    .sort()
    .map((f) => {
      const filePath = path.join(dir, f);
      const text = read(filePath) || '';
      const titleMatch = text.match(/^#\s+(.+)/m);
      const statusMatch = text.match(/\*\*Status[:\s]+([^\n*]+)/i);
      return {
        id: f.replace('.md', ''),
        title: titleMatch ? titleMatch[1].trim() : f,
        status: statusMatch ? statusMatch[1].trim() : 'unknown',
        path: filePath,
      };
    });
}

function readAuthority(agentCode) {
  const code = agentCode.toLowerCase();
  const dir = path.join(REPO_ROOT, '.enterprise', 'agents', code);
  if (!fs.existsSync(dir)) {
    return { agent_code: agentCode, authority: null, error: `agent dir not found: ${code}` };
  }
  const authorityPath = path.join(dir, 'authority.md');
  const constraintsPath = path.join(dir, 'constraints.md');
  return {
    agent_code: agentCode,
    authority: read(authorityPath),
    constraints: read(constraintsPath),
    path: dir,
  };
}

function listSkills(filter, tier) {
  const registryPath = path.join(REPO_ROOT, '.enterprise', 'governance', 'agent-skills', 'SKILLS-REGISTRY.md');
  const text = read(registryPath);
  if (!text) return { skills: [], error: 'SKILLS-REGISTRY.md not found' };

  const skills = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const m = line.match(/^\|\s*`([^`]+)`\s*\|\s*([^|]+)\|\s*(\d)\s*\|/);
    if (!m) continue;
    const [, id, description, tierNum] = m;
    const skillTier = parseInt(tierNum, 10);
    if (tier !== undefined && skillTier !== tier) continue;
    if (filter && !id.includes(filter) && !description.toLowerCase().includes(filter.toLowerCase())) continue;
    skills.push({ id: id.trim(), description: description.trim(), tier: skillTier });
  }
  return { skills, total: skills.length };
}

function listWorkflows(profile) {
  const keyword = typeof profile === 'string' ? profile.trim().toLowerCase() : '';
  const workflows = loadWorkflowCatalog(REPO_ROOT)
    .filter(
      (workflow) =>
        !keyword ||
        workflow.profiles.some((candidate) => candidate.toLowerCase() === keyword) ||
        workflow.owner.toLowerCase().includes(keyword) ||
        workflow.id.toLowerCase().includes(keyword),
    )
    .map((workflow) => ({
      id: workflow.id,
      kind: workflow.kind,
      owner: workflow.owner,
      profiles: workflow.profiles,
      phases: (workflow.phases || []).map((phase) => phase.id),
    }));
  return { workflows, total: workflows.length };
}

module.exports = { readConstitution, listAdrs, readAuthority, listSkills, listWorkflows };
