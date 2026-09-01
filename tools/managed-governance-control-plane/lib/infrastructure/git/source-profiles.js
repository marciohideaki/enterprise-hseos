'use strict';

const { digestCanonical } = require('../../../../../packages/managed-governance-contracts');

const ENTERPRISE_HSEOS_V1 = {
  schema_version: 1,
  profile_id: 'enterprise-hseos:v1',
  max_entries: 50_000,
  max_files: 20_000,
  max_file_bytes: 2 * 1024 * 1024,
  sources: [
    {
      root: '.enterprise/.specs/constitution',
      source_kind: 'constitution',
      extensions: ['.md'],
      match: 'all',
      required: true,
    },
    ...['core', 'cross'].map((name) => ({
      root: `.enterprise/.specs/${name}`,
      source_kind: 'standard',
      extensions: ['.md'],
      match: 'all',
      required: true,
    })),
    ...['CSharp', 'Cpp', 'Flutter', 'Go', 'Java', 'PHP', 'ReactNative'].map((name) => ({
      root: `.enterprise/.specs/${name}`,
      source_kind: 'stack-standard',
      extensions: ['.md'],
      match: 'all',
      required: true,
    })),
    {
      root: '.enterprise/.specs/decisions',
      source_kind: 'adr',
      extensions: ['.md'],
      match: 'basename-prefix',
      value: 'ADR-',
      required: true,
    },
    {
      root: '.enterprise/policies',
      source_kind: 'policy',
      extensions: ['.md'],
      match: 'all',
      required: true,
    },
    {
      root: '.enterprise/governance/capabilities',
      source_kind: 'capability',
      extensions: ['.yaml', '.yml', '.json'],
      match: 'all',
      required: true,
    },
    {
      root: '.enterprise/governance/hooks',
      source_kind: 'hook',
      extensions: ['.yaml', '.yml'],
      match: 'relative-exact',
      values: ['registry.yaml', 'registry.yml'],
      required: true,
    },
    {
      root: '.enterprise/governance/hooks/handlers',
      source_kind: 'hook',
      extensions: ['.sh', '.js', '.cjs', '.mjs'],
      match: 'all',
      required: true,
    },
    {
      root: '.hseos/workflows',
      source_kind: 'workflow',
      extensions: ['.yaml', '.yml', '.md'],
      match: 'workflow-contract',
      required: true,
    },
    {
      root: '.enterprise/governance/agent-skills',
      source_kind: 'skill',
      extensions: ['.md'],
      match: 'basename-exact',
      value: 'SKILL.md',
      required: true,
    },
  ],
};

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

const PROFILES = new Map([[ENTERPRISE_HSEOS_V1.profile_id, deepFreeze(ENTERPRISE_HSEOS_V1)]]);

function getSourceProfile(profileId = 'enterprise-hseos:v1') {
  const profile = PROFILES.get(profileId);
  if (!profile) {
    const error = new Error(`unknown governance source profile: ${profileId}`);
    error.code = 'MANAGED_GOVERNANCE_SOURCE_PROFILE_UNKNOWN';
    throw error;
  }
  return profile;
}

function getSourceProfileDigest(profile) {
  return digestCanonical(profile);
}

function matchesSourceRule(rule, relativeToRuleRoot) {
  const normalized = relativeToRuleRoot.replaceAll('\\', '/');
  const basename = normalized.split('/').at(-1);
  const extension = basename.includes('.') ? `.${basename.split('.').at(-1).toLowerCase()}` : '';
  if (!rule.extensions.includes(extension)) return false;

  switch (rule.match) {
    case 'all': {
      return true;
    }
    case 'basename-prefix': {
      return basename.startsWith(rule.value);
    }
    case 'basename-exact': {
      return basename === rule.value;
    }
    case 'relative-exact': {
      return rule.values.includes(normalized);
    }
    case 'workflow-contract': {
      return normalized === 'registry.yaml' || normalized === 'registry.yml' || basename === 'workflow.md';
    }
    default: {
      return false;
    }
  }
}

module.exports = {
  getSourceProfile,
  getSourceProfileDigest,
  matchesSourceRule,
};
