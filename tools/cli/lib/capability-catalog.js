const fs = require('node:fs');
const path = require('node:path');
const yaml = require('yaml');
const { getProjectRoot } = require('./project-root');

const CAPABILITY_DIR = path.join('.agents', 'capabilities');
const PROFILES_FILE = 'profiles.yaml';
const COMPONENTS_FILE = 'components.yaml';
const AGENT_MANIFEST = path.join('.agents', 'manifest.yaml');
const ADAPTERS_DIR = path.join('.agents', 'adapters');
const CAPABILITY_SCHEMA_VERSION = '2.0';
const REQUIRED_BASELINE_IDS = ['baseline:governance', 'baseline:entrypoints', 'baseline:skills-registry'];
const PROFILE_KEYS = new Set(['name', 'description', 'default', 'hook_profile', 'components', 'agent']);
const AGENT_PROFILE_KEYS = new Set(['execution_mode', 'model_provider_id', 'runtime_provider_id', 'secret_refs']);
const COMPONENT_KEYS = new Set([
  'id',
  'family',
  'name',
  'description',
  'required',
  'prerequisites',
  'modules',
  'tools',
  'skills',
  'install_paths',
]);

function uniq(values) {
  return [...new Set((values || []).map((value) => String(value).trim()).filter(Boolean))];
}

function parseCsv(value) {
  if (!value) return [];
  if (Array.isArray(value)) return uniq(value);
  return uniq(String(value).split(','));
}

function readYaml(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) return fallback;
  const parsed = yaml.parse(fs.readFileSync(filePath, 'utf8'));
  return parsed || fallback;
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid capability schema v2: ${label} must be an object`);
  }
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertExactKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`Invalid capability schema v2: ${label} has unknown field(s): ${unknown.join(', ')}`);
  }
}

function assertStringList(value, label, { required = false } = {}) {
  if (value === undefined && !required) return;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new Error(`Invalid capability schema v2: ${label} must be a list of non-empty strings`);
  }
  if (new Set(value).size !== value.length) {
    throw new Error(`Invalid capability schema v2: ${label} contains duplicate values`);
  }
}

function validateCapabilityDocuments(profileData, componentData) {
  assertObject(profileData, 'profiles document');
  assertObject(componentData, 'components document');
  assertExactKeys(profileData, new Set(['schema_version', 'profiles']), 'profiles document');
  assertExactKeys(componentData, new Set(['schema_version', 'component_families', 'hook_profiles', 'components']), 'components document');

  if (String(profileData.schema_version) !== CAPABILITY_SCHEMA_VERSION) {
    throw new Error(`Unsupported capability profiles schema: ${profileData.schema_version || 'missing'} (expected 2.0)`);
  }
  if (String(componentData.schema_version) !== CAPABILITY_SCHEMA_VERSION) {
    throw new Error(`Unsupported capability components schema: ${componentData.schema_version || 'missing'} (expected 2.0)`);
  }

  assertObject(profileData.profiles, 'profiles');
  assertObject(componentData.hook_profiles, 'hook_profiles');
  assertStringList(componentData.component_families, 'component_families', { required: true });
  if (!Array.isArray(componentData.components) || componentData.components.length === 0) {
    throw new Error('Invalid capability schema v2: components must be a non-empty list');
  }

  for (const [hookProfileId, hookProfile] of Object.entries(componentData.hook_profiles)) {
    if (!/^[a-z][a-z0-9-]*$/.test(hookProfileId)) {
      throw new Error(`Invalid capability schema v2: malformed hook profile id ${hookProfileId}`);
    }
    assertObject(hookProfile, `hook profile ${hookProfileId}`);
    assertExactKeys(hookProfile, new Set(['description', 'blocking_default']), `hook profile ${hookProfileId}`);
    if (typeof hookProfile.description !== 'string' || !hookProfile.description.trim()) {
      throw new Error(`Invalid capability schema v2: hook profile ${hookProfileId} requires a description`);
    }
    if (typeof hookProfile.blocking_default !== 'boolean' && hookProfile.blocking_default !== 'mixed') {
      throw new Error(`Invalid capability schema v2: hook profile ${hookProfileId}.blocking_default is invalid`);
    }
  }

  const families = new Set(componentData.component_families);
  const componentIds = new Set();
  for (const [index, component] of componentData.components.entries()) {
    const label = `components[${index}]`;
    assertObject(component, label);
    assertExactKeys(component, COMPONENT_KEYS, label);
    if (typeof component.id !== 'string' || !/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/.test(component.id)) {
      throw new Error(`Invalid capability schema v2: ${label}.id is malformed`);
    }
    if (componentIds.has(component.id)) {
      throw new Error(`Invalid capability schema v2: duplicate component id ${component.id}`);
    }
    componentIds.add(component.id);
    if (!families.has(component.family) || !component.id.startsWith(`${component.family}:`)) {
      throw new Error(`Invalid capability schema v2: ${component.id} has inconsistent family ${component.family}`);
    }
    if (
      typeof component.name !== 'string' ||
      !component.name.trim() ||
      typeof component.description !== 'string' ||
      !component.description.trim()
    ) {
      throw new Error(`Invalid capability schema v2: ${component.id} requires name and description`);
    }
    if (component.required !== undefined && typeof component.required !== 'boolean') {
      throw new Error(`Invalid capability schema v2: ${component.id}.required must be boolean`);
    }
    for (const field of ['prerequisites', 'modules', 'tools', 'skills', 'install_paths']) {
      assertStringList(component[field], `${component.id}.${field}`);
    }
    for (const installPath of component.install_paths || []) {
      if (path.isAbsolute(installPath) || path.win32.isAbsolute(installPath) || installPath.split(/[\\/]/).includes('..')) {
        throw new Error(`Invalid capability schema v2: ${component.id} has unsafe install path ${installPath}`);
      }
    }
  }

  const requiredIds = componentData.components
    .filter((component) => component.required)
    .map((component) => component.id)
    .sort();
  const expectedRequiredIds = [...REQUIRED_BASELINE_IDS].sort();
  if (JSON.stringify(requiredIds) !== JSON.stringify(expectedRequiredIds)) {
    throw new Error(`Invalid capability schema v2: required baseline must be exactly ${expectedRequiredIds.join(', ')}`);
  }

  const defaultProfiles = [];
  for (const [profileId, profile] of Object.entries(profileData.profiles)) {
    if (!/^[a-z][a-z0-9-]*$/.test(profileId)) {
      throw new Error(`Invalid capability schema v2: malformed profile id ${profileId}`);
    }
    assertObject(profile, `profile ${profileId}`);
    assertExactKeys(profile, PROFILE_KEYS, `profile ${profileId}`);
    if (
      typeof profile.name !== 'string' ||
      !profile.name.trim() ||
      typeof profile.description !== 'string' ||
      !profile.description.trim()
    ) {
      throw new Error(`Invalid capability schema v2: profile ${profileId} requires name and description`);
    }
    if (profile.default !== undefined && typeof profile.default !== 'boolean') {
      throw new Error(`Invalid capability schema v2: profile ${profileId}.default must be boolean`);
    }
    if (profile.default) defaultProfiles.push(profileId);
    if (!hasOwn(componentData.hook_profiles, profile.hook_profile)) {
      throw new Error(`Invalid capability schema v2: profile ${profileId} references unknown hook profile ${profile.hook_profile}`);
    }
    assertStringList(profile.components, `profile ${profileId}.components`, { required: true });
    const repeatedBaseline = profile.components.filter((id) => REQUIRED_BASELINE_IDS.includes(id));
    if (repeatedBaseline.length > 0) {
      throw new Error(`Invalid capability schema v2: profile ${profileId} repeats injected baseline ${repeatedBaseline.join(', ')}`);
    }
    const unknown = profile.components.filter((id) => !componentIds.has(id));
    if (unknown.length > 0) {
      throw new Error(`Invalid capability schema v2: profile ${profileId} references unknown component(s): ${unknown.join(', ')}`);
    }
    if (profile.agent !== undefined) {
      assertObject(profile.agent, `profile ${profileId}.agent`);
      assertExactKeys(profile.agent, AGENT_PROFILE_KEYS, `profile ${profileId}.agent`);
      if (!['kernel', 'hosted'].includes(profile.agent.execution_mode)) {
        throw new Error(`Invalid capability schema v2: profile ${profileId}.agent.execution_mode is invalid`);
      }
      if (
        typeof profile.agent.runtime_provider_id !== 'string' ||
        !/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/.test(profile.agent.runtime_provider_id)
      ) {
        throw new Error(`Invalid capability schema v2: profile ${profileId}.agent.runtime_provider_id is malformed`);
      }
      if (profile.agent.execution_mode === 'kernel') {
        if (
          typeof profile.agent.model_provider_id !== 'string' ||
          !/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/.test(profile.agent.model_provider_id)
        ) {
          throw new Error(`Invalid capability schema v2: profile ${profileId}.agent.model_provider_id is required for kernel execution`);
        }
        if (profile.agent.runtime_provider_id !== 'runtime:hseos-kernel') {
          throw new Error(`Invalid capability schema v2: profile ${profileId}.agent kernel execution requires runtime:hseos-kernel`);
        }
      } else if (profile.agent.model_provider_id !== undefined) {
        throw new Error(`Invalid capability schema v2: profile ${profileId}.agent hosted execution cannot select a model provider`);
      }
      assertStringList(profile.agent.secret_refs, `profile ${profileId}.agent.secret_refs`, { required: true });
    }
  }
  if (defaultProfiles.length !== 1) {
    throw new Error(`Invalid capability schema v2: exactly one default profile is required (found ${defaultProfiles.length})`);
  }
}

function capabilityPaths(root = getProjectRoot()) {
  const base = path.join(root, CAPABILITY_DIR);
  return {
    base,
    profiles: path.join(base, PROFILES_FILE),
    components: path.join(base, COMPONENTS_FILE),
    manifest: path.join(root, AGENT_MANIFEST),
    adapters: path.join(root, ADAPTERS_DIR),
  };
}

function loadSkillEntries(root = getProjectRoot()) {
  const { manifest } = capabilityPaths(root);
  const manifestData = readYaml(manifest, {});
  if (Array.isArray(manifestData.skills) && manifestData.skills.length > 0) {
    return manifestData.skills
      .filter((skill) => skill && skill.name)
      .map((skill) => {
        const id = String(skill.name);
        const output = skill.output || path.join('.agents', 'skills', id, 'SKILL.md');
        return {
          id,
          source: skill.source || '',
          quick: skill.quick || '',
          output,
          quick_output: skill.quick ? path.join(path.dirname(output), 'QUICK.md') : '',
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  const skillsRoot = path.join(root, '.agents', 'skills');
  if (!fs.existsSync(skillsRoot)) return [];
  return fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      id: entry.name,
      source: '',
      quick: path.join('.agents', 'skills', entry.name, 'QUICK.md'),
      output: path.join('.agents', 'skills', entry.name, 'SKILL.md'),
      quick_output: path.join('.agents', 'skills', entry.name, 'QUICK.md'),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function buildSyntheticSkillComponents(root = getProjectRoot(), skillEntries = loadSkillEntries(root)) {
  return skillEntries.map((skill) => ({
    id: `skill:${skill.id}`,
    family: 'skill',
    name: skill.id,
    description: `Install-plan selector for the governed ${skill.id} skill.`,
    skills: [skill.id],
    install_paths: uniq([skill.output, skill.quick_output].filter(Boolean)),
    synthetic: true,
  }));
}

function loadCapabilityCatalog(root = getProjectRoot()) {
  const paths = capabilityPaths(root);
  const profileData = readYaml(paths.profiles, {});
  const componentData = readYaml(paths.components, {});
  validateCapabilityDocuments(profileData, componentData);
  const staticComponents = Array.isArray(componentData.components) ? componentData.components : [];
  const skillEntries = loadSkillEntries(root);
  const syntheticSkillComponents = buildSyntheticSkillComponents(root, skillEntries);
  const components = [...staticComponents, ...syntheticSkillComponents];
  const skillIds = new Set(skillEntries.map((skill) => skill.id));
  const duplicateComponentIds = components.map((component) => component.id).filter((id, index, ids) => ids.indexOf(id) !== index);
  if (duplicateComponentIds.length > 0) {
    throw new Error(`Invalid capability schema v2: duplicate resolved component id(s): ${uniq(duplicateComponentIds).join(', ')}`);
  }
  const unknownSkillReferences = staticComponents.flatMap((component) =>
    (component.skills || []).filter((skillId) => !skillIds.has(skillId)).map((skillId) => `${component.id}:${skillId}`),
  );
  if (unknownSkillReferences.length > 0) {
    throw new Error(`Invalid capability schema v2: unknown component skill reference(s): ${unknownSkillReferences.join(', ')}`);
  }

  return {
    root,
    schemaVersion: CAPABILITY_SCHEMA_VERSION,
    paths,
    profiles: profileData.profiles || {},
    components,
    componentFamilies: componentData.component_families || [],
    hookProfiles: componentData.hook_profiles || {},
    skills: skillEntries,
  };
}

function assertKnownProfile(catalog, profileId) {
  if (!profileId) return;
  if (!hasOwn(catalog.profiles, profileId)) {
    throw new Error(`Unknown capability profile: ${profileId}`);
  }
}

function indexById(items) {
  const map = new Map();
  for (const item of items || []) {
    if (item?.id) map.set(item.id, item);
  }
  return map;
}

function assertKnownComponents(componentMap, componentIds) {
  const unknown = componentIds.filter((id) => !componentMap.has(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown capability component(s): ${unknown.join(', ')}`);
  }
}

function assertKnownSkills(skillIds, skillEntries) {
  const known = new Set(skillEntries.map((skill) => skill.id));
  const unknown = skillIds.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown skill selector(s): ${unknown.join(', ')}`);
  }
}

function resolveCapabilityPlan(options = {}) {
  const root = path.resolve(options.root || getProjectRoot());
  const catalog = loadCapabilityCatalog(root);
  const profileId = options.profile || options.profileId || null;
  assertKnownProfile(catalog, profileId);

  const profile = profileId ? catalog.profiles[profileId] : null;
  const requestedComponents = parseCsv(options.components || options.componentIds);
  const requestedSkills = parseCsv(options.skills || options.skillIds);
  assertKnownSkills(requestedSkills, catalog.skills);

  const requiredComponentIds = catalog.components.filter((component) => component.required).map((component) => component.id);
  const componentIds = uniq([
    ...requiredComponentIds,
    ...(profile?.components || []),
    ...requestedComponents,
    ...requestedSkills.map((skill) => `skill:${skill}`),
  ]).sort();

  const componentMap = indexById(catalog.components);
  assertKnownComponents(componentMap, componentIds);

  const selectedComponents = componentIds.map((id) => componentMap.get(id));
  const selectedSkills = uniq(selectedComponents.flatMap((component) => component.skills || [])).sort();
  assertKnownSkills(selectedSkills, catalog.skills);

  const hookProfile = options.hookProfile || options.hook_profile || profile?.hook_profile || 'standard';
  if (!hasOwn(catalog.hookProfiles, hookProfile)) {
    throw new Error(`Unknown hook profile: ${hookProfile}`);
  }

  const modules = uniq(selectedComponents.flatMap((component) => component.modules || [])).sort();
  const tools = uniq([...selectedComponents.flatMap((component) => component.tools || []), ...parseCsv(options.tools)]).sort();
  const installPaths = uniq([
    ...selectedComponents.flatMap((component) => component.install_paths || []),
    ...selectedSkills.flatMap((skillId) => {
      const skill = catalog.skills.find((entry) => entry.id === skillId);
      return [skill?.output, skill?.quick_output].filter(Boolean);
    }),
  ]).sort();

  return {
    schema_version: CAPABILITY_SCHEMA_VERSION,
    profile: profileId,
    profile_name: profile?.name || null,
    hook_profile: hookProfile,
    hook_profile_description: catalog.hookProfiles[hookProfile]?.description || '',
    components: selectedComponents.map((component) => ({
      id: component.id,
      family: component.family,
      name: component.name || component.id,
      required: Boolean(component.required),
      synthetic: Boolean(component.synthetic),
      prerequisites: component.prerequisites || [],
    })),
    modules,
    tools,
    skills: selectedSkills,
    install_paths: installPaths,
    materialization: {
      mode: 'selected-only',
      selected_skills: selectedSkills,
      selected_model_providers: profile?.agent?.model_provider_id ? [profile.agent.model_provider_id] : [],
      selected_runtime_providers: profile?.agent ? [profile.agent.runtime_provider_id] : [],
      secret_refs: profile?.agent?.secret_refs || [],
    },
    agent: profile?.agent ? { ...profile.agent, secret_refs: [...profile.agent.secret_refs] } : null,
  };
}

function loadAdapterMatrix(root = getProjectRoot()) {
  const adaptersDir = capabilityPaths(root).adapters;
  if (!fs.existsSync(adaptersDir)) return [];
  return fs
    .readdirSync(adaptersDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml') && !entry.name.startsWith('_'))
    .map((entry) => {
      const file = path.join(adaptersDir, entry.name);
      const adapter = readYaml(file, {});
      const capabilities = adapter.capabilities || {};
      return {
        id: adapter.id || path.basename(entry.name, '.yaml'),
        file: path.join(ADAPTERS_DIR, entry.name),
        entrypoint: adapter.output?.entrypoint || '',
        hooks: {
          native: Array.isArray(capabilities.hooks?.events) && capabilities.hooks.events.length > 0,
          events: capabilities.hooks?.events || [],
          note: capabilities.hooks?.note || '',
        },
        subagents: capabilities.subagents || {},
        slash_commands: capabilities.slash_commands || {},
        mcp: capabilities.mcp || {},
        statusline: capabilities.statusline || {},
        fallbacks: adapter.fallbacks || {},
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function writeCapabilitySelection(projectDir, plan) {
  if (!plan) return null;
  const targetPath = path.join(path.resolve(projectDir), '.hseos', 'config', 'capability-selection.yaml');
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, yaml.stringify(plan), 'utf8');
  return targetPath;
}

module.exports = {
  CAPABILITY_SCHEMA_VERSION,
  REQUIRED_BASELINE_IDS,
  buildSyntheticSkillComponents,
  loadAdapterMatrix,
  loadCapabilityCatalog,
  parseCsv,
  resolveCapabilityPlan,
  validateCapabilityDocuments,
  writeCapabilitySelection,
};
