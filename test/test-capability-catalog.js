/**
 * Capability catalog tests
 *
 * Validates profile/component manifests, synthetic skill selectors, adapter
 * matrix loading, and installer option wiring.
 */

const path = require('node:path');
const {
  loadAdapterMatrix,
  loadCapabilityCatalog,
  resolveCapabilityPlan,
} = require('../tools/cli/lib/capability-catalog');
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

  assertPass('catalog exposes expected capability profiles', profileIds.includes('developer') && profileIds.includes('full'), profileIds.join(','));
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

function testResolveProfilePlan() {
  const plan = resolveCapabilityPlan({ root: REPO_ROOT, profile: 'minimal' });
  const componentIds = plan.components.map((component) => component.id);

  assertPass('minimal profile resolves advisory hook profile', plan.hook_profile === 'advisory', plan.hook_profile);
  assertPass('profile plan preserves required governance baseline', componentIds.includes('baseline:governance'));
  assertPass('profile plan resolves tool targets', plan.tools.includes('codex') && plan.tools.includes('claude-code'), plan.tools.join(','));
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
  assertPass('Codex adapter records portable hook metadata', codex?.hooks?.native === false && Boolean(codex?.hooks?.note), JSON.stringify(codex));
}

function testInstallCommandOptions() {
  const optionFlags = installCommand.options.map((option) => option[0]).join('\n');
  assertPass('install command exposes capability profile option', optionFlags.includes('--profile <id>'));
  assertPass('install command exposes capability component option', optionFlags.includes('--components <ids>'));
  assertPass('install command exposes skill selector option', optionFlags.includes('--skills <ids>'));
  assertPass('install command exposes hook profile option', optionFlags.includes('--hook-profile <id>'));
}

function run() {
  testCatalogLoadsProfilesAndComponents();
  testProfilesReferenceKnownComponents();
  testComponentsReferenceKnownSkills();
  testResolveProfilePlan();
  testResolveSkillOnlyPlan();
  testAdapterMatrix();
  testInstallCommandOptions();

  console.log(`\nCapability catalog tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();
