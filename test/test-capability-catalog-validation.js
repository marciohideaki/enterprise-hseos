'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const yaml = require('yaml');

const catalog = require('../tools/cli/lib/capability-catalog');

const BASELINE = catalog.REQUIRED_BASELINE_IDS;
const CLASSIFICATIONS = ['core', 'module', 'sidecar', 'candidate', 'compatibility'];
const DISPOSITIONS = ['active', 'opt-in', 'pre-activation', 'retiring'];

function documents() {
  return {
    profiles: {
      schema_version: '2.0',
      profiles: {
        standard: {
          name: 'Standard',
          description: 'Default profile',
          default: true,
          hook_profile: 'standard',
          components: ['tool:alpha'],
        },
      },
    },
    components: {
      schema_version: '2.0',
      component_families: ['baseline', 'tool', 'skill'],
      hook_profiles: { standard: { description: 'Standard hooks', blocking_default: true } },
      components: [
        ...BASELINE.map((id) => ({ id, family: 'baseline', name: id, description: `${id} baseline`, required: true })),
        { id: 'tool:alpha', family: 'tool', name: 'Alpha', description: 'Alpha tool', tools: ['codex'], install_paths: ['.agents/alpha'] },
        { id: 'tool:beta', family: 'tool', name: 'Beta', description: 'Beta tool', depends_on: ['tool:alpha'], modules: ['m1'] },
      ],
    },
    surfaces: {
      schema_version: '1.0',
      classifications: [...CLASSIFICATIONS],
      dispositions: [...DISPOSITIONS],
      component_classes: Object.fromEntries([...BASELINE.map((id) => [id, 'core']), ['tool:alpha', 'module'], ['tool:beta', 'module']]),
      standalone_surfaces: [],
    },
  };
}

function agent(overrides) {
  return { execution_mode: 'hosted', runtime_provider_id: 'runtime:claude-code', secret_refs: [], ...overrides };
}

test('the baseline fixture is accepted, including kernel and hosted agent declarations', () => {
  const docs = documents();
  catalog.validateCapabilityDocuments(docs.profiles, docs.components);
  catalog.validateSurfaceDocument(docs.surfaces, docs.components);

  docs.profiles.profiles.standard.agent = agent();
  catalog.validateCapabilityDocuments(docs.profiles, docs.components);
  docs.profiles.profiles.standard.agent = agent({
    execution_mode: 'kernel',
    runtime_provider_id: 'runtime:hseos-kernel',
    model_provider_id: 'model:scripted',
    secret_refs: ['pass:model/key'],
  });
  catalog.validateCapabilityDocuments(docs.profiles, docs.components);
});

const DOCUMENT_REFUSALS = [
  ['a profiles document that is an array', (d) => (d.profiles = []), /profiles document must be an object/],
  ['an unknown top-level components field', (d) => (d.components.extra = 1), /components document has unknown field\(s\): extra/],
  ['a wrong profiles schema version', (d) => (d.profiles.schema_version = '1.0'), /Unsupported capability profiles schema: 1\.0/],
  ['a missing profiles schema version', (d) => delete d.profiles.schema_version, /schema: missing/],
  ['a wrong components schema version', (d) => (d.components.schema_version = '3.0'), /Unsupported capability components schema: 3\.0/],
  ['a missing components schema version', (d) => delete d.components.schema_version, /components schema: missing/],
  ['component families that repeat', (d) => d.components.component_families.push('tool'), /component_families contains duplicate values/],
  ['component families that are not a list', (d) => delete d.components.component_families, /component_families must be a list/],
  ['a blank family entry', (d) => d.components.component_families.push(' '), /component_families must be a list of non-empty strings/],
  ['an empty components list', (d) => (d.components.components = []), /components must be a non-empty list/],
  [
    'a malformed hook profile id',
    (d) => (d.components.hook_profiles.Bad = { description: 'x', blocking_default: true }),
    /malformed hook profile id Bad/,
  ],
  [
    'a hook profile with an unknown field',
    (d) => (d.components.hook_profiles.standard.extra = 1),
    /hook profile standard has unknown field/,
  ],
  [
    'a hook profile without description',
    (d) => (d.components.hook_profiles.standard.description = ' '),
    /hook profile standard requires a description/,
  ],
  [
    'a hook profile with an invalid blocking default',
    (d) => (d.components.hook_profiles.standard.blocking_default = 'yes'),
    /blocking_default is invalid/,
  ],
  ['a malformed component id', (d) => (d.components.components[3].id = 'Alpha'), /components\[3\]\.id is malformed/],
  ['a non-string component id', (d) => (d.components.components[3].id = 7), /components\[3\]\.id is malformed/],
  ['a duplicate component id', (d) => (d.components.components[4].id = 'tool:alpha'), /duplicate component id tool:alpha/],
  ['a family that is not declared', (d) => (d.components.components[3].family = 'ghost'), /inconsistent family ghost/],
  ['an id that does not start with its family', (d) => (d.components.components[3].family = 'skill'), /inconsistent family skill/],
  ['a component without a name', (d) => (d.components.components[3].name = ''), /requires name and description/],
  ['a component without a description', (d) => delete d.components.components[3].description, /requires name and description/],
  ['a non-boolean required flag', (d) => (d.components.components[3].required = 'yes'), /tool:alpha\.required must be boolean/],
  ['a non-list dependency field', (d) => (d.components.components[3].depends_on = 'x'), /tool:alpha\.depends_on must be a list/],
  ['an absolute install path', (d) => (d.components.components[3].install_paths = ['/etc/passwd']), /unsafe install path \/etc\/passwd/],
  ['a windows absolute install path', (d) => (d.components.components[3].install_paths = [String.raw`C:\x`]), /unsafe install path C:/],
  ['an install path that escapes upward', (d) => (d.components.components[3].install_paths = ['a/../../b']), /unsafe install path/],
  ['a dependency on an unknown component', (d) => (d.components.components[4].depends_on = ['tool:ghost']), /unknown component tool:ghost/],
  [
    'a dependency cycle',
    (d) => {
      d.components.components[3].depends_on = ['tool:beta'];
    },
    /dependency cycle at/,
  ],
  ['a baseline that is not required', (d) => delete d.components.components[0].required, /required baseline must be exactly/],
  ['an extra required component', (d) => (d.components.components[3].required = true), /required baseline must be exactly/],
  ['a malformed profile id', (d) => (d.profiles.profiles.Bad = d.profiles.profiles.standard), /malformed profile id Bad/],
  ['a profile with an unknown field', (d) => (d.profiles.profiles.standard.extra = 1), /profile standard has unknown field/],
  ['a profile without a name', (d) => (d.profiles.profiles.standard.name = ''), /profile standard requires name and description/],
  ['a profile without a description', (d) => delete d.profiles.profiles.standard.description, /requires name and description/],
  ['a non-boolean profile default', (d) => (d.profiles.profiles.standard.default = 'yes'), /standard\.default must be boolean/],
  ['an unknown hook profile reference', (d) => (d.profiles.profiles.standard.hook_profile = 'ghost'), /unknown hook profile ghost/],
  ['a profile without a component list', (d) => delete d.profiles.profiles.standard.components, /standard\.components must be a list/],
  [
    'a profile repeating the injected baseline',
    (d) => d.profiles.profiles.standard.components.push(BASELINE[0]),
    /repeats injected baseline baseline:governance/,
  ],
  [
    'a profile with an unknown component',
    (d) => d.profiles.profiles.standard.components.push('tool:ghost'),
    /unknown component\(s\): tool:ghost/,
  ],
  ['no default profile', (d) => (d.profiles.profiles.standard.default = false), /exactly one default profile is required \(found 0\)/],
  [
    'two default profiles',
    (d) => (d.profiles.profiles.other = { ...d.profiles.profiles.standard, name: 'Other' }),
    /exactly one default profile is required \(found 2\)/,
  ],
  ['an agent that is not an object', (d) => (d.profiles.profiles.standard.agent = 'kernel'), /standard\.agent must be an object/],
  ['an agent with an unknown field', (d) => (d.profiles.profiles.standard.agent = agent({ extra: 1 })), /agent has unknown field/],
  [
    'an agent with an invalid execution mode',
    (d) => (d.profiles.profiles.standard.agent = agent({ execution_mode: 'cloud' })),
    /execution_mode is invalid/,
  ],
  [
    'an agent with a malformed runtime provider',
    (d) => (d.profiles.profiles.standard.agent = agent({ runtime_provider_id: 'Runtime' })),
    /runtime_provider_id is malformed/,
  ],
  [
    'an agent without a runtime provider',
    (d) => (d.profiles.profiles.standard.agent = agent({ runtime_provider_id: undefined })),
    /runtime_provider_id is malformed/,
  ],
  [
    'a kernel agent without a model provider',
    (d) => (d.profiles.profiles.standard.agent = agent({ execution_mode: 'kernel', runtime_provider_id: 'runtime:hseos-kernel' })),
    /model_provider_id is required for kernel execution/,
  ],
  [
    'a kernel agent with a malformed model provider',
    (d) =>
      (d.profiles.profiles.standard.agent = agent({
        execution_mode: 'kernel',
        runtime_provider_id: 'runtime:hseos-kernel',
        model_provider_id: 'Bad',
      })),
    /model_provider_id is required for kernel execution/,
  ],
  [
    'a kernel agent on a foreign runtime',
    (d) => (d.profiles.profiles.standard.agent = agent({ execution_mode: 'kernel', model_provider_id: 'model:scripted' })),
    /kernel execution requires runtime:hseos-kernel/,
  ],
  [
    'a hosted agent that selects a model provider',
    (d) => (d.profiles.profiles.standard.agent = agent({ model_provider_id: 'model:scripted' })),
    /hosted execution cannot select a model provider/,
  ],
  [
    'an agent without secret refs',
    (d) => (d.profiles.profiles.standard.agent = agent({ secret_refs: undefined })),
    /agent\.secret_refs must be a list/,
  ],
  [
    'an agent with duplicate secret refs',
    (d) => (d.profiles.profiles.standard.agent = agent({ secret_refs: ['a', 'a'] })),
    /secret_refs contains duplicate values/,
  ],
];

for (const [name, mutate, pattern] of DOCUMENT_REFUSALS) {
  test(`capability documents refuse ${name}`, () => {
    const docs = documents();
    mutate(docs);
    assert.throws(() => catalog.validateCapabilityDocuments(docs.profiles, docs.components), pattern);
  });
}

function surface(overrides) {
  return {
    id: 'sidecar:probe',
    classification: 'sidecar',
    disposition: 'opt-in',
    contract: 'docs/probe.md',
    paths: ['tools/probe'],
    ...overrides,
  };
}

const SURFACE_REFUSALS = [
  ['a document that is not an object', (d) => (d.surfaces = null), /surface lifecycle document must be an object/],
  ['an unknown top-level field', (d) => (d.surfaces.extra = 1), /surface lifecycle document has unknown field/],
  ['a wrong schema version', (d) => (d.surfaces.schema_version = '2.0'), /Unsupported surface lifecycle schema: 2\.0/],
  ['a missing schema version', (d) => delete d.surfaces.schema_version, /schema: missing/],
  [
    'a classification outside the vocabulary',
    (d) => (d.surfaces.classifications[0] = 'exotic'),
    /classifications must declare the complete closed vocabulary/,
  ],
  [
    'an incomplete classification vocabulary',
    (d) => d.surfaces.classifications.pop(),
    /classifications must declare the complete closed vocabulary/,
  ],
  [
    'a disposition outside the vocabulary',
    (d) => (d.surfaces.dispositions[0] = 'exotic'),
    /dispositions must declare the complete closed vocabulary/,
  ],
  [
    'an incomplete disposition vocabulary',
    (d) => d.surfaces.dispositions.pop(),
    /dispositions must declare the complete closed vocabulary/,
  ],
  ['component classes that are not an object', (d) => (d.surfaces.component_classes = []), /component_classes must be an object/],
  ['a component missing from the classes', (d) => delete d.surfaces.component_classes['tool:beta'], /missing: tool:beta; unknown: none/],
  [
    'a class for an unknown component',
    (d) => (d.surfaces.component_classes['tool:ghost'] = 'module'),
    /missing: none; unknown: tool:ghost/,
  ],
  [
    'an unknown component classification',
    (d) => (d.surfaces.component_classes['tool:beta'] = 'exotic'),
    /tool:beta has unknown classification exotic/,
  ],
  [
    'a baseline that is not core',
    (d) => (d.surfaces.component_classes[BASELINE[0]] = 'module'),
    /required baseline baseline:governance must be core/,
  ],
  ['standalone surfaces that are not a list', (d) => (d.surfaces.standalone_surfaces = {}), /standalone_surfaces must be a list/],
  ['a surface that is not an object', (d) => (d.surfaces.standalone_surfaces = ['x']), /standalone_surfaces\[0\] must be an object/],
  [
    'a surface with an unknown field',
    (d) => (d.surfaces.standalone_surfaces = [surface({ extra: 1 })]),
    /standalone_surfaces\[0\] has unknown field/,
  ],
  ['a malformed surface id', (d) => (d.surfaces.standalone_surfaces = [surface({ id: 'Probe' })]), /id is malformed or duplicated/],
  [
    'a duplicated surface id',
    (d) => (d.surfaces.standalone_surfaces = [surface(), surface({ paths: ['tools/other'] })]),
    /standalone_surfaces\[1\]\.id is malformed or duplicated/,
  ],
  [
    'an invalid surface classification',
    (d) => (d.surfaces.standalone_surfaces = [surface({ classification: 'exotic' })]),
    /invalid classification or disposition/,
  ],
  [
    'an invalid surface disposition',
    (d) => (d.surfaces.standalone_surfaces = [surface({ disposition: 'exotic' })]),
    /invalid classification or disposition/,
  ],
  [
    'a surface id that disagrees with its classification',
    (d) => (d.surfaces.standalone_surfaces = [surface({ id: 'module:probe' })]),
    /does not match its classification/,
  ],
  [
    'a sidecar that is not opt-in',
    (d) => (d.surfaces.standalone_surfaces = [surface({ disposition: 'active' })]),
    /must use disposition opt-in/,
  ],
  [
    'a candidate that is not pre-activation',
    (d) => (d.surfaces.standalone_surfaces = [surface({ id: 'candidate:probe', classification: 'candidate', disposition: 'active' })]),
    /must use disposition pre-activation/,
  ],
  [
    'a compatibility surface that is not retiring',
    (d) =>
      (d.surfaces.standalone_surfaces = [surface({ id: 'compatibility:probe', classification: 'compatibility', disposition: 'active' })]),
    /must use disposition retiring/,
  ],
  ['a surface without a contract', (d) => (d.surfaces.standalone_surfaces = [surface({ contract: ' ' })]), /requires a contract/],
  [
    'a surface without paths',
    (d) => (d.surfaces.standalone_surfaces = [surface({ paths: undefined })]),
    /sidecar:probe\.paths must be a list/,
  ],
  ['an absolute surface path', (d) => (d.surfaces.standalone_surfaces = [surface({ paths: ['/etc'] })]), /unsafe path \/etc/],
  [
    'a surface path that escapes upward',
    (d) => (d.surfaces.standalone_surfaces = [surface({ paths: ['a/../b'] })]),
    /unsafe path a\/\.\.\/b/,
  ],
  [
    'a path with two owners',
    (d) => (d.surfaces.standalone_surfaces = [surface(), surface({ id: 'sidecar:other' })]),
    /path tools\/probe has multiple owners/,
  ],
];

for (const [name, mutate, pattern] of SURFACE_REFUSALS) {
  test(`the surface lifecycle document refuses ${name}`, () => {
    const docs = documents();
    mutate(docs);
    assert.throws(() => catalog.validateSurfaceDocument(docs.surfaces, docs.components), pattern);
  });
}

test('a surface list with every disposition rule satisfied is accepted', () => {
  const docs = documents();
  docs.surfaces.standalone_surfaces = [
    surface(),
    surface({ id: 'candidate:probe', classification: 'candidate', disposition: 'pre-activation', paths: ['tools/c'] }),
    surface({ id: 'compatibility:probe', classification: 'compatibility', disposition: 'retiring', paths: ['tools/k'] }),
    surface({ id: 'module:probe', classification: 'module', disposition: 'active', paths: ['tools/m'] }),
  ];
  catalog.validateSurfaceDocument(docs.surfaces, docs.components);
});

test('helpers parse csv, read yaml with fallback and synthesize the legacy surface document', () => {
  assert.deepEqual(catalog.parseCsv(''), []);
  assert.deepEqual(catalog.parseCsv(null), []);
  assert.deepEqual(catalog.parseCsv([' a ', 'b', 'a', '']), ['a', 'b']);
  assert.deepEqual(catalog.parseCsv('x, y ,,x'), ['x', 'y']);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-cap-helpers-'));
  try {
    assert.deepEqual(catalog.readYaml(path.join(dir, 'absent.yaml'), { fallback: true }), { fallback: true });
    fs.writeFileSync(path.join(dir, 'empty.yaml'), '');
    assert.deepEqual(catalog.readYaml(path.join(dir, 'empty.yaml'), { fallback: 1 }), { fallback: 1 });
    fs.writeFileSync(path.join(dir, 'real.yaml'), 'a: 1\n');
    assert.deepEqual(catalog.readYaml(path.join(dir, 'real.yaml')), { a: 1 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const docs = documents();
  const legacy = catalog.synthesizeLegacySurfaceDocument(docs.components);
  assert.equal(legacy.component_classes['tool:alpha'], 'compatibility');
  assert.equal(legacy.component_classes[BASELINE[1]], 'core');
  assert.deepEqual(catalog.synthesizeLegacySurfaceDocument({}).component_classes, {});
  catalog.validateSurfaceDocument(legacy, docs.components);
});

function writeRoot(root, { where, docs = documents(), withSurfaces = true, manifest, skillDirs = [] }) {
  const base = path.join(root, where);
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(path.join(base, 'profiles.yaml'), yaml.stringify(docs.profiles));
  fs.writeFileSync(path.join(base, 'components.yaml'), yaml.stringify(docs.components));
  if (withSurfaces) fs.writeFileSync(path.join(base, 'surfaces.yaml'), yaml.stringify(docs.surfaces));
  if (manifest) {
    fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
    fs.writeFileSync(path.join(root, '.agents', 'manifest.yaml'), yaml.stringify(manifest));
  }
  for (const name of skillDirs) {
    fs.mkdirSync(path.join(root, '.agents', 'skills', name), { recursive: true });
  }
}

async function withRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-cap-root-'));
  try {
    return await fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const CANONICAL = path.join('.enterprise', 'governance', 'capabilities');
const COMPILED = path.join('.agents', 'capabilities');

test('the catalog reads the canonical sources and takes skills from the manifest, sorted, with derived outputs', () =>
  withRoot((root) => {
    writeRoot(root, {
      where: CANONICAL,
      manifest: {
        skills: [
          { name: 'zeta', source: 'src/zeta', quick: 'q', output: 'out/zeta/SKILL.md' },
          { name: 'alpha' },
          { description: 'nameless entries are dropped' },
          null,
        ],
      },
    });
    const loaded = catalog.loadCapabilityCatalog(root);
    assert.equal(loaded.sourceKind, 'canonical');
    assert.deepEqual(
      loaded.skills.map((skill) => skill.id),
      ['alpha', 'zeta'],
    );
    const alpha = loaded.skills[0];
    assert.equal(alpha.output, path.join('.agents', 'skills', 'alpha', 'SKILL.md'));
    assert.equal(alpha.quick_output, '');
    const zeta = loaded.skills[1];
    assert.equal(zeta.quick_output, path.join('out/zeta', 'QUICK.md'));
    const synthetic = loaded.components.filter((component) => component.synthetic).map((component) => component.id);
    assert.deepEqual(synthetic, ['skill:alpha', 'skill:zeta']);
    assert.equal(loaded.components.find((component) => component.id === 'skill:alpha').surface_class, 'module');
    assert.equal(loaded.components.find((component) => component.id === 'tool:alpha').surface_class, 'module');
    assert.deepEqual(loaded.componentFamilies, ['baseline', 'tool', 'skill']);
    assert.deepEqual(loaded.standaloneSurfaces, []);
  }));

test('without a manifest the skills come from the compiled skills directory, or are empty', () =>
  withRoot((root) => {
    writeRoot(root, { where: CANONICAL });
    assert.deepEqual(catalog.loadCapabilityCatalog(root).skills, []);
    fs.mkdirSync(path.join(root, '.agents', 'skills', 'beta'), { recursive: true });
    fs.mkdirSync(path.join(root, '.agents', 'skills', 'alpha'), { recursive: true });
    fs.writeFileSync(path.join(root, '.agents', 'skills', 'not-a-skill.md'), 'file');
    const skills = catalog.loadCapabilityCatalog(root).skills;
    assert.deepEqual(
      skills.map((skill) => skill.id),
      ['alpha', 'beta'],
    );
    assert.equal(skills[0].quick, path.join('.agents', 'skills', 'alpha', 'QUICK.md'));
    assert.equal(skills[0].source, '');
  }));

test('an empty manifest skills list falls through to the directory scan', () =>
  withRoot((root) => {
    writeRoot(root, { where: CANONICAL, manifest: { skills: [] }, skillDirs: ['gamma'] });
    assert.deepEqual(
      catalog.loadCapabilityCatalog(root).skills.map((skill) => skill.id),
      ['gamma'],
    );
  }));

test('compiled compatibility sources are labelled, and a compiled tree without surfaces is the legacy form', () =>
  withRoot((root) => {
    writeRoot(root, { where: COMPILED });
    const compiled = catalog.loadCapabilityCatalog(root);
    assert.equal(compiled.sourceKind, 'compiled-compatibility');
    assert.equal(compiled.paths.base, path.join(root, COMPILED));
  }));

test('a compiled tree without surfaces synthesizes the legacy surface document', () =>
  withRoot((root) => {
    writeRoot(root, { where: COMPILED, withSurfaces: false });
    const legacy = catalog.loadCapabilityCatalog(root);
    assert.equal(legacy.sourceKind, 'compiled-legacy-compatibility');
    assert.equal(legacy.components.find((component) => component.id === 'tool:alpha').surface_class, 'compatibility');
  }));

test('an incomplete canonical directory falls back to the compiled one', () =>
  withRoot((root) => {
    const base = path.join(root, CANONICAL);
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(path.join(base, 'profiles.yaml'), 'schema_version: "9"\n');
    writeRoot(root, { where: COMPILED });
    assert.equal(catalog.loadCapabilityCatalog(root).sourceKind, 'compiled-compatibility');
  }));

test('a static skill component that collides with an installed skill is refused', () =>
  withRoot((root) => {
    const docs = documents();
    docs.components.components.push({
      id: 'skill:alpha',
      family: 'skill',
      name: 'Alpha skill',
      description: 'collides',
      skills: ['alpha'],
    });
    docs.surfaces.component_classes['skill:alpha'] = 'module';
    writeRoot(root, { where: CANONICAL, docs, skillDirs: ['alpha'] });
    assert.throws(() => catalog.loadCapabilityCatalog(root), /duplicate resolved component id\(s\): skill:alpha/);
  }));

test('a component that references a skill that is not installed is refused', () =>
  withRoot((root) => {
    const docs = documents();
    docs.components.components[3].skills = ['ghost'];
    writeRoot(root, { where: CANONICAL, docs });
    assert.throws(() => catalog.loadCapabilityCatalog(root), /unknown component skill reference\(s\): tool:alpha:ghost/);
  }));

test('invalid documents on disk are refused by the loader', () =>
  withRoot((root) => {
    const docs = documents();
    docs.surfaces.component_classes[BASELINE[2]] = 'module';
    writeRoot(root, { where: CANONICAL, docs });
    assert.throws(() => catalog.loadCapabilityCatalog(root), /required baseline baseline:skills-registry must be core/);
  }));

test('the plan resolves dependencies, selectors and agent materialization, and refuses unknown selectors', () =>
  withRoot((root) => {
    const docs = documents();
    docs.profiles.profiles.standard.components = ['tool:beta'];
    docs.profiles.profiles.hosted = {
      name: 'Hosted',
      description: 'Hosted profile',
      hook_profile: 'standard',
      components: [],
      agent: agent({ secret_refs: ['pass:a/b'] }),
    };
    docs.profiles.profiles.kernel = {
      name: 'Kernel',
      description: 'Kernel profile',
      hook_profile: 'standard',
      components: [],
      agent: agent({ execution_mode: 'kernel', runtime_provider_id: 'runtime:hseos-kernel', model_provider_id: 'model:scripted' }),
    };
    docs.profiles.profiles.kernel.agent.secret_refs = ['pass:k/v'];
    writeRoot(root, { where: CANONICAL, docs, manifest: { skills: [{ name: 'alpha' }] } });

    const plan = catalog.resolveCapabilityPlan({ root, profile: 'standard', tools: 'extra-tool', skills: ['alpha'] });
    assert.equal(plan.profile_name, 'Standard');
    assert.equal(plan.hook_profile, 'standard');
    assert.equal(plan.hook_profile_description, 'Standard hooks');
    assert.deepEqual(
      plan.components.map((component) => component.id),
      [...BASELINE, 'skill:alpha', 'tool:alpha', 'tool:beta'].sort(),
    );
    assert.deepEqual(plan.modules, ['m1']);
    assert.deepEqual(plan.tools, ['codex', 'extra-tool']);
    assert.deepEqual(plan.skills, ['alpha']);
    assert.ok(plan.install_paths.includes('.agents/alpha'));
    assert.ok(plan.install_paths.includes(path.join('.agents', 'skills', 'alpha', 'SKILL.md')));
    assert.equal(plan.agent, null);
    assert.deepEqual(plan.materialization.selected_runtime_providers, []);
    assert.equal(plan.components.find((component) => component.id === 'skill:alpha').synthetic, true);
    assert.equal(plan.components.find((component) => component.id === BASELINE[0]).required, true);

    const hosted = catalog.resolveCapabilityPlan({ root, profileId: 'hosted', componentIds: 'tool:alpha' });
    assert.deepEqual(hosted.materialization.selected_runtime_providers, ['runtime:claude-code']);
    assert.deepEqual(hosted.materialization.selected_model_providers, []);
    assert.deepEqual(hosted.materialization.secret_refs, ['pass:a/b']);
    assert.notEqual(hosted.agent.secret_refs, docs.profiles.profiles.hosted.agent.secret_refs);

    const kernel = catalog.resolveCapabilityPlan({ root, profile: 'kernel', hook_profile: 'standard' });
    assert.deepEqual(kernel.materialization.selected_model_providers, ['model:scripted']);
    assert.deepEqual(kernel.materialization.secret_refs, ['pass:k/v']);

    const bare = catalog.resolveCapabilityPlan({ root });
    assert.equal(bare.profile, null);
    assert.equal(bare.profile_name, null);
    assert.equal(bare.hook_profile, 'standard');

    assert.throws(() => catalog.resolveCapabilityPlan({ root, profile: 'ghost' }), /Unknown capability profile: ghost/);
    assert.throws(() => catalog.resolveCapabilityPlan({ root, skills: 'ghost' }), /Unknown skill selector\(s\): ghost/);
    assert.throws(() => catalog.resolveCapabilityPlan({ root, components: 'tool:ghost' }), /Unknown capability component\(s\): tool:ghost/);
    assert.throws(() => catalog.resolveCapabilityPlan({ root, hookProfile: 'ghost' }), /Unknown hook profile: ghost/);
  }));

test('the adapter matrix lists yaml adapters only, skips underscored ones and normalizes capabilities', () =>
  withRoot((root) => {
    assert.deepEqual(catalog.loadAdapterMatrix(root), []);
    const dir = path.join(root, '.agents', 'adapters');
    fs.mkdirSync(path.join(dir, 'nested.yaml'), { recursive: true });
    fs.writeFileSync(path.join(dir, '_template.yaml'), 'id: template\n');
    fs.writeFileSync(path.join(dir, 'notes.md'), 'ignored');
    fs.writeFileSync(
      path.join(dir, 'rich.yaml'),
      yaml.stringify({
        id: 'rich-id',
        output: { entrypoint: 'RICH.md' },
        capabilities: {
          hooks: { events: ['PreToolUse'], note: 'native' },
          subagents: { supported: true },
          slash_commands: { supported: true },
          mcp: { supported: true },
          statusline: { supported: false },
        },
        fallbacks: { hooks: 'wrapper' },
      }),
    );
    fs.writeFileSync(path.join(dir, 'plain.yaml'), 'capabilities:\n  hooks:\n    events: []\n');
    const matrix = catalog.loadAdapterMatrix(root);
    assert.deepEqual(
      matrix.map((entry) => entry.id),
      ['plain', 'rich-id'],
    );
    const rich = matrix[1];
    assert.equal(rich.entrypoint, 'RICH.md');
    assert.equal(rich.hooks.native, true);
    assert.deepEqual(rich.hooks.events, ['PreToolUse']);
    assert.equal(rich.hooks.note, 'native');
    assert.deepEqual(rich.fallbacks, { hooks: 'wrapper' });
    const plain = matrix[0];
    assert.equal(plain.hooks.native, false);
    assert.equal(plain.entrypoint, '');
    assert.deepEqual(plain.subagents, {});
    assert.deepEqual(plain.mcp, {});
    assert.equal(plain.file, path.join('.agents', 'adapters', 'plain.yaml'));
  }));

test('writing a capability selection is a no-op for a missing plan and persists a plan otherwise', () =>
  withRoot((root) => {
    assert.equal(catalog.writeCapabilitySelection(root, null), null);
    const target = catalog.writeCapabilitySelection(root, { schema_version: '2.0', profile: 'minimal' });
    assert.equal(target, path.join(root, '.hseos', 'config', 'capability-selection.yaml'));
    assert.deepEqual(yaml.parse(fs.readFileSync(target, 'utf8')), { schema_version: '2.0', profile: 'minimal' });
  }));

test('materialization refuses an unsupported profile, a symlinked target and an existing governance surface', async () =>
  withRoot(async (root) => {
    await assert.rejects(
      () => catalog.materializeCapabilityPlan({ directory: root, profile: 'standard' }),
      /supports minimal and disposable-engineering-candidate/,
    );

    const real = path.join(root, 'real');
    fs.mkdirSync(real);
    const link = path.join(root, 'link');
    fs.symlinkSync(real, link);
    await assert.rejects(() => catalog.materializeCapabilityPlan({ directory: link, profile: 'minimal' }), /must not traverse symlinks/);
    assert.deepEqual(fs.readdirSync(real), []);

    const occupied = path.join(root, 'occupied');
    fs.mkdirSync(occupied);
    fs.writeFileSync(path.join(occupied, 'AGENTS.md'), 'mine');
    await assert.rejects(
      () => catalog.materializeCapabilityPlan({ directory: occupied, profile: 'minimal' }),
      /requires a fresh consumer governance surface/,
    );
    assert.equal(fs.readFileSync(path.join(occupied, 'AGENTS.md'), 'utf8'), 'mine');
    assert.deepEqual(fs.readdirSync(occupied), ['AGENTS.md']);
  }));
