/**
 * Agent Core verify / audit / doctor tests
 *
 * Validates that the three self-verification CLI commands produce correct
 * results against a synthetic project directory.
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const yaml = require('yaml');
const { runIntegrity } = require('../tools/cli/installers/lib/core/agent-core-compiler/verify/integrity');
const { runAudit } = require('../tools/cli/installers/lib/core/agent-core-compiler/verify/audit');
const { runDoctor } = require('../tools/cli/installers/lib/core/agent-core-compiler/verify/doctor');

let passed = 0;
let failed = 0;

function assertPass(label, condition, details = '') {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}${details ? ` — ${details}` : ''}`);
    failed++;
  }
}

async function withTempDir(fn) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-verify-test-'));
  try {
    return await fn(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function scaffoldMinimalProject(dir) {
  const agentsDir = path.join(dir, '.agents');
  const hseosDir = path.join(dir, '.hseos');
  const enterpriseDir = path.join(dir, '.enterprise', '.specs', 'constitution');
  const hooksDir = path.join(agentsDir, 'hooks');
  const skillsDir = path.join(agentsDir, 'skills');
  const configDir = path.join(hseosDir, 'config');

  fs.mkdirSync(agentsDir, { recursive: true });
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.mkdirSync(enterpriseDir, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(path.join(dir, '.enterprise', '.specs', 'decisions'), { recursive: true });
  fs.mkdirSync(path.join(agentsDir, 'instructions'), { recursive: true });

  fs.writeFileSync(path.join(agentsDir, 'instructions', 'PROJECT.md'), '# PROJECT');
  fs.writeFileSync(path.join(enterpriseDir, 'Constitution.md'), '# Constitution');
  fs.writeFileSync(path.join(configDir, 'hseos.config.yaml'), yaml.stringify({ version: '2.0' }));
  fs.writeFileSync(path.join(hooksDir, 'registry.yaml'), yaml.stringify({ version: '1.1', hooks: [] }));

  const manifest = { version: '2.0', skills: [] };
  fs.writeFileSync(path.join(agentsDir, 'manifest.yaml'), yaml.stringify(manifest));
}

async function testIntegrityNoManifest() {
  await withTempDir(async (dir) => {
    const result = await runIntegrity(dir);
    assertPass('integrity returns ok:false when manifest missing', !result.ok && result.errors.length > 0, JSON.stringify(result.errors));
  });
}

async function testIntegrityEmptyManifest() {
  await withTempDir(async (dir) => {
    fs.mkdirSync(path.join(dir, '.agents'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.agents', 'manifest.yaml'), yaml.stringify({ version: '2.0', skills: [] }));
    const result = await runIntegrity(dir);
    assertPass('integrity ok with empty skills list', result.ok, JSON.stringify(result));
    assertPass('integrity has zero checks for empty skills', result.checks.length === 0, String(result.checks.length));
  });
}

async function testIntegrityDetectsDrift() {
  await withTempDir(async (dir) => {
    const agentsDir = path.join(dir, '.agents');
    const skillsDir = path.join(agentsDir, 'skills', 'my-skill');
    fs.mkdirSync(skillsDir, { recursive: true });
    const outputPath = '.agents/skills/my-skill/SKILL.md';
    const content = '# My Skill';
    fs.writeFileSync(path.join(dir, outputPath), content);
    const hash = crypto.createHash('sha256').update(content).digest('hex');

    fs.writeFileSync(
      path.join(agentsDir, 'manifest.yaml'),
      yaml.stringify({ version: '2.0', skills: [{ name: 'my-skill', output: outputPath, hash }] }),
    );

    const resultClean = await runIntegrity(dir);
    assertPass('integrity ok when hash matches', resultClean.ok, JSON.stringify(resultClean.errors));

    fs.writeFileSync(path.join(dir, outputPath), '# Modified content');
    const resultDirty = await runIntegrity(dir);
    assertPass('integrity detects hash mismatch', !resultDirty.ok, JSON.stringify(resultDirty.checks));
  });
}

async function testIntegrityVerifiesAgents() {
  await withTempDir(async (dir) => {
    const agentFile = '.hseos/agents/swarm.agent.yaml';
    const full = path.join(dir, agentFile);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const content = 'agent:\n  metadata:\n    code: SWARM\n';
    fs.writeFileSync(full, content);
    const sha256 = crypto.createHash('sha256').update(content.replaceAll('\r\n', '\n')).digest('hex');

    fs.mkdirSync(path.join(dir, '.agents'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.agents', 'manifest.yaml'),
      yaml.stringify({ version: '1.0', skills: [], agents: [{ code: 'SWARM', file: agentFile, sha256 }] }),
    );

    const clean = await runIntegrity(dir);
    assertPass('integrity ok when agent hash matches', clean.ok, JSON.stringify(clean.errors));
    assertPass(
      'integrity emits a check for the agent',
      clean.checks.some((c) => c.id === 'agent:SWARM' && c.ok),
      JSON.stringify(clean.checks),
    );

    fs.writeFileSync(full, content + '# drift\n');
    const dirty = await runIntegrity(dir);
    assertPass('integrity detects agent drift', !dirty.ok && dirty.errors.length > 0, JSON.stringify(dirty.checks));
  });
}

async function testAuditAdapterDrift() {
  await withTempDir(async (dir) => {
    const agentsDir = path.join(dir, '.agents');
    const hooksDir = path.join(agentsDir, 'hooks');
    const claudeDir = path.join(dir, '.claude');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.mkdirSync(claudeDir, { recursive: true });

    fs.writeFileSync(path.join(agentsDir, 'manifest.yaml'), yaml.stringify({ version: '2.0', skills: [] }));

    const cmd = 'bash .agents/hooks/handlers/plan-lint.sh "$CLAUDE_TOOL_FILE_PATH"';
    fs.writeFileSync(
      path.join(hooksDir, 'registry.yaml'),
      yaml.stringify({
        version: '1.1',
        hooks: [
          {
            id: 'plan-lint',
            event: 'PostToolUse',
            matcher: 'Write|Edit',
            type: 'command',
            command: cmd,
            blocking: false,
            status: 'active',
            platform_support: ['claude-code'],
          },
        ],
      }),
    );

    // Emit hooks.json WITHOUT the plan-lint hook to simulate drift
    fs.writeFileSync(path.join(claudeDir, 'hooks.json'), JSON.stringify({ hooks: {} }));

    const resultDrift = await runAudit(dir);
    const driftCheck = resultDrift.checks.find((c) => c.id && c.id.includes('plan-lint'));
    assertPass('audit detects adapter drift for missing hook', Boolean(driftCheck && !driftCheck.ok), JSON.stringify(driftCheck));

    // Now emit hooks.json WITH the plan-lint hook
    fs.writeFileSync(
      path.join(claudeDir, 'hooks.json'),
      JSON.stringify({
        hooks: {
          PostToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: cmd }] }],
        },
      }),
    );

    const resultClean = await runAudit(dir);
    const cleanCheck = resultClean.checks.find((c) => c.id && c.id.includes('plan-lint'));
    assertPass('audit reports no drift when hook is present', Boolean(cleanCheck && cleanCheck.ok), JSON.stringify(cleanCheck));
  });
}

async function testDoctorFullProject() {
  await withTempDir(async (dir) => {
    scaffoldMinimalProject(dir);
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'hooks.json'), JSON.stringify({ hooks: {} }));

    const result = await runDoctor(dir);
    assertPass('doctor passes on minimal valid project', result.ok, JSON.stringify(result.checks.filter((c) => !c.ok)));
    assertPass('doctor runs all 9 checks', result.checks.length === 9, String(result.checks.length));
    assertPass(
      'doctor includes optional sandbox runtime check',
      result.checks.some((c) => c.id === 'sandbox_runtime' && c.ok),
      JSON.stringify(result.checks),
    );
  });
}

async function testDoctorMissingPaths() {
  await withTempDir(async (dir) => {
    const result = await runDoctor(dir);
    const repoCheck = result.checks.find((c) => c.id === 'repo_structure');
    assertPass('doctor repo_structure fails on empty dir', Boolean(repoCheck && !repoCheck.ok), JSON.stringify(repoCheck));
    assertPass('doctor overall fails when structure missing', !result.ok);
  });
}

async function testDoctorSkillsConsistency() {
  await withTempDir(async (dir) => {
    scaffoldMinimalProject(dir);
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'hooks.json'), JSON.stringify({ hooks: {} }));

    // Add a skill dir WITHOUT SKILL.md
    const brokenSkillDir = path.join(dir, '.agents', 'skills', 'broken-skill');
    fs.mkdirSync(brokenSkillDir, { recursive: true });

    const result = await runDoctor(dir);
    const skillsCheck = result.checks.find((c) => c.id === 'skills_consistency');
    assertPass(
      'doctor skills_consistency fails when SKILL.md missing',
      Boolean(skillsCheck && !skillsCheck.ok),
      JSON.stringify(skillsCheck),
    );
  });
}

async function testDoctorResolvesGitRootHookScripts() {
  await withTempDir(async (dir) => {
    scaffoldMinimalProject(dir);
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'scripts', 'governance'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'hooks.json'), JSON.stringify({ hooks: {} }));
    fs.writeFileSync(path.join(dir, 'scripts', 'governance', 'state-emit-hook.sh'), '#!/bin/bash\n');
    fs.writeFileSync(
      path.join(dir, '.agents', 'hooks', 'registry.yaml'),
      yaml.stringify({
        version: '1.1',
        hooks: [
          {
            id: 'state-emit',
            event: 'PostToolUse',
            matcher: '*',
            type: 'command',
            command:
              'CLAUDE_HOOK_EVENT=PostToolUse bash $(git rev-parse --show-toplevel 2>/dev/null)/scripts/governance/state-emit-hook.sh PostToolUse "$CLAUDE_TOOL_NAME" 2>/dev/null || true',
            status: 'active',
          },
        ],
      }),
    );

    const result = await runDoctor(dir);
    const hooksCheck = result.checks.find((c) => c.id === 'hooks_reachable');
    assertPass(
      'doctor resolves hook scripts prefixed by git root command substitution',
      Boolean(hooksCheck && hooksCheck.ok),
      JSON.stringify(hooksCheck),
    );
  });
}

async function testAuditTriangularVerdicts() {
  const { AgentCoreCompiler } = require('../tools/cli/installers/lib/core/agent-core-compiler');
  await withTempDir(async (tempDir) => {
    // Give the target its own .enterprise skill source so triangulation has a
    // local third point (installed-without-source projects use the fallback).
    const repoRfc = path.join(__dirname, '..', '.enterprise', 'governance', 'agent-skills', 'rfc');
    const targetRfc = path.join(tempDir, '.enterprise', 'governance', 'agent-skills', 'rfc');
    fs.mkdirSync(targetRfc, { recursive: true });
    for (const f of ['SKILL.md', 'SKILL-QUICK.md']) {
      fs.copyFileSync(path.join(repoRfc, f), path.join(targetRfc, f));
    }

    const compiler = new AgentCoreCompiler();
    await compiler.compile(tempDir, path.join(tempDir, '.hseos'), { platforms: [] });

    const findRfc = (result) => result.checks.find((c) => c.id === 'drift:skill:rfc');

    const clean = await runAudit(tempDir);
    assertPass('triangular: clean compile reports in-sync verdict', findRfc(clean)?.ok === true, JSON.stringify(findRfc(clean)));

    // Tamper the COMPILED output → verdict must blame the output, not the source
    const outputPath = path.join(tempDir, '.agents', 'skills', 'rfc', 'SKILL.md');
    fs.appendFileSync(outputPath, '\n<!-- tampered -->\n');
    const tampered = await runAudit(tempDir);
    assertPass(
      'triangular: hand-edited output verdict',
      findRfc(tampered)?.ok === false && /hand-edited/.test(findRfc(tampered)?.details || ''),
      JSON.stringify(findRfc(tampered)),
    );

    // Restore output, then edit the SOURCE → verdict must blame the source
    await compiler.compile(tempDir, path.join(tempDir, '.hseos'), { platforms: [] });
    const sourcePath = path.join(tempDir, '.enterprise', 'governance', 'agent-skills', 'rfc', 'SKILL.md');
    if (fs.existsSync(sourcePath)) {
      fs.appendFileSync(sourcePath, '\n<!-- source change -->\n');
      const sourceEdited = await runAudit(tempDir);
      assertPass(
        'triangular: source-edited verdict',
        findRfc(sourceEdited)?.ok === false && /source edited/.test(findRfc(sourceEdited)?.details || ''),
        JSON.stringify(findRfc(sourceEdited)),
      );
    } else {
      // Compile resolved skills from the repo sourceRoot — target has no local
      // .enterprise copy, so triangulation degrades to the two-point fallback.
      const fallback = await runAudit(tempDir);
      assertPass(
        'triangular: source-unavailable fallback stays in sync',
        findRfc(fallback)?.ok === true && /source unavailable/.test(findRfc(fallback)?.details || ''),
        JSON.stringify(findRfc(fallback)),
      );
    }
  });
}

async function run() {
  console.log('Agent core verify / audit / doctor tests');

  await testIntegrityNoManifest();
  await testIntegrityEmptyManifest();
  await testIntegrityDetectsDrift();
  await testIntegrityVerifiesAgents();
  await testAuditAdapterDrift();
  await testAuditTriangularVerdicts();
  await testDoctorFullProject();
  await testDoctorMissingPaths();
  await testDoctorSkillsConsistency();
  await testDoctorResolvesGitRootHookScripts();

  console.log(`\nVerify/audit/doctor tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
