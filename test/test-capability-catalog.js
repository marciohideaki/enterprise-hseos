/**
 * Capability catalog tests
 *
 * Validates profile/component manifests, synthetic skill selectors, adapter
 * matrix loading, and installer option wiring.
 */

const path = require('node:path');
const os = require('node:os');
const fs = require('fs-extra');
const yaml = require('yaml');
const {
  REQUIRED_BASELINE_IDS,
  loadAdapterMatrix,
  loadCapabilityCatalog,
  resolveCapabilityPlan,
  validateCapabilityDocuments,
} = require('../tools/cli/lib/capability-catalog');
const { AgentCoreCompiler } = require('../tools/cli/installers/lib/core/agent-core-compiler');
const installCommand = require('../tools/cli/commands/install');

const REPO_ROOT = path.join(__dirname, '..');

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
  const profiles = yaml.parse(fs.readFileSync(path.join(REPO_ROOT, '.agents', 'capabilities', 'profiles.yaml'), 'utf8'));
  const components = yaml.parse(fs.readFileSync(path.join(REPO_ROOT, '.agents', 'capabilities', 'components.yaml'), 'utf8'));
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
  testProfilesReferenceKnownComponents();
  testComponentsReferenceKnownSkills();
  testEverySkillHasCapabilityFamilyHome();
  testPrerequisitesAreWellFormed();
  testResolveProfilePlan();
  testFullProfileSelectsEveryAdapterEmitter();
  testResolveSkillOnlyPlan();
  testEquivalentSelectionsResolveDeterministically();
  testAdapterMatrix();
  testInstallCommandOptions();
  testExtrasArePureOptIn();
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
