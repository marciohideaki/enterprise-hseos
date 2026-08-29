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
const yaml = require('yaml');

const REPO_ROOT = path.join(__dirname, '..');

const {
  loadActivePluginManifests,
  syncPluginCatalog,
  validatePluginRegistryDocument,
  writePluginRegistry,
} = require('../tools/cli/installers/lib/core/agent-core-compiler/sources/plugins-source');
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

async function snapshotTree(directory, prefix = '') {
  const snapshot = {};
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = path.posix.join(prefix, entry.name);
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(snapshot, await snapshotTree(entryPath, relative));
    if (entry.isFile()) snapshot[relative] = await fs.readFile(entryPath, 'utf8');
  }
  return snapshot;
}

async function writeActivePluginFixture(tmpDir, { failing = false } = {}) {
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
        const orphanDir = path.join(tmpDir, vendorRoot, 'plugins', 'orphan-plugin');
        await fs.ensureDir(orphanDir);
        await fs.writeJson(path.join(orphanDir, 'plugin.json'), { id: 'orphan-plugin', version: '0.1.0' });
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
      assertPass(
        'orphan vendor installations are quarantined from both generated trees',
        (
          await Promise.all(
            ['.claude-plugin', '.codex-plugin'].map(
              async (vendorRoot) =>
                !(await fs.pathExists(path.join(tmpDir, vendorRoot, 'plugins', 'orphan-plugin'))) &&
                (await fs.pathExists(path.join(tmpDir, vendorRoot, 'disabled', 'orphan-plugin', 'plugin.json'))),
            ),
          )
        ).every(Boolean),
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
      assertPass(
        'cleanup failure is reported as a warning',
        warnings.some((message) => /cleanup requires attention/.test(message)),
      );
    } finally {
      fs.remove = originalRemove;
      await fs.remove(tmpDir);
    }
  }

  // Test 13: canonical enterprise sources materialize an exact generated catalog
  {
    console.log('\n13. plugin catalog — canonical source exactly replaces generated output');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-plugin-canonical-'));
    try {
      const canonical = path.join(tmpDir, '.enterprise', 'governance', 'plugins');
      const generated = path.join(tmpDir, '.agents', 'plugins');
      await fs.copy(path.join(REPO_ROOT, '.enterprise', 'governance', 'plugins'), canonical);
      await fs.ensureDir(generated);
      await fs.writeFile(path.join(generated, 'stale.generated'), 'must disappear\n');
      const result = await syncPluginCatalog(tmpDir, REPO_ROOT);
      assertPass('target canonical source wins', result.mode === 'canonical-target', result.mode);
      assertPass(
        'generated plugin tree is byte-exact with canonical source',
        JSON.stringify(await snapshotTree(generated)) === JSON.stringify(await snapshotTree(canonical)),
      );
      assertPass('stale generated plugin file is removed', !(await fs.pathExists(path.join(generated, 'stale.generated'))));

      await fs.writeFile(path.join(generated, 'registry.yaml'), 'tampered: true\n');
      await syncPluginCatalog(tmpDir, REPO_ROOT);
      assertPass(
        'direct generated edit is overwritten from canonical source',
        (await fs.readFile(path.join(generated, 'registry.yaml'), 'utf8')) ===
          (await fs.readFile(path.join(canonical, 'registry.yaml'), 'utf8')),
      );
    } finally {
      await fs.remove(tmpDir);
    }
  }

  // Test 14: schema-v2 registry rejects unsafe or misleading candidates
  {
    console.log('\n14. plugin catalog — schema v2 fails closed');
    const registry = yaml.parse(await fs.readFile(path.join(REPO_ROOT, '.enterprise', 'governance', 'plugins', 'registry.yaml'), 'utf8'));
    const invalidRegistries = [
      ['unknown top-level field', { ...registry, typo: true }],
      ['duplicate plugin id', { ...registry, plugins: [...registry.plugins, { ...registry.plugins[0] }] }],
      ['unsafe plugin id', { ...registry, plugins: [{ ...registry.plugins[0], id: '../../escape' }] }],
      ['unknown plugin status', { ...registry, plugins: [{ ...registry.plugins[0], status: 'implemented' }] }],
      ['plugin id starting with a digit', { ...registry, plugins: [{ ...registry.plugins[0], id: '1plugin' }] }],
      ['invalid semver', { ...registry, plugins: [{ ...registry.plugins[0], version: 'latest' }] }],
      ['invalid semver prerelease', { ...registry, plugins: [{ ...registry.plugins[0], version: '1.0.0-..' }] }],
      ['wrong source authority', { ...registry, source_of_truth: '.agents/plugins' }],
      ['unknown schema version', { ...registry, schema_version: '3.0' }],
      ['unknown marketplace field', { ...registry, marketplace: { ...registry.marketplace, typo: true } }],
      ['unsafe emit target', { ...registry, emit_targets: { ...registry.emit_targets, codex: '../../outside.json' } }],
      ['dot-dot emit target', { ...registry, emit_targets: { ...registry.emit_targets, codex: '..' } }],
      ['divergent emit target', { ...registry, emit_targets: { ...registry.emit_targets, codex: '.codex-plugin/other.json' } }],
      ['Windows traversal emit target', { ...registry, emit_targets: { ...registry.emit_targets, codex: String.raw`..\..\outside.json` } }],
      ['unsupported resolution policy', { ...registry, resolution: { ...registry.resolution, duplicate_id_strategy: 'last' } }],
      ['duplicate bundle', { ...registry, plugins: [{ ...registry.plugins[0], requires_bundles: ['core', 'core'] }] }],
      ['empty required files', { ...registry, conformance: { ...registry.conformance, required_files: [] } }],
      [
        'duplicate required file',
        { ...registry, conformance: { ...registry.conformance, required_files: ['plugin.yaml', 'README.md', 'README.md'] } },
      ],
      [
        'traversal required file',
        { ...registry, conformance: { ...registry.conformance, required_files: ['plugin.yaml', 'README.md', '../secret'] } },
      ],
      ['empty required manifest keys', { ...registry, conformance: { ...registry.conformance, required_manifest_keys: [] } }],
      ['empty reserved id prefix', { ...registry, conformance: { ...registry.conformance, reserved_id_prefix: '' } }],
    ];
    for (const [label, invalid] of invalidRegistries) {
      let rejected = false;
      try {
        validatePluginRegistryDocument(invalid);
      } catch {
        rejected = true;
      }
      assertPass(`schema v2 rejects ${label}`, rejected);
    }
    const legacyV1 = { schema_version: '1.0', plugins: [{ id: 'legacy-plugin', version: '1.0.0', status: 'active' }] };
    assertPass('known schema v1 remains a bounded compatibility input', validatePluginRegistryDocument(legacyV1) === false);
    assertPass(
      'schema v2 accepts SemVer build metadata',
      validatePluginRegistryDocument({
        ...registry,
        plugins: [{ ...registry.plugins[0], version: '1.0.0-rc.1+build.7' }],
      }) === true,
    );
  }

  // Test 15: active surfaces cannot escape through symlinks
  {
    console.log('\n15. plugin conformance — rejects symlink surface escape');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-plugin-symlink-'));
    try {
      await writeActivePluginFixture(tmpDir);
      const pluginDir = path.join(tmpDir, '.agents', 'plugins', 'definitions', 'verified-plugin');
      const outside = path.join(tmpDir, 'outside.md');
      await fs.writeFile(outside, '# outside\n');
      await fs.remove(path.join(pluginDir, 'commands', 'run.md'));
      await fs.symlink(outside, path.join(pluginDir, 'commands', 'run.md'));
      const registryPlugins = await writePluginRegistry(tmpDir);
      let rejected = false;
      try {
        await loadActivePluginManifests(tmpDir, registryPlugins);
      } catch {
        rejected = true;
      }
      assertPass('active symlink surface outside definition is rejected', rejected);
    } finally {
      await fs.remove(tmpDir);
    }
  }

  // Test 16: plugin removal validates IDs before resolving filesystem paths
  {
    console.log('\n16. plugin remove — rejects path traversal');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-plugin-remove-safe-'));
    try {
      const marker = path.join(tmpDir, 'marker');
      await fs.ensureDir(marker);
      let removeError;
      try {
        await pluginCmd.action('remove', '../../marker', { directory: tmpDir });
      } catch (error) {
        removeError = error;
      }
      assertPass('unsafe remove id is rejected', removeError && /Invalid plugin id/.test(removeError.message));
      assertPass('unsafe remove cannot delete outside vendor roots', await fs.pathExists(marker));
    } finally {
      await fs.remove(tmpDir);
    }
  }

  // Test 17: catalog synchronization restores the previous generated tree on swap failure
  {
    console.log('\n17. plugin catalog — synchronization rollback preserves previous output');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-plugin-sync-rollback-'));
    const originalMove = fs.move;
    try {
      const canonical = path.join(tmpDir, '.enterprise', 'governance', 'plugins');
      const generated = path.join(tmpDir, '.agents', 'plugins');
      await fs.copy(path.join(REPO_ROOT, '.enterprise', 'governance', 'plugins'), canonical);
      await fs.ensureDir(generated);
      await fs.writeFile(path.join(generated, 'previous.marker'), 'preserve me\n');
      fs.move = async (...arguments_) => {
        const [source, destination] = arguments_;
        if (
          source.includes(`${path.sep}.plugins-sync-`) &&
          source.endsWith(`${path.sep}.agents${path.sep}plugins`) &&
          destination === generated
        ) {
          throw new Error('injected catalog swap failure');
        }
        return originalMove(...arguments_);
      };

      let syncError;
      try {
        await syncPluginCatalog(tmpDir, REPO_ROOT);
      } catch (error) {
        syncError = error;
      }
      assertPass('catalog swap failure is reported', syncError && /synchronization failed/.test(syncError.message));
      assertPass('previous generated tree is restored', await fs.pathExists(path.join(generated, 'previous.marker')));
      assertPass(
        'catalog transaction artifacts are removed',
        !(await fs.readdir(path.dirname(generated))).some((entry) => entry.startsWith('.plugins-sync-')),
      );
    } finally {
      fs.move = originalMove;
      await fs.remove(tmpDir);
    }
  }

  // Test 18: canonical validation is part of the sync transaction
  {
    console.log('\n18. plugin catalog — invalid canonical input preserves previous generated output');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-plugin-sync-validation-'));
    try {
      const canonical = path.join(tmpDir, '.enterprise', 'governance', 'plugins');
      const generated = path.join(tmpDir, '.agents', 'plugins');
      await fs.copy(path.join(REPO_ROOT, '.enterprise', 'governance', 'plugins'), canonical);
      await fs.ensureDir(generated);
      await fs.writeFile(path.join(generated, 'previous.marker'), 'preserve me\n');
      const registryPath = path.join(canonical, 'registry.yaml');
      const registry = yaml.parse(await fs.readFile(registryPath, 'utf8'));
      registry.unknown_field = true;
      await fs.writeFile(registryPath, yaml.stringify(registry));
      let syncError;
      try {
        await syncPluginCatalog(tmpDir, REPO_ROOT);
      } catch (error) {
        syncError = error;
      }
      assertPass('invalid canonical registry is rejected before publication', syncError && /unknown field/.test(syncError.message));
      assertPass('previous generated output survives validation failure', await fs.pathExists(path.join(generated, 'previous.marker')));

      delete registry.unknown_field;
      registry.schema_version = '1.0';
      await fs.writeFile(registryPath, yaml.stringify(registry));
      syncError = undefined;
      try {
        await syncPluginCatalog(tmpDir, REPO_ROOT);
      } catch (error) {
        syncError = error;
      }
      assertPass('canonical authority rejects legacy schema v1', syncError && /requires schema_version 2.0/.test(syncError.message));
      assertPass('v1 canonical rejection preserves previous output', await fs.pathExists(path.join(generated, 'previous.marker')));
    } finally {
      await fs.remove(tmpDir);
    }
  }

  // Test 19: README symlinks cannot escape and be copied into vendor installs
  {
    console.log('\n19. plugin conformance — rejects README symlink escape');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-plugin-readme-symlink-'));
    try {
      await writeActivePluginFixture(tmpDir);
      const pluginDir = path.join(tmpDir, '.agents', 'plugins', 'definitions', 'verified-plugin');
      const outside = path.join(tmpDir, 'outside.md');
      await fs.writeFile(outside, '# outside\n');
      await fs.remove(path.join(pluginDir, 'README.md'));
      await fs.symlink(outside, path.join(pluginDir, 'README.md'));
      const registryPlugins = await writePluginRegistry(tmpDir);
      let rejected = false;
      try {
        await loadActivePluginManifests(tmpDir, registryPlugins);
      } catch {
        rejected = true;
      }
      assertPass('README symlink outside definition is rejected', rejected);
    } finally {
      await fs.remove(tmpDir);
    }
  }

  // Test 20: Windows traversal syntax is rejected on POSIX hosts
  {
    console.log('\n20. plugin conformance — rejects Windows traversal surface');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-plugin-win-traversal-'));
    try {
      await writeActivePluginFixture(tmpDir);
      const pluginPath = path.join(tmpDir, '.agents', 'plugins', 'definitions', 'verified-plugin', 'plugin.yaml');
      const manifest = yaml.parse(await fs.readFile(pluginPath, 'utf8'));
      manifest.surfaces.commands = [String.raw`..\escape.md`];
      await fs.writeFile(pluginPath, yaml.stringify(manifest));
      const registryPlugins = await writePluginRegistry(tmpDir);
      let rejected = false;
      try {
        await loadActivePluginManifests(tmpDir, registryPlugins);
      } catch {
        rejected = true;
      }
      assertPass('Windows traversal surface is rejected cross-platform', rejected);
    } finally {
      await fs.remove(tmpDir);
    }
  }

  // Test 21: compiler emitter materializes complete active directories for both vendors
  {
    console.log('\n21. plugin emission — active catalog entries have complete vendor directories');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-plugin-emitter-active-'));
    try {
      await writeActivePluginFixture(tmpDir);
      const registryPlugins = await writePluginRegistry(tmpDir);
      const manifests = await loadActivePluginManifests(tmpDir, registryPlugins);
      await writePlatformPluginAdapters(tmpDir, registryPlugins, '.agents', [], manifests);
      for (const vendorRoot of ['.claude-plugin', '.codex-plugin']) {
        const installed = path.join(tmpDir, vendorRoot, 'plugins', 'verified-plugin');
        assertPass(
          `${vendorRoot} emitter writes manifest, README, and surface`,
          (await fs.pathExists(path.join(installed, 'plugin.json'))) &&
            (await fs.pathExists(path.join(installed, 'README.md'))) &&
            (await fs.pathExists(path.join(installed, 'commands', 'run.md'))),
        );
      }
    } finally {
      await fs.remove(tmpDir);
    }
  }

  // Test 22: doctor preserves schema-v2 strictness
  {
    console.log('\n22. plugin doctor — rejects unknown manifest fields under schema v2');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-plugin-doctor-v2-'));
    try {
      await writeActivePluginFixture(tmpDir);
      const registryPath = path.join(tmpDir, '.agents', 'plugins', 'registry.yaml');
      const registry = yaml.parse(await fs.readFile(path.join(REPO_ROOT, '.enterprise', 'governance', 'plugins', 'registry.yaml'), 'utf8'));
      registry.plugins = [
        {
          id: 'verified-plugin',
          version: '1.0.0',
          status: 'active',
          description: 'Verified behavior fixture',
          extends: '',
          requires_bundles: ['core'],
        },
      ];
      await fs.writeFile(registryPath, yaml.stringify(registry));
      const pluginPath = path.join(tmpDir, '.agents', 'plugins', 'definitions', 'verified-plugin', 'plugin.yaml');
      const manifest = yaml.parse(await fs.readFile(pluginPath, 'utf8'));
      manifest.authors = ['Fixture'];
      manifest.extends = '';
      manifest.requires_bundles = ['core'];
      manifest.unknown_field = true;
      await fs.writeFile(pluginPath, yaml.stringify(manifest));
      const prompts = require('../tools/cli/lib/prompts');
      const originalLog = prompts.log;
      prompts.log = { success: async () => {}, warn: async () => {}, error: async () => {}, message: async () => {} };
      let doctorError;
      try {
        await pluginCmd.action('doctor', undefined, { directory: tmpDir });
      } catch (error) {
        doctorError = error;
      } finally {
        prompts.log = originalLog;
      }
      assertPass('schema-v2 doctor rejects unknown manifest field', doctorError && /unknown field/.test(doctorError.message));
    } finally {
      await fs.remove(tmpDir);
    }
  }

  // Test 23: vendor roots, directories, and indices commit or roll back together
  {
    console.log('\n23. plugin emission — index failure rolls back both complete vendor roots');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-plugin-emitter-atomic-'));
    const originalWriteFile = fs.writeFile;
    try {
      await writeActivePluginFixture(tmpDir);
      let registryPlugins = await writePluginRegistry(tmpDir);
      let manifests = await loadActivePluginManifests(tmpDir, registryPlugins);
      await writePlatformPluginAdapters(tmpDir, registryPlugins, '.agents', [], manifests);
      const before = {
        claude: await snapshotTree(path.join(tmpDir, '.claude-plugin')),
        codex: await snapshotTree(path.join(tmpDir, '.codex-plugin')),
      };

      const registryPath = path.join(tmpDir, '.agents', 'plugins', 'registry.yaml');
      const registry = yaml.parse(await fs.readFile(registryPath, 'utf8'));
      registry.plugins[0].version = '1.1.0';
      await fs.writeFile(registryPath, yaml.stringify(registry));
      const manifestPath = path.join(tmpDir, '.agents', 'plugins', 'definitions', 'verified-plugin', 'plugin.yaml');
      const manifest = yaml.parse(await fs.readFile(manifestPath, 'utf8'));
      manifest.version = '1.1.0';
      await fs.writeFile(manifestPath, yaml.stringify(manifest));
      registryPlugins = await writePluginRegistry(tmpDir);
      manifests = await loadActivePluginManifests(tmpDir, registryPlugins);

      fs.writeFile = async (...arguments_) => {
        const [target] = arguments_;
        if (target.includes(`${path.sep}.codex-plugin-emit-`) && target.endsWith(`${path.sep}next${path.sep}plugin.json`)) {
          throw new Error('injected Codex index failure');
        }
        return originalWriteFile(...arguments_);
      };
      let emitError;
      try {
        await writePlatformPluginAdapters(tmpDir, registryPlugins, '.agents', [], manifests);
      } catch (error) {
        emitError = error;
      } finally {
        fs.writeFile = originalWriteFile;
      }
      assertPass('Codex index failure is reported', Boolean(emitError));
      assertPass(
        'Claude vendor root remains byte-identical after failed publication',
        JSON.stringify(await snapshotTree(path.join(tmpDir, '.claude-plugin'))) === JSON.stringify(before.claude),
      );
      assertPass(
        'Codex vendor root remains byte-identical after failed publication',
        JSON.stringify(await snapshotTree(path.join(tmpDir, '.codex-plugin'))) === JSON.stringify(before.codex),
      );
      assertPass(
        'failed publication leaves no transaction directories',
        !(await fs.readdir(tmpDir)).some((entry) => /^\.(?:claude|codex)-plugin-emit-/.test(entry)),
      );
    } finally {
      fs.writeFile = originalWriteFile;
      await fs.remove(tmpDir);
    }
  }

  // Test 24: repeated activation cycles replace quarantine without stale discovery
  {
    console.log('\n24. plugin emission — active/inactive cycles remain truthful');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-plugin-emitter-cycle-'));
    try {
      await writeActivePluginFixture(tmpDir);
      const registryPath = path.join(tmpDir, '.agents', 'plugins', 'registry.yaml');
      for (const status of ['active', 'scaffolded', 'active', 'scaffolded']) {
        const registry = yaml.parse(await fs.readFile(registryPath, 'utf8'));
        registry.plugins[0].status = status;
        await fs.writeFile(registryPath, yaml.stringify(registry));
        const registryPlugins = await writePluginRegistry(tmpDir);
        const manifests = await loadActivePluginManifests(tmpDir, registryPlugins);
        await writePlatformPluginAdapters(tmpDir, registryPlugins, '.agents', [], manifests);
      }
      for (const vendorRoot of ['.claude-plugin', '.codex-plugin']) {
        assertPass(
          `${vendorRoot} final scaffold is quarantined and not active`,
          !(await fs.pathExists(path.join(tmpDir, vendorRoot, 'plugins', 'verified-plugin'))) &&
            (await fs.pathExists(path.join(tmpDir, vendorRoot, 'disabled', 'verified-plugin', 'plugin.json'))),
        );
      }
      const claude = await fs.readJson(path.join(tmpDir, '.claude-plugin', 'marketplace.json'));
      const codex = await fs.readJson(path.join(tmpDir, '.codex-plugin', 'plugin.json'));
      assertPass('final vendor indices advertise no scaffolded plugin', claude.plugins.length === 0 && codex.plugins.length === 0);
    } finally {
      await fs.remove(tmpDir);
    }
  }

  // Test 25: stale vendor symlinks fail closed before publication
  {
    console.log('\n25. plugin emission — rejects stale symlink entries');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-plugin-emitter-symlink-'));
    try {
      await fs.copy(path.join(REPO_ROOT, '.agents'), path.join(tmpDir, '.agents'));
      const outside = path.join(tmpDir, 'outside');
      await fs.ensureDir(outside);
      const stale = path.join(tmpDir, '.claude-plugin', 'plugins', 'stale-plugin');
      await fs.ensureDir(path.dirname(stale));
      await fs.symlink(outside, stale);
      const registryPlugins = await writePluginRegistry(tmpDir);
      let emitError;
      try {
        await writePlatformPluginAdapters(tmpDir, registryPlugins, '.agents', [], []);
      } catch (error) {
        emitError = error;
      }
      assertPass('stale vendor symlink is rejected', emitError && /symlink|not a directory/.test(emitError.message));
      assertPass('rejected stale symlink remains unmodified', (await fs.lstat(stale)).isSymbolicLink());
    } finally {
      await fs.remove(tmpDir);
    }
  }

  // Test 26: vendor roots and ancestors of emitted files cannot be symlinks
  {
    console.log('\n26. plugin emission — rejects symlinked vendor roots and plugin containers');
    for (const symlinkTarget of ['vendor-root', 'plugins-container']) {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `hseos-plugin-emitter-${symlinkTarget}-`));
      try {
        await fs.copy(path.join(REPO_ROOT, '.agents'), path.join(tmpDir, '.agents'));
        const outside = path.join(tmpDir, 'outside');
        await fs.ensureDir(outside);
        if (symlinkTarget === 'vendor-root') {
          await fs.symlink(outside, path.join(tmpDir, '.claude-plugin'));
        } else {
          await fs.ensureDir(path.join(tmpDir, '.claude-plugin'));
          await fs.symlink(outside, path.join(tmpDir, '.claude-plugin', 'plugins'));
        }
        const registryPlugins = await writePluginRegistry(tmpDir);
        let emitError;
        try {
          await writePlatformPluginAdapters(tmpDir, registryPlugins, '.agents', [], []);
        } catch (error) {
          emitError = error;
        }
        assertPass(`${symlinkTarget} symlink is rejected`, emitError && /symlink|real directory/.test(emitError.message));
        assertPass(`${symlinkTarget} rejection writes nothing outside`, (await fs.readdir(outside)).length === 0);
      } finally {
        await fs.remove(tmpDir);
      }
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch((error) => {
  console.error('Test suite error:', error);
  process.exit(1);
});
