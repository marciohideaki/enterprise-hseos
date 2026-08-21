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

async function writeActivePluginFixture(tmpDir, { failing = false } = {}) {
  const yaml = require('yaml');
  const pluginDir = path.join(tmpDir, '.agents', 'plugins', 'definitions', 'verified-plugin');
  await fs.ensureDir(path.join(pluginDir, 'commands'));
  await fs.ensureDir(path.join(pluginDir, 'tests'));
  await fs.writeFile(path.join(pluginDir, 'README.md'), '# Verified plugin\n');
  await fs.writeFile(path.join(pluginDir, 'commands', 'run.md'), '# Run\n');
  await fs.writeFile(
    path.join(pluginDir, 'tests', 'behavior.test.js'),
    failing ? "require('node:assert').fail('fixture failure');\n" : "'use strict';\n",
  );
  await fs.writeFile(
    path.join(pluginDir, 'plugin.yaml'),
    yaml.stringify({
      id: 'verified-plugin',
      version: '1.0.0',
      description: 'Verified behavior fixture',
      license: 'MIT',
      surfaces: { commands: ['commands/run.md'] },
      verification: { conformance_tests: 'tests/' },
    }),
  );
  await fs.writeFile(
    path.join(tmpDir, '.agents', 'plugins', 'registry.yaml'),
    yaml.stringify({ plugins: [{ id: 'verified-plugin', version: '1.0.0', status: 'active' }] }),
  );
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
      for (const vendorRoot of ['.claude-plugin', '.codex-plugin']) {
        const staleDir = path.join(tmpDir, vendorRoot, 'plugins', 'hseos-skill-creator');
        await fs.ensureDir(staleDir);
        await fs.writeJson(path.join(staleDir, 'plugin.json'), { id: 'hseos-skill-creator', version: '0.1.0' });
      }
      await writePlatformPluginAdapters(tmpDir, registryPlugins, '.agents', []);

      const claudeMarketplacePath = path.join(tmpDir, '.claude-plugin', 'marketplace.json');
      const codexIndexPath = path.join(tmpDir, '.codex-plugin', 'plugin.json');

      assertPass('.claude-plugin/marketplace.json exists', await fs.pathExists(claudeMarketplacePath));
      assertPass('.codex-plugin/plugin.json exists', await fs.pathExists(codexIndexPath));

      const claudeMarketplace = JSON.parse(await fs.readFile(claudeMarketplacePath, 'utf8'));
      const codexIndex = JSON.parse(await fs.readFile(codexIndexPath, 'utf8'));
      assertPass('Claude marketplace has no inactive entries', claudeMarketplace.plugins.length === 0);
      assertPass('Codex marketplace has no inactive entries', codexIndex.plugins.length === 0);
      assertPass(
        'stale Claude installation is disabled',
        !(await fs.pathExists(path.join(tmpDir, '.claude-plugin', 'plugins', 'hseos-skill-creator'))) &&
          (await fs.pathExists(path.join(tmpDir, '.claude-plugin', 'disabled', 'hseos-skill-creator', 'plugin.json'))),
      );
      assertPass(
        'stale Codex installation is disabled',
        !(await fs.pathExists(path.join(tmpDir, '.codex-plugin', 'plugins', 'hseos-skill-creator'))) &&
          (await fs.pathExists(path.join(tmpDir, '.codex-plugin', 'disabled', 'hseos-skill-creator', 'plugin.json'))),
      );

      const staleCodexOnly = path.join(tmpDir, '.codex-plugin', 'plugins', 'hseos-hookify');
      await fs.ensureDir(staleCodexOnly);
      await fs.writeJson(path.join(staleCodexOnly, 'plugin.json'), { id: 'hseos-hookify', version: '0.1.0' });
      await writePlatformPluginAdapters(tmpDir, registryPlugins, '.agents', ['claude-code']);
      assertPass(
        'Claude-only compile still disables stale Codex plugins',
        !(await fs.pathExists(staleCodexOnly)) &&
          (await fs.pathExists(path.join(tmpDir, '.codex-plugin', 'disabled', 'hseos-hookify', 'plugin.json'))),
      );
    } finally {
      await fs.remove(tmpDir);
    }
  }

  // Test 4: plugin doctor passes on real tree
  {
    console.log('\n4. plugin doctor — passes on real definitions tree');

    const prompts = require('../tools/cli/lib/prompts');
    const originalLog = prompts.log;
    const messages = [];
    prompts.log = {
      success: async (message) => messages.push({ level: 'success', message }),
      warn: async (message) => messages.push({ level: 'warn', message }),
      error: async (message) => messages.push({ level: 'error', message }),
      message: async (message) => messages.push({ level: 'message', message }),
    };
    await assertPassAsync('doctor passes without error', async () => {
      await pluginCmd.action('doctor', undefined, { directory: REPO_ROOT });
    });
    prompts.log = originalLog;
    assertPass('doctor reports all four inactive candidates', messages.filter((entry) => entry.level === 'warn').length === 4);
    assertPass(
      'doctor reports zero active plugins passed',
      messages.some((entry) => /0 active plugin\(s\) passed; 4 inactive plugin\(s\) skipped/.test(entry.message)),
      JSON.stringify(messages),
    );
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

  // Test 6: doctor fails closed for an active plugin without behavior tests
  {
    console.log('\n6. plugin doctor — rejects active plugin without behavior tests');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-plugin-doctor-test-'));
    try {
      await fs.copy(path.join(REPO_ROOT, '.agents'), path.join(tmpDir, '.agents'));
      const yaml = require('yaml');
      const registryPath = path.join(tmpDir, '.agents', 'plugins', 'registry.yaml');
      const registry = yaml.parse(await fs.readFile(registryPath, 'utf8'));
      registry.plugins[0].status = 'active';
      await fs.writeFile(registryPath, yaml.stringify(registry));

      const prompts = require('../tools/cli/lib/prompts');
      const originalLog = prompts.log;
      prompts.log = {
        success: async () => {},
        warn: async () => {},
        error: async () => {},
        message: async () => {},
      };

      let doctorError;
      try {
        await pluginCmd.action('doctor', undefined, { directory: tmpDir });
      } catch (error) {
        doctorError = error;
      } finally {
        prompts.log = originalLog;
      }

      assertPass(
        'doctor rejects missing behavior tests',
        doctorError && /behavior tests/.test(doctorError.message),
        doctorError && doctorError.message,
      );
    } finally {
      await fs.remove(tmpDir);
    }
  }

  // Test 7: doctor executes declared behavior tests for active plugins
  {
    console.log('\n7. plugin doctor — executes active behavior tests');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-plugin-behavior-test-'));
    try {
      const yaml = require('yaml');
      const pluginDir = path.join(tmpDir, '.agents', 'plugins', 'definitions', 'verified-plugin');
      await fs.ensureDir(path.join(pluginDir, 'commands'));
      await fs.ensureDir(path.join(pluginDir, 'tests'));
      await fs.writeFile(path.join(pluginDir, 'README.md'), '# Verified plugin\n');
      await fs.writeFile(path.join(pluginDir, 'commands', 'run.md'), '# Run\n');
      await fs.writeFile(
        path.join(pluginDir, 'tests', 'behavior.test.js'),
        "require('node:fs').writeFileSync('behavior-ran.marker', 'yes');\n",
      );
      await fs.writeFile(
        path.join(pluginDir, 'plugin.yaml'),
        yaml.stringify({
          id: 'verified-plugin',
          version: '1.0.0',
          description: 'Verified behavior fixture',
          license: 'MIT',
          surfaces: { commands: ['commands/run.md'] },
          verification: { conformance_tests: 'tests/' },
        }),
      );
      const registryDir = path.join(tmpDir, '.agents', 'plugins');
      await fs.writeFile(
        path.join(registryDir, 'registry.yaml'),
        yaml.stringify({ plugins: [{ id: 'verified-plugin', version: '1.0.0', status: 'active' }] }),
      );

      const prompts = require('../tools/cli/lib/prompts');
      const originalLog = prompts.log;
      prompts.log = {
        success: async () => {},
        warn: async () => {},
        error: async () => {},
        message: async () => {},
      };
      try {
        await pluginCmd.action('doctor', undefined, { directory: tmpDir });
      } finally {
        prompts.log = originalLog;
      }

      assertPass('active behavior test executed', await fs.pathExists(path.join(pluginDir, 'behavior-ran.marker')));
    } finally {
      await fs.remove(tmpDir);
    }
  }

  // Test 8: install materializes every declared surface after conformance passes
  {
    console.log('\n8. plugin install — materializes validated surfaces for both vendors');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-plugin-install-active-'));
    try {
      await writeActivePluginFixture(tmpDir);
      const prompts = require('../tools/cli/lib/prompts');
      const originalLog = prompts.log;
      prompts.log = {
        success: async () => {},
        warn: async () => {},
        error: async () => {},
        message: async () => {},
      };
      try {
        await pluginCmd.action('install', 'verified-plugin', { directory: tmpDir });
      } finally {
        prompts.log = originalLog;
      }

      for (const vendorRoot of ['.claude-plugin', '.codex-plugin']) {
        const installedDir = path.join(tmpDir, vendorRoot, 'plugins', 'verified-plugin');
        assertPass(
          `${vendorRoot} install contains manifest and declared command`,
          (await fs.pathExists(path.join(installedDir, 'plugin.json'))) &&
            (await fs.pathExists(path.join(installedDir, 'commands', 'run.md'))),
        );
      }
    } finally {
      await fs.remove(tmpDir);
    }
  }

  // Test 9: install fails closed before writing a plugin whose behavior test fails
  {
    console.log('\n9. plugin install — rejects failing behavior before materialization');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-plugin-install-failing-'));
    try {
      await writeActivePluginFixture(tmpDir, { failing: true });
      const prompts = require('../tools/cli/lib/prompts');
      const originalLog = prompts.log;
      prompts.log = {
        success: async () => {},
        warn: async () => {},
        error: async () => {},
        message: async () => {},
      };
      let installError;
      try {
        await pluginCmd.action('install', 'verified-plugin', { directory: tmpDir });
      } catch (error) {
        installError = error;
      } finally {
        prompts.log = originalLog;
      }
      assertPass('failing conformance rejects install', Boolean(installError));
      assertPass(
        'failing conformance writes no vendor plugin',
        !(await fs.pathExists(path.join(tmpDir, '.claude-plugin', 'plugins', 'verified-plugin'))) &&
          !(await fs.pathExists(path.join(tmpDir, '.codex-plugin', 'plugins', 'verified-plugin'))),
      );
    } finally {
      await fs.remove(tmpDir);
    }
  }

  // Test 10: a vendor preparation failure cannot leave a partial dual-vendor install
  {
    console.log('\n10. plugin install — rolls back cross-vendor preparation failure');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-plugin-install-transaction-'));
    try {
      await writeActivePluginFixture(tmpDir);
      await fs.ensureDir(path.join(tmpDir, '.codex-plugin'));
      await fs.writeFile(path.join(tmpDir, '.codex-plugin', 'plugins'), 'forced directory collision\n');

      const prompts = require('../tools/cli/lib/prompts');
      const originalLog = prompts.log;
      prompts.log = {
        success: async () => {},
        warn: async () => {},
        error: async () => {},
        message: async () => {},
      };
      let installError;
      try {
        await pluginCmd.action('install', 'verified-plugin', { directory: tmpDir });
      } catch (error) {
        installError = error;
      } finally {
        prompts.log = originalLog;
      }

      assertPass('second-vendor preparation failure is reported', Boolean(installError));
      assertPass(
        'preparation failure leaves no partial Claude install',
        !(await fs.pathExists(path.join(tmpDir, '.claude-plugin', 'plugins', 'verified-plugin'))),
      );
      const claudeEntries = await fs.readdir(path.join(tmpDir, '.claude-plugin', 'plugins'));
      assertPass('preparation failure removes Claude staging artifacts', claudeEntries.length === 0, claudeEntries.join(','));
    } finally {
      await fs.remove(tmpDir);
    }
  }

  // Test 11: failure during the second swap restores both previous installations
  {
    console.log('\n11. plugin install — rolls back both vendors when second swap fails');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-plugin-install-swap-'));
    const originalMove = fs.move;
    try {
      await writeActivePluginFixture(tmpDir);
      for (const vendorRoot of ['.claude-plugin', '.codex-plugin']) {
        const installedDir = path.join(tmpDir, vendorRoot, 'plugins', 'verified-plugin');
        await fs.ensureDir(installedDir);
        await fs.writeFile(path.join(installedDir, 'old.marker'), vendorRoot);
      }

      fs.move = async (...arguments_) => {
        const [source, destination] = arguments_;
        if (
          source.includes(`${path.sep}.codex-plugin${path.sep}plugins${path.sep}.verified-plugin-`) &&
          destination.endsWith(`${path.sep}.codex-plugin${path.sep}plugins${path.sep}verified-plugin`) &&
          !source.endsWith('.previous')
        ) {
          throw new Error('injected second-swap failure');
        }
        return originalMove(...arguments_);
      };

      const prompts = require('../tools/cli/lib/prompts');
      const originalLog = prompts.log;
      prompts.log = { success: async () => {}, warn: async () => {}, error: async () => {}, message: async () => {} };
      let installError;
      try {
        await pluginCmd.action('install', 'verified-plugin', { directory: tmpDir });
      } catch (error) {
        installError = error;
      } finally {
        prompts.log = originalLog;
        fs.move = originalMove;
      }

      assertPass('second-swap failure is reported', Boolean(installError));
      for (const vendorRoot of ['.claude-plugin', '.codex-plugin']) {
        const installedDir = path.join(tmpDir, vendorRoot, 'plugins', 'verified-plugin');
        assertPass(
          `${vendorRoot} previous install is restored`,
          (await fs.pathExists(path.join(installedDir, 'old.marker'))) &&
            !(await fs.pathExists(path.join(installedDir, 'commands', 'run.md'))),
        );
      }
    } finally {
      fs.move = originalMove;
      await fs.remove(tmpDir);
    }
  }

  // Test 12: backup cleanup failure preserves the committed new installations
  {
    console.log('\n12. plugin install — cleanup failure cannot roll back a committed install');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-plugin-install-cleanup-'));
    const originalRemove = fs.remove;
    try {
      await writeActivePluginFixture(tmpDir);
      for (const vendorRoot of ['.claude-plugin', '.codex-plugin']) {
        const installedDir = path.join(tmpDir, vendorRoot, 'plugins', 'verified-plugin');
        await fs.ensureDir(installedDir);
        await fs.writeFile(path.join(installedDir, 'old.marker'), vendorRoot);
      }

      let injected = false;
      fs.remove = async (...arguments_) => {
        const [target] = arguments_;
        if (!injected && target.includes(`${path.sep}.codex-plugin${path.sep}plugins${path.sep}`) && target.endsWith('.previous')) {
          injected = true;
          throw new Error('injected backup-cleanup failure');
        }
        return originalRemove(...arguments_);
      };

      const prompts = require('../tools/cli/lib/prompts');
      const originalLog = prompts.log;
      const warnings = [];
      prompts.log = {
        success: async () => {},
        warn: async (message) => warnings.push(message),
        error: async () => {},
        message: async () => {},
      };
      try {
        await pluginCmd.action('install', 'verified-plugin', { directory: tmpDir });
      } finally {
        prompts.log = originalLog;
        fs.remove = originalRemove;
      }

      for (const vendorRoot of ['.claude-plugin', '.codex-plugin']) {
        const installedDir = path.join(tmpDir, vendorRoot, 'plugins', 'verified-plugin');
        assertPass(
          `${vendorRoot} keeps the committed new install`,
          (await fs.pathExists(path.join(installedDir, 'commands', 'run.md'))) &&
            !(await fs.pathExists(path.join(installedDir, 'old.marker'))),
        );
      }
      assertPass('cleanup failure is reported as a warning', warnings.some((message) => /cleanup requires attention/.test(message)));
    } finally {
      fs.remove = originalRemove;
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
