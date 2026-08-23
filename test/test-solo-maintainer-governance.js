'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('yaml');

const ROOT = path.join(__dirname, '..');
const POLICY_SURFACES = [
  'AGENTS.md',
  '.enterprise/governance/execution-governance.md',
  '.github/pull_request_template.md',
  '.enterprise/governance/agent-skills/dev-squad/SKILL.md',
  '.enterprise/governance/agent-skills/dev-squad/SKILL-QUICK.md',
  '.enterprise/governance/agent-skills/release-control/SKILL.md',
  '.enterprise/governance/agent-skills/inter-agent-comms/SKILL.md',
  '.agents/skills/dev-squad/SKILL.md',
  '.agents/skills/release-control/SKILL.md',
  '.agents/skills/inter-agent-comms/SKILL.md',
  'docs/workflows.md',
  'docs/pt-br/workflows.md',
  'docs/agents/swarm.md',
  'docs/COMPILER-V2-ROLLOUT.md',
  'docs/troubleshooting.md',
];

const forbiddenReviewRequirements = [
  /Require PR with at least 1 human approval/i,
  /Human review\/approval is mandatory/i,
  /Human reviewer only/i,
  /human reviewer merges/i,
  /reviewer approves and merges/i,
  /Human reviewer approves/i,
  /Human reviewer or governed closeout operator/i,
  /at least one reviewer/i,
  /approval \(PR review\)/i,
];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

const protection = yaml.parse(read('.github/branch-protection.yaml')).branches.find(({ name }) => name === 'master').protection;
assert.equal(protection.required_pull_request_reviews, null, 'master must not require an approving review');
assert.equal(protection.required_status_checks.strict, true, 'strict required checks must remain enabled');
assert.equal(protection.enforce_admins, true, 'required checks must continue to apply to the owner');

for (const relativePath of POLICY_SURFACES) {
  const content = read(relativePath);
  for (const pattern of forbiddenReviewRequirements) {
    assert.doesNotMatch(content, pattern, `${relativePath} reintroduces a separate review requirement`);
  }
}

const governance = read('.enterprise/governance/execution-governance.md');
assert.match(governance, /required_pull_request_reviews: null/);
assert.match(governance, /Explicit repository-owner authorization is mandatory/);
assert.match(governance, /separate reviewer or approving review is not required/);

const template = read('.github/pull_request_template.md');
assert.match(template, /Owner Merge Authorization Checklist/);
assert.match(template, /separate approving review is not required/);

const hookifySource = '.enterprise/governance/plugins/definitions/hseos-hookify/hooks/handlers/hookify-validate.sh';
const hookifyCompiled = '.agents/plugins/definitions/hseos-hookify/hooks/handlers/hookify-validate.sh';
assert.notEqual(fs.statSync(path.join(ROOT, hookifySource)).mode & 0o111, 0, 'canonical hookify handler must be executable');
assert.notEqual(fs.statSync(path.join(ROOT, hookifyCompiled)).mode & 0o111, 0, 'compiled hookify handler must be executable');

const marketplace = JSON.parse(read('.claude-plugin/marketplace.json'));
assert.equal(marketplace.schema_version, '2.0', 'generated marketplace must match the canonical plugin schema');

console.log(`Solo-maintainer governance: ${POLICY_SURFACES.length} surfaces normalized, required checks preserved`);
