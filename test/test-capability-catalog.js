/**
 * Capability catalog tests
 *
 * Validates profile/component manifests, synthetic skill selectors, adapter
 * matrix loading, and installer option wiring.
 */

const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const fs = require('fs-extra');
const yaml = require('yaml');
const {
  REQUIRED_BASELINE_IDS,
  loadAdapterMatrix,
  loadCapabilityCatalog,
  resolveCapabilityPlan,
  validateCapabilityDocuments,
  validateSurfaceDocument,
} = require('../tools/cli/lib/capability-catalog');
const { AgentCoreCompiler } = require('../tools/cli/installers/lib/core/agent-core-compiler');
const { syncCapabilityCatalog } = require('../tools/cli/installers/lib/core/agent-core-compiler/sources/capabilities-source');
const installCommand = require('../tools/cli/commands/install');

const REPO_ROOT = path.join(__dirname, '..');
const HSEOS_CLI = path.join(REPO_ROOT, 'tools', 'cli', 'hseos-cli.js');

let passed = 0;
let failed = 0;

function assertPass(label, condition, details = '') {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}${details ? ` - ${details}` : ''}`);
    failed++;
  }
}

function testSurfaceLifecycleFailsClosed() {
  const capabilityRoot = path.join(REPO_ROOT, '.enterprise', 'governance', 'capabilities');
  const components = yaml.parse(fs.readFileSync(path.join(capabilityRoot, 'components.yaml'), 'utf8'));
  const surfaces = yaml.parse(fs.readFileSync(path.join(capabilityRoot, 'surfaces.yaml'), 'utf8'));
  const catalog = loadCapabilityCatalog(REPO_ROOT);

  validateSurfaceDocument(surfaces, components);
  assertPass(
    'every resolved component exposes a closed surface class',
    catalog.components.every((component) => ['core', 'module', 'sidecar', 'candidate', 'compatibility'].includes(component.surface_class)),
  );
  assertPass(
    'every standalone surface path exists',
    catalog.standaloneSurfaces.every((surface) => surface.paths.every((surfacePath) => fs.existsSync(path.join(REPO_ROOT, surfacePath)))),
  );

  const invalidCases = [
    ['missing component coverage', { ...surfaces, component_classes: { ...surfaces.component_classes, 'runtime:state': undefined } }],
    ['baseline demotion', { ...surfaces, component_classes: { ...surfaces.component_classes, 'baseline:governance': 'module' } }],
    [
      'unsafe standalone path',
      {
        ...surfaces,
        standalone_surfaces: [{ ...surfaces.standalone_surfaces[0], paths: ['../escape'] }, ...surfaces.standalone_surfaces.slice(1)],
      },
    ],
    [
      'classification and id mismatch',
      {
        ...surfaces,
        standalone_surfaces: [{ ...surfaces.standalone_surfaces[0], classification: 'sidecar' }, ...surfaces.standalone_surfaces.slice(1)],
      },
    ],
  ];
  delete invalidCases[0][1].component_classes['runtime:state'];
  for (const [label, document] of invalidCases) {
    let rejected = false;
    try {
      validateSurfaceDocument(document, components);
    } catch {
      rejected = true;
    }
    assertPass(`surface lifecycle rejects ${label}`, rejected);
  }
}

function testCatalogLoadsProfilesAndComponents() {
  const catalog = loadCapabilityCatalog(REPO_ROOT);
  const profileIds = Object.keys(catalog.profiles);
  const componentIds = catalog.components.map((component) => component.id);
  const skillComponents = catalog.components.filter((component) => component.family === 'skill');

  assertPass(
    'catalog exposes expected capability profiles',
    profileIds.includes('developer') && profileIds.includes('full'),
    profileIds.join(','),
  );
  assertPass('developer is the default capability profile', catalog.profiles.developer?.default === true);
  assertPass('catalog exposes required baseline governance component', componentIds.includes('baseline:governance'));
  assertPass('catalog generates synthetic skill components', skillComponents.length >= 40, String(skillComponents.length));
}

function testSchemaV2FailsClosed() {
  const profiles = yaml.parse(fs.readFileSync(path.join(REPO_ROOT, '.enterprise', 'governance', 'capabilities', 'profiles.yaml'), 'utf8'));
  const components = yaml.parse(
    fs.readFileSync(path.join(REPO_ROOT, '.enterprise', 'governance', 'capabilities', 'components.yaml'), 'utf8'),
  );
  const catalog = loadCapabilityCatalog(REPO_ROOT);

  assertPass('catalog is validated as capability schema v2', catalog.schemaVersion === '2.0', catalog.schemaVersion);
  assertPass(
    'profiles do not duplicate the resolver-injected baseline',
    Object.values(catalog.profiles).every((profile) => !(profile.components || []).some((id) => REQUIRED_BASELINE_IDS.includes(id))),
  );

  const invalidCases = [
    ['legacy schema version', { ...profiles, schema_version: '1.0' }, components],
    [
      'missing mandatory baseline',
      profiles,
      {
        ...components,
        components: components.components.map((component) =>
          component.id === 'baseline:governance' ? { ...component, required: false } : component,
        ),
      },
    ],
    [
      'baseline repeated inside a profile',
      {
        ...profiles,
        profiles: {
          ...profiles.profiles,
          minimal: {
            ...profiles.profiles.minimal,
            components: [...profiles.profiles.minimal.components, 'baseline:governance'],
          },
        },
      },
      components,
    ],
    [
      'hosted profile with a phantom model provider',
      {
        ...profiles,
        profiles: {
          ...profiles.profiles,
          'agent-codex-delegated-candidate': {
            ...profiles.profiles['agent-codex-delegated-candidate'],
            agent: {
              ...profiles.profiles['agent-codex-delegated-candidate'].agent,
              model_provider_id: 'model:delegated-runtime',
            },
          },
        },
      },
      components,
    ],
    [
      'kernel profile without a model provider',
      {
        ...profiles,
        profiles: {
          ...profiles.profiles,
          'agent-reference': {
            ...profiles.profiles['agent-reference'],
            agent: {
              execution_mode: 'kernel',
              runtime_provider_id: 'runtime:hseos-kernel',
              secret_refs: [],
            },
          },
        },
      },
      components,
    ],
    [
      'kernel profile with a delegated runtime provider',
      {
        ...profiles,
        profiles: {
          ...profiles.profiles,
          'agent-reference': {
            ...profiles.profiles['agent-reference'],
            agent: {
              ...profiles.profiles['agent-reference'].agent,
              runtime_provider_id: 'runtime:codex-app-server',
            },
          },
        },
      },
      components,
    ],
    [
      'unknown component field',
      profiles,
      { ...components, components: [{ ...components.components[0], typo_field: true }, ...components.components.slice(1)] },
    ],
    [
      'malformed hook profile id',
      profiles,
      { ...components, hook_profiles: { ...components.hook_profiles, '../bad': { description: 'bad', blocking_default: false } } },
    ],
    [
      'arbitrary hook blocking mode',
      profiles,
      {
        ...components,
        hook_profiles: {
          ...components.hook_profiles,
          standard: { ...components.hook_profiles.standard, blocking_default: 'definitely-not-a-mode' },
        },
      },
    ],
    [
      'Windows absolute install path on POSIX',
      profiles,
      {
        ...components,
        components: [
          { ...components.components[0], install_paths: [...components.components[0].install_paths, String.raw`C:\Windows\escape`] },
          ...components.components.slice(1),
        ],
      },
    ],
    [
      'Windows UNC install path on POSIX',
      profiles,
      {
        ...components,
        components: [
          { ...components.components[0], install_paths: [...components.components[0].install_paths, String.raw`\\server\share`] },
          ...components.components.slice(1),
        ],
      },
    ],
    [
      'Windows root-relative install path on POSIX',
      profiles,
      {
        ...components,
        components: [
          { ...components.components[0], install_paths: [...components.components[0].install_paths, String.raw`\Windows\escape`] },
          ...components.components.slice(1),
        ],
      },
    ],
    [
      'Windows device install path on POSIX',
      profiles,
      {
        ...components,
        components: [
          { ...components.components[0], install_paths: [...components.components[0].install_paths, String.raw`\??\C:\Windows\escape`] },
          ...components.components.slice(1),
        ],
      },
    ],
  ];

  for (const [label, profileDocument, componentDocument] of invalidCases) {
    let rejected = false;
    try {
      validateCapabilityDocuments(profileDocument, componentDocument);
    } catch {
      rejected = true;
    }
    assertPass(`schema v2 rejects ${label}`, rejected);
  }

  for (const inheritedName of ['constructor', 'toString', '__proto__']) {
    let profileRejected = false;
    let hookRejected = false;
    try {
      resolveCapabilityPlan({ root: REPO_ROOT, profile: inheritedName });
    } catch {
      profileRejected = true;
    }
    try {
      resolveCapabilityPlan({ root: REPO_ROOT, hookProfile: inheritedName });
    } catch {
      hookRejected = true;
    }
    assertPass(`resolver rejects inherited profile key ${inheritedName}`, profileRejected);
    assertPass(`resolver rejects inherited hook key ${inheritedName}`, hookRejected);
  }
}

async function testCanonicalCapabilitySourceAndCompatibility() {
  const canonical = path.join(REPO_ROOT, '.enterprise', 'governance', 'capabilities');
  const compiled = path.join(REPO_ROOT, '.agents', 'capabilities');
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-capability-source-'));

  try {
    for (const fileName of ['README.md', 'profiles.yaml', 'components.yaml', 'surfaces.yaml']) {
      assertPass(
        `compiled capability ${fileName} matches its canonical source`,
        fs.readFileSync(path.join(canonical, fileName), 'utf8') === fs.readFileSync(path.join(compiled, fileName), 'utf8'),
      );
    }

    await fs.copy(canonical, path.join(tempRoot, '.enterprise', 'governance', 'capabilities'));
    await fs.copy(compiled, path.join(tempRoot, '.agents', 'capabilities'));
    await fs.copy(path.join(REPO_ROOT, '.agents', 'manifest.yaml'), path.join(tempRoot, '.agents', 'manifest.yaml'));
    await fs.writeFile(path.join(tempRoot, '.agents', 'capabilities', 'profiles.yaml'), 'schema_version: "invalid"\n');
    const canonicalCatalog = loadCapabilityCatalog(tempRoot);
    assertPass('catalog prefers the complete canonical source', canonicalCatalog.sourceKind === 'canonical');

    const targetCanonical = path.join(tempRoot, '.enterprise', 'governance', 'capabilities');
    await fs.remove(path.join(targetCanonical, 'surfaces.yaml'));
    let incompleteCanonicalRejected = false;
    try {
      await syncCapabilityCatalog(tempRoot, tempRoot);
    } catch (error) {
      incompleteCanonicalRejected = /incomplete/.test(error.message);
    }
    assertPass('compiler never synthesizes missing lifecycle metadata for a canonical source', incompleteCanonicalRejected);
    await fs.copyFile(path.join(canonical, 'surfaces.yaml'), path.join(targetCanonical, 'surfaces.yaml'));

    await fs.remove(path.join(tempRoot, '.enterprise'));
    for (const fileName of ['README.md', 'profiles.yaml', 'components.yaml']) {
      await fs.copyFile(path.join(canonical, fileName), path.join(tempRoot, '.agents', 'capabilities', fileName));
    }
    await fs.remove(path.join(tempRoot, '.agents', 'capabilities', 'surfaces.yaml'));
    const compatibilityCatalog = loadCapabilityCatalog(tempRoot);
    assertPass(
      'catalog supports a true legacy compiled-only installation without surfaces',
      compatibilityCatalog.sourceKind === 'compiled-legacy-compatibility' &&
        compatibilityCatalog.components
          .filter((component) => !component.required && !component.synthetic)
          .every((component) => component.surface_class === 'compatibility'),
    );

    const syncResult = await syncCapabilityCatalog(tempRoot, tempRoot);
    assertPass(
      'compiler upgrades a legacy generated catalog instead of returning early',
      syncResult.mode === 'legacy-generated-source' && fs.existsSync(path.join(tempRoot, '.agents', 'capabilities', 'surfaces.yaml')),
    );
    const upgradedCatalog = loadCapabilityCatalog(tempRoot);
    assertPass('upgraded compiled catalog passes the strict surface contract', upgradedCatalog.sourceKind === 'compiled-compatibility');
  } finally {
    await fs.remove(tempRoot);
  }
}

function testProfilesReferenceKnownComponents() {
  const catalog = loadCapabilityCatalog(REPO_ROOT);
  const componentIds = new Set(catalog.components.map((component) => component.id));
  const unknown = [];

  for (const [profileId, profile] of Object.entries(catalog.profiles)) {
    for (const componentId of profile.components || []) {
      if (!componentIds.has(componentId)) {
        unknown.push(`${profileId}:${componentId}`);
      }
    }
  }

  assertPass('all profiles reference known components', unknown.length === 0, unknown.join(','));
}

function testComponentsReferenceKnownSkills() {
  const catalog = loadCapabilityCatalog(REPO_ROOT);
  const skillIds = new Set(catalog.skills.map((skill) => skill.id));
  const unknown = [];

  for (const component of catalog.components) {
    for (const skillId of component.skills || []) {
      if (!skillIds.has(skillId)) {
        unknown.push(`${component.id}:${skillId}`);
      }
    }
  }

  assertPass('all capability components reference known skills', unknown.length === 0, unknown.join(','));
}

function testEverySkillHasCapabilityFamilyHome() {
  const catalog = loadCapabilityCatalog(REPO_ROOT);
  const familySkills = new Set(
    catalog.components.filter((component) => component.family === 'capability').flatMap((component) => component.skills || []),
  );
  const orphans = catalog.skills.map((skill) => skill.id).filter((id) => !familySkills.has(id));

  assertPass(
    'every governed skill belongs to at least one capability-family component',
    orphans.length === 0,
    `orphans: ${orphans.join(',')}`,
  );
}

function testPrerequisitesAreWellFormed() {
  const catalog = loadCapabilityCatalog(REPO_ROOT);
  const malformed = catalog.components.filter(
    (component) =>
      component.prerequisites !== undefined &&
      (!Array.isArray(component.prerequisites) || component.prerequisites.some((entry) => typeof entry !== 'string' || !entry.trim())),
  );
  assertPass(
    'component prerequisites are non-empty string lists when declared',
    malformed.length === 0,
    malformed.map((component) => component.id).join(','),
  );

  const plan = resolveCapabilityPlan({ root: REPO_ROOT, profile: 'full' });
  const adoComponent = plan.components.find((component) => component.id === 'capability:ado');
  assertPass(
    'resolved plan carries prerequisites through to components',
    Array.isArray(adoComponent?.prerequisites) && adoComponent.prerequisites.length > 0,
    JSON.stringify(adoComponent),
  );
}

function testResolveProfilePlan() {
  const plan = resolveCapabilityPlan({ root: REPO_ROOT, profile: 'minimal' });
  const componentIds = plan.components.map((component) => component.id);

  assertPass('minimal profile resolves advisory hook profile', plan.hook_profile === 'advisory', plan.hook_profile);
  assertPass('profile plan preserves required governance baseline', componentIds.includes('baseline:governance'));
  assertPass(
    'profile plan resolves tool targets',
    plan.tools.includes('codex') && plan.tools.includes('claude-code'),
    plan.tools.join(','),
  );
}

function testFullProfileSelectsEveryAdapterEmitter() {
  const plan = resolveCapabilityPlan({ root: REPO_ROOT, profile: 'full' });
  assertPass('full profile activates the Goose emitter', plan.tools.includes('goose'), plan.tools.join(','));
}

function testResolveSkillOnlyPlan() {
  const plan = resolveCapabilityPlan({ root: REPO_ROOT, skills: ['pr-review'], hookProfile: 'strict' });
  const componentIds = plan.components.map((component) => component.id);

  assertPass('skill-only plan includes requested skill', plan.skills.includes('pr-review'), plan.skills.join(','));
  assertPass('skill-only plan includes synthetic skill component', componentIds.includes('skill:pr-review'), componentIds.join(','));
  assertPass('skill-only plan still includes required baseline', componentIds.includes('baseline:governance'));
  assertPass('skill-only plan accepts hook profile override', plan.hook_profile === 'strict', plan.hook_profile);
}

function testEquivalentSelectionsResolveDeterministically() {
  const left = resolveCapabilityPlan({
    root: REPO_ROOT,
    components: ['capability:security', 'runtime:state'],
    skills: ['rfc', 'pr-review'],
  });
  const right = resolveCapabilityPlan({
    root: REPO_ROOT,
    components: ['runtime:state', 'capability:security'],
    skills: ['pr-review', 'rfc'],
  });
  assertPass('equivalent selector sets resolve byte-equivalent plans', JSON.stringify(left) === JSON.stringify(right));
}

function testAdapterMatrix() {
  const adapters = loadAdapterMatrix(REPO_ROOT);
  const ids = adapters.map((adapter) => adapter.id);
  const codex = adapters.find((adapter) => adapter.id === 'codex');

  assertPass('adapter matrix includes Codex and Claude Code', ids.includes('codex') && ids.includes('claude-code'), ids.join(','));
  assertPass(
    'Codex adapter records portable hook metadata',
    codex?.hooks?.native === false && Boolean(codex?.hooks?.note),
    JSON.stringify(codex),
  );
}

function testInstallPlanJsonIsMachineReadable() {
  for (const selector of ['--list-profiles', '--list-components', '--list-skills', '--adapters']) {
    const result = spawnSync(process.execPath, [HSEOS_CLI, 'install-plan', '--directory', REPO_ROOT, selector, '--json'], {
      encoding: 'utf8',
    });
    let parsed = null;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      parsed = null;
    }
    assertPass(
      `install-plan ${selector} emits undecorated JSON`,
      result.status === 0 && parsed !== null,
      `status=${result.status} stdout=${JSON.stringify(result.stdout.slice(0, 80))}`,
    );
  }
}

function testInstallPlanUsesDistributedCatalogOutsideRepository() {
  const emptyProject = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-install-plan-empty-'));
  try {
    const result = spawnSync(process.execPath, [HSEOS_CLI, 'install-plan', '--components', 'runtime:managed-governance-client', '--json'], {
      cwd: emptyProject,
      encoding: 'utf8',
      env: { ...process.env, HSEOS_DISABLE_UPDATE_CHECK: '1' },
    });
    let parsed = null;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      parsed = null;
    }
    assertPass(
      'install-plan resolves the distributed catalog from an empty consumer repository',
      result.status === 0 && parsed?.plan?.components?.some((component) => component.id === 'runtime:managed-governance-client'),
      `status=${result.status} stderr=${JSON.stringify(result.stderr.slice(0, 160))}`,
    );
  } finally {
    fs.removeSync(emptyProject);
  }
}

async function testCompilerMaterializesAdapterMatrix() {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-adapter-matrix-'));
  try {
    const hseosDir = path.join(target, '.hseos');
    await fs.ensureDir(hseosDir);
    const compiler = new AgentCoreCompiler();
    await compiler.compile(target, hseosDir, { sourceRoot: REPO_ROOT, platforms: [] });
    const adapterIds = loadAdapterMatrix(target).map((adapter) => adapter.id);
    assertPass(
      'compiler materializes the portable adapter matrix for consumers',
      ['claude-code', 'codex', 'goose'].every((id) => adapterIds.includes(id)),
      adapterIds.join(','),
    );
  } finally {
    await fs.remove(target);
  }
}

function testInstallCommandOptions() {
  const optionFlags = installCommand.options.map((option) => option[0]).join('\n');
  assertPass('install command exposes capability profile option', optionFlags.includes('--profile <id>'));
  assertPass('install command exposes capability component option', optionFlags.includes('--components <ids>'));
  assertPass('install command exposes skill selector option', optionFlags.includes('--skills <ids>'));
  assertPass('install command exposes hook profile option', optionFlags.includes('--hook-profile <id>'));
}

function testExtrasArePureOptIn() {
  const catalog = loadCapabilityCatalog(REPO_ROOT);
  const extras = catalog.components.filter((component) => component.family === 'extra');
  assertPass(
    'catalog exposes the four installer extras',
    ['extra:rtk', 'extra:usage-dashboard', 'extra:second-brain', 'extra:git-hooks'].every((id) =>
      extras.some((component) => component.id === id),
    ),
    extras.map((component) => component.id).join(','),
  );
  assertPass(
    'every extra declares prerequisites',
    extras.every((component) => Array.isArray(component.prerequisites) && component.prerequisites.length > 0),
  );

  const offenders = [];
  for (const [profileId, profile] of Object.entries(catalog.profiles)) {
    for (const componentId of profile.components || []) {
      if (componentId.startsWith('extra:')) offenders.push(`${profileId}:${componentId}`);
    }
  }
  assertPass('no profile bundles an extra (pure opt-in invariant)', offenders.length === 0, offenders.join(','));
}

function testManagedGovernanceSurfacesArePureOptIn() {
  const catalog = loadCapabilityCatalog(REPO_ROOT);
  const component = catalog.components.find((entry) => entry.id === 'runtime:managed-governance-client');
  assertPass(
    'managed governance client is an opt-in module with bounded package paths',
    component?.surface_class === 'module' &&
      component.modules.length === 0 &&
      component.install_paths.includes('packages/managed-governance-contracts/') &&
      component.install_paths.includes('packages/managed-governance-client/'),
    JSON.stringify(component),
  );

  const bundled = Object.entries(catalog.profiles)
    .filter(([, profile]) => profile.components.includes('runtime:managed-governance-client'))
    .map(([profileId]) => profileId);
  assertPass('no profile activates managed governance implicitly', bundled.length === 0, bundled.join(','));

  const portablePlan = resolveCapabilityPlan({ root: REPO_ROOT, profile: 'developer' });
  const managedPlan = resolveCapabilityPlan({ root: REPO_ROOT, components: ['runtime:managed-governance-client'] });
  assertPass(
    'portable plan omits managed surfaces unless explicitly selected',
    !portablePlan.components.some((entry) => entry.id === 'runtime:managed-governance-client') &&
      managedPlan.components.some((entry) => entry.id === 'runtime:managed-governance-client'),
  );

  const lifecycle = new Map(catalog.standaloneSurfaces.map((surface) => [surface.id, surface]));
  const preflight = lifecycle.get('candidate:managed-governance-preflight');
  const controlPlane = lifecycle.get('sidecar:managed-governance-control-plane');
  const consoleSurface = lifecycle.get('sidecar:managed-governance-console');
  assertPass(
    'preflight remains a pre-activation candidate',
    preflight?.classification === 'candidate' && preflight.disposition === 'pre-activation',
    JSON.stringify(preflight),
  );
  assertPass(
    'control plane and console remain opt-in sidecars',
    [controlPlane, consoleSurface].every((surface) => surface?.classification === 'sidecar' && surface.disposition === 'opt-in'),
    JSON.stringify([controlPlane, consoleSurface]),
  );
}

function testApplyExtrasFromPlanMapsFlags() {
  const { applyExtrasFromPlan } = installCommand;
  const plan = resolveCapabilityPlan({ root: REPO_ROOT, components: ['extra:rtk', 'extra:usage-dashboard', 'extra:second-brain'] });

  const options = {};
  const notes = applyExtrasFromPlan(options, plan);
  assertPass('extra:rtk selection activates the rtk flag', options.rtk === true);
  assertPass('extra:usage-dashboard selection defaults to local mode', options.usageDashboard === 'local');
  assertPass(
    'extra:second-brain without path yields an advisory note',
    notes.some((note) => note.includes('second-brain')),
    notes.join(' | '),
  );

  const explicit = { rtk: false, usageDashboard: 'docker' };
  applyExtrasFromPlan(explicit, plan);
  assertPass('explicit flags always win over component selection', explicit.rtk === false && explicit.usageDashboard === 'docker');
}

async function testEveryProfileMaterializesExactlySelectedSkills() {
  const catalog = loadCapabilityCatalog(REPO_ROOT);
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-capability-v2-'));

  try {
    for (const profileId of Object.keys(catalog.profiles).sort()) {
      const target = path.join(tempRoot, profileId);
      const hseosDir = path.join(target, '.hseos');
      await fs.ensureDir(hseosDir);
      const plan = resolveCapabilityPlan({ root: REPO_ROOT, profile: profileId });
      const compiler = new AgentCoreCompiler();
      const result = await compiler.compile(target, hseosDir, {
        sourceRoot: REPO_ROOT,
        platforms: plan.tools,
        selectedSkills: plan.skills,
      });
      const emittedManifest = yaml.parse(await fs.readFile(path.join(target, result.manifest), 'utf8'));
      assertPass(
        `${profileId} compiler materializes the canonical capability catalog`,
        (await fs.readFile(path.join(target, '.agents', 'capabilities', 'profiles.yaml'), 'utf8')) ===
          (await fs.readFile(path.join(REPO_ROOT, '.enterprise', 'governance', 'capabilities', 'profiles.yaml'), 'utf8')),
      );
      const emittedManifestSkills = (emittedManifest.skills || []).map((skill) => skill.name).sort();
      const selectedAdapters = plan.components
        .filter((component) => component.family === 'adapter')
        .map((component) => component.id.slice('adapter:'.length))
        .sort();
      const emittedAdapters = [...(emittedManifest.platforms || [])].sort();
      const skillsDir = path.join(target, '.agents', 'skills');
      const emittedDirectorySkills = (await fs.readdir(skillsDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      const emittedSkillFiles = [];
      for (const skillId of emittedDirectorySkills) {
        for (const fileName of await fs.readdir(path.join(skillsDir, skillId))) {
          emittedSkillFiles.push(path.posix.join('.agents', 'skills', skillId, fileName));
        }
      }
      emittedSkillFiles.sort();
      const expectedSkillFiles = plan.skills
        .flatMap((skillId) => {
          const skill = catalog.skills.find((entry) => entry.id === skillId);
          return [skill.output, skill.quick_output].filter(Boolean);
        })
        .sort();

      assertPass(
        `${profileId} manifest skills equal selected skills`,
        JSON.stringify(emittedManifestSkills) === JSON.stringify(plan.skills),
        `selected=${plan.skills.join(',')} emitted=${emittedManifestSkills.join(',')}`,
      );
      assertPass(
        `${profileId} emitted adapters equal selected adapters`,
        JSON.stringify(emittedAdapters) === JSON.stringify(selectedAdapters),
        `selected=${selectedAdapters.join(',')} emitted=${emittedAdapters.join(',')}`,
      );
      assertPass(
        `${profileId} filesystem skills equal selected skills`,
        JSON.stringify(emittedDirectorySkills) === JSON.stringify(plan.skills),
        `selected=${plan.skills.join(',')} emitted=${emittedDirectorySkills.join(',')}`,
      );
      assertPass(
        `${profileId} emitted skill files equal planned install paths`,
        JSON.stringify(emittedSkillFiles) === JSON.stringify(expectedSkillFiles),
        `planned=${expectedSkillFiles.join(',')} emitted=${emittedSkillFiles.join(',')}`,
      );
      assertPass(
        `${profileId} retains the exact mandatory baseline`,
        JSON.stringify(
          plan.components
            .filter((component) => component.required)
            .map((component) => component.id)
            .sort(),
        ) === JSON.stringify([...REQUIRED_BASELINE_IDS].sort()),
      );
    }

    const updateTarget = path.join(tempRoot, 'profile-update');
    const updateHseosDir = path.join(updateTarget, '.hseos');
    await fs.ensureDir(updateHseosDir);
    const compiler = new AgentCoreCompiler();
    const fullPlan = resolveCapabilityPlan({ root: REPO_ROOT, profile: 'full' });
    await compiler.compile(updateTarget, updateHseosDir, {
      sourceRoot: REPO_ROOT,
      platforms: fullPlan.tools,
      selectedSkills: fullPlan.skills,
    });
    assertPass('full profile materializes the selected Goose surface', await fs.pathExists(path.join(updateTarget, '.goose')));
    const minimalPlan = resolveCapabilityPlan({ root: REPO_ROOT, profile: 'minimal' });
    await compiler.compile(updateTarget, updateHseosDir, {
      sourceRoot: REPO_ROOT,
      platforms: minimalPlan.tools,
      selectedSkills: minimalPlan.skills,
    });
    const remainingSkills = (await fs.readdir(path.join(updateTarget, '.agents', 'skills'), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    assertPass('profile downgrade removes previously emitted unselected skills', remainingSkills.length === 0, remainingSkills.join(','));
    assertPass(
      'profile downgrade removes the previously compiler-owned Goose surface',
      !(await fs.pathExists(path.join(updateTarget, '.goose'))),
    );
  } finally {
    await fs.remove(tempRoot);
  }
}

async function run() {
  testCatalogLoadsProfilesAndComponents();
  testSchemaV2FailsClosed();
  testSurfaceLifecycleFailsClosed();
  await testCanonicalCapabilitySourceAndCompatibility();
  testProfilesReferenceKnownComponents();
  testComponentsReferenceKnownSkills();
  testEverySkillHasCapabilityFamilyHome();
  testPrerequisitesAreWellFormed();
  testResolveProfilePlan();
  testFullProfileSelectsEveryAdapterEmitter();
  testResolveSkillOnlyPlan();
  testEquivalentSelectionsResolveDeterministically();
  testAdapterMatrix();
  testInstallPlanJsonIsMachineReadable();
  testInstallPlanUsesDistributedCatalogOutsideRepository();
  await testCompilerMaterializesAdapterMatrix();
  testInstallCommandOptions();
  testExtrasArePureOptIn();
  testManagedGovernanceSurfacesArePureOptIn();
  testApplyExtrasFromPlanMapsFlags();
  await testEveryProfileMaterializesExactlySelectedSkills();

  console.log(`\nCapability catalog tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error('  FAIL', error && error.stack ? error.stack : error);
  process.exit(1);
});
