'use strict';

const path = require('node:path');
const fs = require('fs-extra');

async function writeInstructions(root, agentsDirName) {
  const instructionsDir = path.join(root, agentsDirName, 'instructions');
  await fs.ensureDir(instructionsDir);

  const content = `# HSEOS Agent Core

This directory is the vendor-neutral source for HSEOS agent behavior.

## Instruction Cascade

1. Enterprise constitution: \`.enterprise/.specs/constitution/Enterprise-Constitution.md\`
2. Project-neutral agent rules: this file and \`${agentsDirName}/manifest.yaml\`
3. Tool adapter: \`AGENTS.md\`, \`CLAUDE.md\`, or another platform entrypoint
4. Agent authority: \`.enterprise/agents/<code>/authority.md\`
5. Triggered skill: \`${agentsDirName}/skills/<skill>/SKILL.md\`
6. User instruction in the active conversation

If two instructions conflict, stop and ask for a human decision. Do not average standards.

## Operating Rules

- Load only the minimum matching skills for the task.
- Prefer \`${agentsDirName}/skills\` for portable skills; use \`.enterprise/governance/agent-skills\` as the governance source.
- Treat non-\`hseos-*\` skills as governance/check modules and \`hseos-*\` skills as executable agent, task, or workflow launchers. Do not activate both for the same request unless the user explicitly asks for a workflow plus its governance review.
- Treat \`${agentsDirName}/hooks/registry.yaml\` as the neutral hook registry. Platform-specific hook files are compiled adapters.
- Never commit directly to \`main\`, \`master\`, or \`develop\`.
- Never merge PRs without explicit human approval; after approval, use governed closeout when available.
- Never delete protected branches. \`task/*\` cleanup belongs to the worktree lifecycle; merged \`feature/*\` cleanup must verify containment in the base branch.
- Stacked \`feature/*\` branch chains are allowed only for real dependency sequencing; each link must declare its upstream base, use \`task/*\` worktrees for commits, and merge from base to tip.
- Never add AI attribution or co-author trailers to commits.
- Run repository quality gates before any commit.

## Platform-First Capability Intake

- Before implementing shared, platform, cross-cutting, provider, partner, client, contract, schema, request/response, or error-catalog concerns, query the versioned capability graph with \`node scripts/governance/validate-capability-graph.js --query <id-or-term>\`.
- Prefer consuming an existing contract and versioned package. If needed, extend only through its declared extension point. Promote genuinely new shared needs through the governed capability-intake flow.
- Never create a parallel local implementation without an approved, expiring exception.
- Treat semantic search, FalkorDB, Qdrant, dashboards, and generated catalogs as advisory projections. Git-hosted graph fragments are authoritative and semantic findings require human review before canonical promotion.
- Governing sources: Enterprise Constitution §2.6, \`.enterprise/.specs/core/Platform Capability Governance Standard.md\`, \`.enterprise/policies/capability-graph.md\`, and ADR-0022.

## Platform Adapters

- Codex reads \`AGENTS.md\` and discovers skills under \`${agentsDirName}/skills\`.
- Claude Code reads \`CLAUDE.md\`, \`.claude/commands\`, and \`.claude/hooks.json\`.
- Command-only tools receive generated command files from the same HSEOS artifacts.
`;

  await fs.writeFile(path.join(instructionsDir, 'PROJECT.md'), content, 'utf8');
}

module.exports = { writeInstructions };
