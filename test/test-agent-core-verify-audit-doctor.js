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
  fs.writeFileSync(
    path.join(hooksDir, 'registry.yaml'),
    yaml.stringify({ version: '1.1', hooks: [] }),
  );

  const manifest = { version: '2.0', skills: [] };
  fs.writeFileSync(path.join(agentsDir, 'manifest.yaml'), yaml.stringify(manifest));
}

async function testIntegrityNoManifest() {
  await withTempDir(async (dir) => {
    const result = await runIntegrity(dir);
    assertPass(
      'integrity returns ok:false when manifest missing',
      !result.ok && result.errors.length > 0,
      JSON.stringify(result.errors),
    );
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

async function testAuditAdapterDrift() {
  await withTempDir(async (dir) => {
    const agentsDir = path.join(dir, '.agents');
    const hooksDir = path.join(agentsDir, 'hooks');
    const claudeDir = path.join(dir, '.claude');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.mkdirSync(claudeDir, { recursive: true });

    fs.writeFileSync(
      path.join(agentsDir, 'manifest.yaml'),
      yaml.stringify({ version: '2.0', skills: [] }),
    );

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
    assertPass(
      'audit detects adapter drift for missing hook',
      Boolean(driftCheck && !driftCheck.ok),
      JSON.stringify(driftCheck),
    );

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
    assertPass(
      'audit reports no drift when hook is present',
      Boolean(cleanCheck && cleanCheck.ok),
      JSON.stringify(cleanCheck),
    );
  });
}

async function testDoctorFullProject() {
  await withTempDir(async (dir) => {
    scaffoldMinimalProject(dir);
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'hooks.json'), JSON.stringify({ hooks: {} }));

    const result = await runDoctor(dir);
    assertPass(
      'doctor passes on minimal valid project',
      result.ok,
      JSON.stringify(result.checks.filter((c) => !c.ok)),
    );
    assertPass('doctor runs all 8 checks', result.checks.length === 8, String(result.checks.length));
  });
}

async function testDoctorMissingPaths() {
  await withTempDir(async (dir) => {
    const result = await runDoctor(dir);
    const repoCheck = result.checks.find((c) => c.id === 'repo_structure');
    assertPass(
      'doctor repo_structure fails on empty dir',
      Boolean(repoCheck && !repoCheck.ok),
      JSON.stringify(repoCheck),
    );
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

async function run() {
  console.log('Agent core verify / audit / doctor tests');

  await testIntegrityNoManifest();
  await testIntegrityEmptyManifest();
  await testIntegrityDetectsDrift();
  await testAuditAdapterDrift();
  await testDoctorFullProject();
  await testDoctorMissingPaths();
  await testDoctorSkillsConsistency();

  console.log(`\nVerify/audit/doctor tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
