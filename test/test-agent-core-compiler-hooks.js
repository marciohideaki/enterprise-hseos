/**
 * Agent Core Compiler Hook Adapter Tests
 *
 * Validates that the neutral .agents/hooks/registry.yaml is the source for
 * Claude Code hook adapter generation.
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const yaml = require('yaml');
const agentCoreCommand = require('../tools/cli/commands/agent-core');
const { AgentCoreCompiler } = require('../tools/cli/installers/lib/core/agent-core-compiler');

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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-compiler-hooks-test-'));
  try {
    return await fn(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testClaudeHookAdapterUsesActiveRegistryEntries() {
  await withTempDir(async (tempDir) => {
    const registryDir = path.join(tempDir, '.agents', 'hooks');
    fs.mkdirSync(registryDir, { recursive: true });
    const registryPath = path.join(registryDir, 'registry.yaml');
    fs.writeFileSync(
      registryPath,
      yaml.stringify({
        version: '1.1',
        hooks: [
          {
            id: 'active-plan-lint',
            event: 'PostToolUse',
            matcher: 'Write|Edit',
            type: 'command',
            command: 'bash .agents/hooks/handlers/plan-lint.sh "$CLAUDE_TOOL_FILE_PATH"',
            blocking: false,
            status: 'active',
            description: 'Lint plan files',
            platform_support: ['claude-code'],
          },
          {
            id: 'pending-precompact',
            event: 'PreCompact',
            matcher: '*',
            type: 'command',
            command: 'bash .agents/hooks/handlers/pre-compact.sh',
            blocking: false,
            status: 'pending',
            description: 'Pending pre-compact hook',
            platform_support: ['claude-code'],
          },
        ],
      }),
    );

    const compiler = new AgentCoreCompiler();
    const hooks = await compiler.writeHookRegistry(tempDir, registryPath, null);
    await compiler.writePlatformAdapters(tempDir, hooks, ['claude-code']);

    const claudeHooksPath = path.join(tempDir, '.claude', 'hooks.json');
    const claudeHooks = JSON.parse(fs.readFileSync(claudeHooksPath, 'utf8'));
    const postToolUse = claudeHooks.hooks.PostToolUse || [];
    const planLintGroup = postToolUse.find((group) => group.matcher === 'Write|Edit');
    const commands = JSON.stringify(claudeHooks);

    assertPass(
      'compiler emits active plan-lint hook to Claude adapter',
      Boolean(planLintGroup?.hooks?.some((hook) => hook.command.includes('plan-lint.sh'))),
      JSON.stringify(postToolUse),
    );
    assertPass(
      'compiler excludes pending hooks from Claude adapter',
      !commands.includes('pre-compact.sh') && !claudeHooks.hooks.PreCompact,
      commands,
    );
  });
}

async function testAgentCoreCompileCommandEmitsClaudeAdapter() {
  await withTempDir(async (tempDir) => {
    await agentCoreCommand.action('compile', {
      directory: tempDir,
      target: 'claude-code',
    });

    const claudeHooksPath = path.join(tempDir, '.claude', 'hooks.json');
    const claudeHooks = JSON.parse(fs.readFileSync(claudeHooksPath, 'utf8'));
    const commands = JSON.stringify(claudeHooks);

    assertPass(
      'agent-core compile --target claude-code emits Claude hooks adapter',
      commands.includes('plan-lint.sh'),
      commands,
    );
    // pre-compact.sh is active in the current registry (W4 activated it) — both hooks should be present
    assertPass(
      'agent-core compile emits pre-compact hook (status: active in registry)',
      commands.includes('pre-compact.sh'),
      commands,
    );
  });
}

async function run() {
  console.log('Agent core compiler hook adapter tests');
  await testClaudeHookAdapterUsesActiveRegistryEntries();
  await testAgentCoreCompileCommandEmitsClaudeAdapter();

  console.log(`\nCompiler hook tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
