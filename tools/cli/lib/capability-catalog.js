const fs = require('node:fs');
const path = require('node:path');
const yaml = require('yaml');
const { getProjectRoot } = require('./project-root');

const CAPABILITY_DIR = path.join('.agents', 'capabilities');
const PROFILES_FILE = 'profiles.yaml';
const COMPONENTS_FILE = 'components.yaml';
const AGENT_MANIFEST = path.join('.agents', 'manifest.yaml');
const ADAPTERS_DIR = path.join('.agents', 'adapters');

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
      .map((skill) => ({
        id: String(skill.name),
        source: skill.source || '',
        quick: skill.quick || '',
        output: skill.output || path.join('.agents', 'skills', String(skill.name), 'SKILL.md'),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  const skillsRoot = path.join(root, '.agents', 'skills');
  if (!fs.existsSync(skillsRoot)) return [];
  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      id: entry.name,
      source: '',
      quick: path.join('.agents', 'skills', entry.name, 'QUICK.md'),
      output: path.join('.agents', 'skills', entry.name, 'SKILL.md'),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function buildSyntheticSkillComponents(root = getProjectRoot()) {
  return loadSkillEntries(root).map((skill) => ({
    id: `skill:${skill.id}`,
    family: 'skill',
    name: skill.id,
    description: `Install-plan selector for the governed ${skill.id} skill.`,
    skills: [skill.id],
    install_paths: uniq([skill.source, skill.quick, skill.output].filter(Boolean)),
    synthetic: true,
  }));
}

function loadCapabilityCatalog(root = getProjectRoot()) {
  const paths = capabilityPaths(root);
  const profileData = readYaml(paths.profiles, {});
  const componentData = readYaml(paths.components, {});
  const staticComponents = Array.isArray(componentData.components) ? componentData.components : [];
  const syntheticSkillComponents = buildSyntheticSkillComponents(root);
  const components = [...staticComponents, ...syntheticSkillComponents];

  return {
    root,
    paths,
    profiles: profileData.profiles || {},
    components,
    componentFamilies: componentData.component_families || [],
    hookProfiles: componentData.hook_profiles || {},
    skills: loadSkillEntries(root),
  };
}

function assertKnownProfile(catalog, profileId) {
  if (!profileId) return;
  if (!catalog.profiles[profileId]) {
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

  const requiredComponentIds = catalog.components
    .filter((component) => component.required)
    .map((component) => component.id);
  const componentIds = uniq([
    ...requiredComponentIds,
    ...(profile?.components || []),
    ...requestedComponents,
    ...requestedSkills.map((skill) => `skill:${skill}`),
  ]);

  const componentMap = indexById(catalog.components);
  assertKnownComponents(componentMap, componentIds);

  const selectedComponents = componentIds.map((id) => componentMap.get(id));
  const selectedSkills = uniq(selectedComponents.flatMap((component) => component.skills || []));
  assertKnownSkills(selectedSkills, catalog.skills);

  const hookProfile = options.hookProfile || options.hook_profile || profile?.hook_profile || 'standard';
  if (!catalog.hookProfiles[hookProfile]) {
    throw new Error(`Unknown hook profile: ${hookProfile}`);
  }

  const modules = uniq(selectedComponents.flatMap((component) => component.modules || []));
  const tools = uniq([
    ...selectedComponents.flatMap((component) => component.tools || []),
    ...parseCsv(options.tools),
  ]);
  const installPaths = uniq(selectedComponents.flatMap((component) => component.install_paths || []));

  return {
    version: '1.0',
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
    })),
    modules,
    tools,
    skills: selectedSkills,
    install_paths: installPaths,
  };
}

function loadAdapterMatrix(root = getProjectRoot()) {
  const adaptersDir = capabilityPaths(root).adapters;
  if (!fs.existsSync(adaptersDir)) return [];
  return fs.readdirSync(adaptersDir, { withFileTypes: true })
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
  buildSyntheticSkillComponents,
  loadAdapterMatrix,
  loadCapabilityCatalog,
  parseCsv,
  resolveCapabilityPlan,
  writeCapabilitySelection,
};
