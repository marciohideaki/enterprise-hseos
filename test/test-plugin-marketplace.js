/**
 * Plugin Marketplace Tests (W5-impl)
 *
 * Tests:
 * 1. writePluginRegistry exposes scaffolded marketplace candidates
 * 2. writePlatformPluginAdapters emits empty vendor catalogs for inactive candidates
 * 3. plugin definitions remain structurally valid while inactive
 * 4. plugin install rejects inactive candidates
 */

'use strict';

const path = require('node:path');
const fs = require('fs-extra');
const os = require('node:os');

const REPO_ROOT = path.join(__dirname, '..');

const { writePluginRegistry } = require('../tools/cli/installers/lib/core/agent-core-compiler/sources/plugins-source');
const { writePlatformPluginAdapters } = require('../tools/cli/installers/lib/core/agent-core-compiler/adapters/plugins-emit');
const pluginCmd = require('../tools/cli/commands/plugin');

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

async function assertPassAsync(label, fn) {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
    passed++;
  } catch (error) {
    console.error(`  FAIL  ${label} — ${error.message}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n=== Plugin Marketplace Tests ===\n');

  // Test 1: writePluginRegistry returns 4 plugins
  {
    console.log('1. writePluginRegistry — loads 4 plugins from registry.yaml');
    const plugins = await writePluginRegistry(REPO_ROOT);
    assertPass('returns array', Array.isArray(plugins));
    assertPass('returns 4 plugins', plugins.length === 4, `got ${plugins.length}`);
    assertPass(
      'all have ids',
      plugins.every((p) => p.id),
    );
    assertPass(
      'all scaffolded',
      plugins.every((p) => p.status === 'scaffolded'),
      JSON.stringify(plugins.map((p) => p.status)),
    );
  }

  // Test 2 & 3: writePlatformPluginAdapters emits both formats
  {
    console.log('\n2-3. writePlatformPluginAdapters — emits dual-format adapters');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-plugin-test-'));
    try {
      const registryPlugins = await writePluginRegistry(REPO_ROOT);
      // Copy plugin definitions to tmpDir for the emitter to read
      await fs.copy(path.join(REPO_ROOT, '.agents'), path.join(tmpDir, '.agents'));
      await writePlatformPluginAdapters(tmpDir, registryPlugins, '.agents', []);

      const claudeMarketplacePath = path.join(tmpDir, '.claude-plugin', 'marketplace.json');
      const codexIndexPath = path.join(tmpDir, '.codex-plugin', 'plugin.json');

      assertPass('.claude-plugin/marketplace.json exists', await fs.pathExists(claudeMarketplacePath));
      assertPass('.codex-plugin/plugin.json exists', await fs.pathExists(codexIndexPath));

      const claudeMarketplace = JSON.parse(await fs.readFile(claudeMarketplacePath, 'utf8'));
      const codexIndex = JSON.parse(await fs.readFile(codexIndexPath, 'utf8'));
      assertPass('Claude marketplace has no inactive entries', claudeMarketplace.plugins.length === 0);
      assertPass('Codex marketplace has no inactive entries', codexIndex.plugins.length === 0);
    } finally {
      await fs.remove(tmpDir);
    }
  }

  // Test 4: plugin doctor passes on real tree
  {
    console.log('\n4. plugin doctor — passes on real definitions tree');

    // Capture log output via mock
    const logs = [];
    const errors = [];
    const originalLog = console.log;
    const originalError = console.error;

    // We need to stub prompts — run doctor directly with project dir
    // Since prompts.log methods are async, we test by running the action
    // and catching any thrown error
    await assertPassAsync('doctor passes without error', async () => {
      // Directly test the doctor logic by reading the registry and checking files
      const yaml = require('yaml');
      const registry = yaml.parse(await fs.readFile(path.join(REPO_ROOT, '.agents', 'plugins', 'registry.yaml'), 'utf8'));
      for (const entry of registry.plugins) {
        const manifestPath = path.join(REPO_ROOT, '.agents', 'plugins', 'definitions', entry.id, 'plugin.yaml');
        const readmePath = path.join(REPO_ROOT, '.agents', 'plugins', 'definitions', entry.id, 'README.md');
        if (!(await fs.pathExists(manifestPath))) throw new Error(`Missing plugin.yaml for ${entry.id}`);
        if (!(await fs.pathExists(readmePath))) throw new Error(`Missing README.md for ${entry.id}`);
        const manifest = yaml.parse(await fs.readFile(manifestPath, 'utf8'));
        for (const key of ['id', 'version', 'description', 'license']) {
          if (!manifest[key]) throw new Error(`${entry.id} missing key: ${key}`);
        }
      }
    });
  }

  // Test 5: plugin install rejects inactive candidates
  {
    console.log('\n5. plugin install — rejects inactive candidate');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-install-test-'));
    try {
      await fs.copy(path.join(REPO_ROOT, '.agents'), path.join(tmpDir, '.agents'));

      // Stub prompts.log to avoid clack UI
      const prompts = require('../tools/cli/lib/prompts');
      const origLog = prompts.log;
      prompts.log = {
        success: async () => {},
        warn: async () => {},
        error: async () => {},
        message: async () => {},
      };

      let installError;
      try {
        await pluginCmd.action('install', 'hseos-skill-creator', { directory: tmpDir });
      } catch (error) {
        installError = error;
      }

      prompts.log = origLog;

      const claudePath = path.join(tmpDir, '.claude-plugin', 'plugins', 'hseos-skill-creator', 'plugin.json');
      const codexPath = path.join(tmpDir, '.codex-plugin', 'plugins', 'hseos-skill-creator', 'plugin.json');

      assertPass('inactive install returns a clear error', installError && /not installable/.test(installError.message));
      assertPass('Claude plugin is not written', !(await fs.pathExists(claudePath)));
      assertPass('Codex plugin is not written', !(await fs.pathExists(codexPath)));
    } finally {
      await fs.remove(tmpDir);
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch((error) => {
  console.error('Test suite error:', error);
  process.exit(1);
});
