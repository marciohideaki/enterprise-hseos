const fs = require('fs-extra');
const path = require('node:path');
const yaml = require('yaml');

const POLICY_SCHEMA = {
  required: ['version', 'kind', 'name'],
  kind: 'structural_execution_policy',
};

function getFrameworkRoot() {
  return path.resolve(__dirname, '../../../..');
}

function expandPathToken(inputPath, context) {
  if (typeof inputPath !== 'string' || inputPath.trim().length === 0) {
    return inputPath;
  }

  let expanded = inputPath.replaceAll('${projectRoot}', context.projectRoot);
  expanded = expanded.replaceAll('${frameworkRoot}', context.frameworkRoot);
  expanded = expanded.replaceAll('${cwd}', context.cwd);

  if (expanded.startsWith('~/')) {
    return path.join(process.env.HOME || process.env.USERPROFILE || '', expanded.slice(2));
  }

  return expanded;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item) => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
}

function validatePolicy(policy) {
  const errors = [];

  if (policy && typeof policy === 'object' && !Array.isArray(policy)) {
    // Valid structural shape, continue with field validation below.
  } else {
    return { valid: false, errors: ['Policy file must contain a YAML object.'] };
  }

  for (const field of POLICY_SCHEMA.required) {
    if (!(field in policy)) {
      errors.push(`Missing required policy field: ${field}`);
    }
  }

  if (policy.kind && policy.kind !== POLICY_SCHEMA.kind) {
    errors.push(`Policy kind must be "${POLICY_SCHEMA.kind}"`);
  }

  if ('modules' in policy && typeof policy.modules !== 'object') {
    errors.push('Policy field "modules" must be an object');
  }

  if ('tools' in policy && typeof policy.tools !== 'object') {
    errors.push('Policy field "tools" must be an object');
  }

  if ('paths' in policy && typeof policy.paths !== 'object') {
    errors.push('Policy field "paths" must be an object');
  }

  if ('custom_content' in policy && typeof policy.custom_content !== 'object') {
    errors.push('Policy field "custom_content" must be an object');
  }

  if ('budgets' in policy && typeof policy.budgets !== 'object') {
    errors.push('Policy field "budgets" must be an object');
  }

  if ('missions' in policy && typeof policy.missions !== 'object') {
    errors.push('Policy field "missions" must be an object');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

async function loadPolicyFile(policyPath) {
  const absolutePath = path.resolve(policyPath);
  const contents = await fs.readFile(absolutePath, 'utf8');
  const policy = yaml.parse(contents);
  const validation = validatePolicy(policy);

  if (!validation.valid) {
    const error = new Error(`Invalid policy file: ${absolutePath}`);
    error.validationErrors = validation.errors;
    throw error;
  }

  return {
    path: absolutePath,
    policy,
  };
}

async function loadYamlIfExists(filePath) {
  if (!(await fs.pathExists(filePath))) {
    return null;
  }

  const contents = await fs.readFile(filePath, 'utf8');
  return yaml.parse(contents);
}

async function resolveProjectPolicy(options = {}) {
  const frameworkRoot = getFrameworkRoot();
  const projectRoot = path.resolve(options.projectDir || process.cwd());
  const cwd = process.cwd();

  const projectConfigPath = path.join(projectRoot, '.hseos/config/hseos.config.yaml');
  const frameworkConfigPath = path.join(frameworkRoot, '.hseos/config/hseos.config.yaml');

  const projectConfig = await loadYamlIfExists(projectConfigPath);
  const frameworkConfig = await loadYamlIfExists(frameworkConfigPath);
  const config = projectConfig || frameworkConfig;

  if (!config) {
    throw new Error('Unable to resolve HSEOS configuration for policy lookup.');
  }

  const packName = options.packName || config.governance?.execution_policy_pack || 'foundation';
  const configRoot = projectConfig ? projectRoot : frameworkRoot;
  const policiesRoot = config.paths?.policies || '.enterprise/policies';
  const policyPath = path.resolve(configRoot, policiesRoot, 'execution', `${packName}.policy.yaml`);

  const loaded = await loadPolicyFile(policyPath);

  return {
    ...loaded,
    packName,
    configRoot,
    context: {
      projectRoot,
      frameworkRoot,
      cwd,
    },
  };
}

function isWithinRoot(targetPath, rootPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function applySelectionRules(selection, rules, noun, violations) {
  const normalizedSelection = normalizeStringArray(selection);
  const allow = normalizeStringArray(rules.allow);
  const deny = new Set(normalizeStringArray(rules.deny));
  const hidden = new Set(normalizeStringArray(rules.hidden));

  if (Number.isInteger(rules.max_count) && normalizedSelection.length > rules.max_count) {
    violations.push(`${noun} selection exceeds max_count=${rules.max_count}`);
  }

  for (const item of normalizedSelection) {
    if (allow.length > 0 && !allow.includes(item)) {
      violations.push(`${noun} "${item}" is outside the allowed list`);
    }

    if (deny.has(item)) {
      violations.push(`${noun} "${item}" is denied by policy`);
    }

    if (hidden.has(item)) {
      violations.push(`${noun} "${item}" is hidden by policy and cannot be selected explicitly`);
    }
  }

  return normalizedSelection;
}

function applyPathRules(targets, rules, context, violations) {
  const allowedRoots = normalizeStringArray(rules.allowed_roots).map((root) => path.resolve(expandPathToken(root, context)));
  const deniedPatterns = normalizeStringArray(rules.denied_patterns);

  for (const rawTarget of normalizeStringArray(targets)) {
    const absoluteTarget = path.resolve(rawTarget);

    for (const pattern of deniedPatterns) {
      if (absoluteTarget.includes(pattern)) {
        violations.push(`Path "${absoluteTarget}" matches denied pattern "${pattern}"`);
      }
    }

    if (allowedRoots.length > 0 && !allowedRoots.some((root) => isWithinRoot(absoluteTarget, root))) {
      violations.push(`Path "${absoluteTarget}" is outside the allowed roots`);
    }
  }
}

function buildExecutionRequest(config) {
  const customSources = Array.isArray(config.customContent?.sources) ? config.customContent.sources : [];

  return {
    actionType: config.actionType || 'install',
    directory: config.directory || process.cwd(),
    modules: normalizeStringArray(config.modules),
    tools: normalizeStringArray(config.ides),
    customContentSources: customSources
      .map((source) => source?.path)
      .filter((sourcePath) => typeof sourcePath === 'string' && sourcePath.trim().length > 0),
    customContentIds: normalizeStringArray(config.customContent?.selectedModuleIds),
    mission: config.mission && typeof config.mission === 'object' ? config.mission : null,
  };
}

function normalizeMissionRequest(mission) {
  if (!mission || typeof mission !== 'object') {
    return null;
  }

  const normalizedType = typeof mission.type === 'string' && mission.type.trim().length > 0 ? mission.type.trim() : null;
  const normalizedPriority =
    typeof mission.priority === 'string' && mission.priority.trim().length > 0 ? mission.priority.trim().toLowerCase() : null;
  const normalizedOwner = typeof mission.owner === 'string' && mission.owner.trim().length > 0 ? mission.owner.trim() : null;
  const normalizedDeadline =
    typeof mission.deadlineAt === 'string' && mission.deadlineAt.trim().length > 0 ? mission.deadlineAt.trim() : null;

  return {
    type: normalizedType,
    priority: normalizedPriority,
    owner: normalizedOwner,
    deadlineAt: normalizedDeadline,
  };
}

function applyMissionRules(mission, rules, violations) {
  if (!mission) {
    return null;
  }

  const types = rules.types || {};
  const priorities = rules.priorities || {};
  const owners = rules.owners || {};
  const requireOwnerForPriorities = new Set(normalizeStringArray(rules.require_owner_for_priorities).map((entry) => entry.toLowerCase()));
  const requireDeadlineForPriorities = new Set(normalizeStringArray(rules.require_deadline_for_priorities).map((entry) => entry.toLowerCase()));

  if (mission.type) {
    const allowedTypes = normalizeStringArray(types.allow);
    const deniedTypes = new Set(normalizeStringArray(types.deny));
    if (allowedTypes.length > 0 && !allowedTypes.includes(mission.type)) {
      violations.push(`Mission type "${mission.type}" is outside the allowed list`);
    }

    if (deniedTypes.has(mission.type)) {
      violations.push(`Mission type "${mission.type}" is denied by policy`);
    }
  }

  if (mission.priority) {
    const allowedPriorities = normalizeStringArray(priorities.allow).map((entry) => entry.toLowerCase());
    const deniedPriorities = new Set(normalizeStringArray(priorities.deny).map((entry) => entry.toLowerCase()));
    if (allowedPriorities.length > 0 && !allowedPriorities.includes(mission.priority)) {
      violations.push(`Mission priority "${mission.priority}" is outside the allowed list`);
    }

    if (deniedPriorities.has(mission.priority)) {
      violations.push(`Mission priority "${mission.priority}" is denied by policy`);
    }

    if (requireOwnerForPriorities.has(mission.priority) && !mission.owner) {
      violations.push(`Mission priority "${mission.priority}" requires an owner`);
    }

    if (requireDeadlineForPriorities.has(mission.priority) && !mission.deadlineAt) {
      violations.push(`Mission priority "${mission.priority}" requires a deadline`);
    }
  }

  if (mission.owner) {
    const allowedOwners = normalizeStringArray(owners.allow);
    const deniedOwners = new Set(normalizeStringArray(owners.deny));
    if (allowedOwners.length > 0 && !allowedOwners.includes(mission.owner)) {
      violations.push(`Mission owner "${mission.owner}" is outside the allowed list`);
    }

    if (deniedOwners.has(mission.owner)) {
      violations.push(`Mission owner "${mission.owner}" is denied by policy`);
    }
  }

  return mission;
}

function evaluateExecutionRequest(request, policy, context) {
  const violations = [];
  const warnings = [];
  const modules = applySelectionRules(request.modules, policy.modules || {}, 'Module', violations);
  const tools = applySelectionRules(request.tools, policy.tools || {}, 'Tool', violations);
  const mission = applyMissionRules(normalizeMissionRequest(request.mission), policy.missions || {}, violations);

  applyPathRules([request.directory, ...request.customContentSources], policy.paths || {}, context, violations);

  const customContentRules = policy.custom_content || {};
  if (customContentRules.allow === false && request.customContentSources.length > 0) {
    violations.push('Custom content is disabled by policy');
  }

  if (
    Number.isInteger(customContentRules.max_sources) &&
    request.customContentSources.length > customContentRules.max_sources
  ) {
    violations.push(`Custom content source count exceeds max_sources=${customContentRules.max_sources}`);
  }

  const maxTotalSelections = policy.budgets?.max_total_selections;
  const totalSelections = modules.length + tools.length + request.customContentSources.length;
  if (Number.isInteger(maxTotalSelections) && totalSelections > maxTotalSelections) {
    violations.push(`Combined module/tool/custom-content selection exceeds max_total_selections=${maxTotalSelections}`);
  }

  if (modules.length === 0 && request.actionType === 'install') {
    warnings.push('No non-core modules selected for installation.');
  }

  return {
    allowed: violations.length === 0,
    violations,
    warnings,
    summary: {
      actionType: request.actionType,
      modules,
      tools,
      hiddenTools: normalizeStringArray(policy.tools?.hidden),
      customContentSources: request.customContentSources,
      mission,
      failClosed: policy.defaults?.fail_closed !== false,
    },
  };
}

function filterVisibleTools(toolCatalog, policy) {
  const hidden = new Set(normalizeStringArray(policy.tools?.hidden));
  const denied = new Set(normalizeStringArray(policy.tools?.deny));

  return {
    visible: toolCatalog.filter((tool) => !hidden.has(tool.value) && !denied.has(tool.value)),
    hidden: toolCatalog.filter((tool) => hidden.has(tool.value) || denied.has(tool.value)).map((tool) => tool.value),
  };
}

function explainPolicy(policy) {
  const modules = policy.modules || {};
  const tools = policy.tools || {};
  const paths = policy.paths || {};
  const customContent = policy.custom_content || {};
  const budgets = policy.budgets || {};
  const missions = policy.missions || {};
  const failClosed = policy.defaults?.fail_closed === false ? 'no' : 'yes';

  return [
    `Policy pack: ${policy.name}`,
    `Description: ${policy.description || 'n/a'}`,
    `Fail closed: ${failClosed}`,
    `Module max count: ${modules.max_count ?? 'unbounded'}`,
    `Denied modules: ${normalizeStringArray(modules.deny).join(', ') || 'none'}`,
    `Tool max count: ${tools.max_count ?? 'unbounded'}`,
    `Hidden tools: ${normalizeStringArray(tools.hidden).join(', ') || 'none'}`,
    `Denied tools: ${normalizeStringArray(tools.deny).join(', ') || 'none'}`,
    `Allowed roots: ${normalizeStringArray(paths.allowed_roots).join(', ') || 'none declared'}`,
    `Denied path patterns: ${normalizeStringArray(paths.denied_patterns).join(', ') || 'none declared'}`,
    `Custom content allowed: ${customContent.allow === false ? 'no' : 'yes'}`,
    `Custom content max sources: ${customContent.max_sources ?? 'unbounded'}`,
    `Allowed mission types: ${normalizeStringArray(missions.types?.allow).join(', ') || 'any'}`,
    `Denied mission types: ${normalizeStringArray(missions.types?.deny).join(', ') || 'none'}`,
    `Allowed mission priorities: ${normalizeStringArray(missions.priorities?.allow).join(', ') || 'any'}`,
    `Denied mission priorities: ${normalizeStringArray(missions.priorities?.deny).join(', ') || 'none'}`,
    `Priority requires owner: ${normalizeStringArray(missions.require_owner_for_priorities).join(', ') || 'none'}`,
    `Priority requires deadline: ${normalizeStringArray(missions.require_deadline_for_priorities).join(', ') || 'none'}`,
    `Max total selections: ${budgets.max_total_selections ?? 'unbounded'}`,
  ].join('\n');
}

module.exports = {
  buildExecutionRequest,
  evaluateExecutionRequest,
  explainPolicy,
  filterVisibleTools,
  getFrameworkRoot,
  loadPolicyFile,
  resolveProjectPolicy,
  validatePolicy,
};
