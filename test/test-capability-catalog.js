/**
 * Capability catalog tests
 *
 * Validates profile/component manifests, synthetic skill selectors, adapter
 * matrix loading, and installer option wiring.
 */

const path = require('node:path');
const { loadAdapterMatrix, loadCapabilityCatalog, resolveCapabilityPlan } = require('../tools/cli/lib/capability-catalog');
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

function testResolveSkillOnlyPlan() {
  const plan = resolveCapabilityPlan({ root: REPO_ROOT, skills: ['pr-review'], hookProfile: 'strict' });
  const componentIds = plan.components.map((component) => component.id);

  assertPass('skill-only plan includes requested skill', plan.skills.includes('pr-review'), plan.skills.join(','));
  assertPass('skill-only plan includes synthetic skill component', componentIds.includes('skill:pr-review'), componentIds.join(','));
  assertPass('skill-only plan still includes required baseline', componentIds.includes('baseline:governance'));
  assertPass('skill-only plan accepts hook profile override', plan.hook_profile === 'strict', plan.hook_profile);
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

function run() {
  testCatalogLoadsProfilesAndComponents();
  testProfilesReferenceKnownComponents();
  testComponentsReferenceKnownSkills();
  testEverySkillHasCapabilityFamilyHome();
  testPrerequisitesAreWellFormed();
  testResolveProfilePlan();
  testResolveSkillOnlyPlan();
  testAdapterMatrix();
  testInstallCommandOptions();
  testExtrasArePureOptIn();
  testApplyExtrasFromPlanMapsFlags();

  console.log(`\nCapability catalog tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();
