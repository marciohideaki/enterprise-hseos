'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('yaml');

const { ModelProviderManifestSchema, RuntimeProviderManifestSchema, parseContract } = require('../../packages/agent-runtime-contracts');
const { createAcpRuntimeManifest, createHostedRuntimeManifest } = require('../../packages/runtime-providers');
const { getReferenceModelManifest } = require('../cli/lib/reference-agent-runtime');
const { loadCapabilityCatalog } = require('../cli/lib/capability-catalog');
const { providerManifest, readProviderBinding } = require('./agent-provider-binding');

const PROFILE_CONTRACTS = Object.freeze(
  [
    [
      'agent-reference',
      'kernel',
      'model:scripted-reference',
      'runtime:hseos-kernel',
      [],
      ['runtime:agent-kernel', 'runtime:agent-reference'],
    ],
    [
      'agent-openai-compatible-candidate',
      'kernel',
      'model:openai-compatible',
      'runtime:hseos-kernel',
      ['secret://hseos/model-provider-api-key'],
      ['runtime:agent-kernel', 'runtime:agent-openai-compatible'],
    ],
    [
      'agent-codex-delegated-candidate',
      'hosted',
      null,
      'runtime:codex-app-server',
      ['secret://codex/host-auth'],
      ['runtime:agent-codex-delegated'],
    ],
    [
      'agent-claude-delegated-candidate',
      'hosted',
      null,
      'runtime:claude-agent-sdk',
      ['secret://claude/host-auth'],
      ['runtime:agent-claude-delegated'],
    ],
    [
      'agent-deepseek-one-shot-candidate',
      'hosted',
      null,
      'runtime:deepseek-harness',
      ['secret://deepseek/host-auth'],
      ['runtime:agent-deepseek-one-shot'],
    ],
  ].map(([profile_id, execution_mode, model_provider_id, runtime_provider_id, secret_refs, provider_components]) =>
    Object.freeze({
      profile_id,
      execution_mode,
      model_provider_id,
      runtime_provider_id,
      secret_refs: Object.freeze(secret_refs),
      provider_components: Object.freeze(provider_components),
    }),
  ),
);

const PROVIDER_SPECS = Object.freeze(
  [
    {
      provider_id: 'model:scripted-reference',
      provider_kind: 'model',
      suites: ['test/test-model-providers.js', 'test/test-agentic-completion-audit.js'],
      manifest: () => getReferenceModelManifest(),
    },
    {
      provider_id: 'model:openai-compatible',
      provider_kind: 'model',
      binding_template: '.agents/activation/provider-bindings/openai-compatible.example.yaml',
      suites: ['test/test-model-providers.js', 'test/test-agentic-completion-audit.js', 'test/test-agent-provider-binding.js'],
      manifest(root) {
        return providerManifest(readProviderBinding(path.join(root, this.binding_template)).binding);
      },
    },
    {
      provider_id: 'runtime:hseos-kernel',
      provider_kind: 'kernel-runtime',
      suites: [
        'test/test-agent-runtime.js',
        'test/test-agent-context.js',
        'test/test-agent-compaction.js',
        'test/test-agent-orchestration.js',
        'test/test-agentic-completion-audit.js',
      ],
      manifest() {
        return Object.freeze({
          schema_version: 1,
          provider_type: 'kernel-runtime',
          provider_id: 'runtime:hseos-kernel',
          provider_version: '1.0.0',
          contract: 'AgentRuntime',
          conformance_level: null,
          capabilities: [
            'session_lifecycle',
            'governed_tools',
            'context_control',
            'cancellation',
            'replay',
            'compaction_lineage',
            'subagents',
            'workflows',
          ],
          secret_refs: [],
        });
      },
    },
    {
      provider_id: 'runtime:codex-app-server',
      provider_kind: 'runtime',
      binding_template: '.agents/activation/provider-bindings/codex-app-server.example.yaml',
      suites: ['test/test-hosted-runtime-adapters.js', 'test/test-codex-app-server-driver.js', 'test/test-delegated-codex-cli.js'],
      manifest: () => createHostedRuntimeManifest('codex', 'runtime:codex-app-server'),
    },
    {
      provider_id: 'runtime:claude-agent-sdk',
      provider_kind: 'runtime',
      binding_template: '.agents/activation/provider-bindings/claude-agent-sdk.example.yaml',
      suites: ['test/test-hosted-runtime-adapters.js', 'test/test-claude-agent-sdk-driver.js', 'test/test-delegated-claude-cli.js'],
      manifest: () => createHostedRuntimeManifest('claude-code', 'runtime:claude-agent-sdk'),
    },
    {
      provider_id: 'runtime:deepseek-harness',
      provider_kind: 'runtime',
      binding_template: '.agents/activation/provider-bindings/deepseek-acp.example.yaml',
      suites: [
        'test/test-runtime-providers.js',
        'test/test-process-acp-peer.js',
        'test/test-deepseek-acp-composition.js',
        'test/test-delegated-deepseek-cli.js',
      ],
      manifest: () => createAcpRuntimeManifest('runtime:deepseek-harness'),
    },
  ].map((spec) => Object.freeze({ ...spec, suites: Object.freeze([...spec.suites]) })),
);

const BINDING_KEYS = Object.freeze({
  'model:openai-compatible': ['schema_version', 'binding_id', 'profile_id', 'adapter', 'provider', 'transport', 'activation'],
  'runtime:codex-app-server': [
    'schema_version',
    'profile_id',
    'runtime_provider_id',
    'executable',
    'args',
    'cwd',
    'env_names',
    'secret_refs',
  ],
  'runtime:claude-agent-sdk': [
    'schema_version',
    'profile_id',
    'runtime_provider_id',
    'sdk_module',
    'executable',
    'cwd',
    'env_names',
    'secret_refs',
  ],
  'runtime:deepseek-harness': [
    'schema_version',
    'profile_id',
    'runtime_provider_id',
    'executable',
    'entrypoint',
    'composition',
    'cwd',
    'env_names',
    'secret_env_names',
    'secret_refs',
    'network_port',
  ],
});
const BINDING_SECRET_REFS = Object.freeze({
  'model:openai-compatible': ['env://HSEOS_MODEL_PROVIDER_API_KEY'],
  'runtime:codex-app-server': ['secret://codex/host-auth'],
  'runtime:claude-agent-sdk': ['secret://claude/host-auth'],
  'runtime:deepseek-harness': ['secret://deepseek/host-auth'],
});

const DESCRIPTOR_TEST_RUNNER = [
  "'use strict';",
  "const fs = require('node:fs');",
  "const Module = require('node:module');",
  "const path = require('node:path');",
  'const filename = process.env.HSEOS_CONFORMANCE_SUITE_FILENAME;',
  "if (!path.isAbsolute(filename)) throw new Error('suite filename must be absolute');",
  "const source = fs.readFileSync(3, 'utf8');",
  'const suite = new Module(filename, module);',
  'suite.filename = filename;',
  'suite.paths = Module._nodeModulePaths(path.dirname(filename));',
  'suite._compile(source, filename);',
  '',
].join('\n');

class AgentProviderConformanceError extends Error {
  constructor(message, code = 'AGENT_PROVIDER_CONFORMANCE_INVALID') {
    super(message);
    this.name = 'AgentProviderConformanceError';
    this.code = code;
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256File(filename) {
  return sha256(fs.readFileSync(filename));
}

function sha256Descriptor(descriptor) {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let position = 0;
  while (true) {
    const bytes = fs.readSync(descriptor, buffer, 0, buffer.length, position);
    if (bytes === 0) break;
    hash.update(buffer.subarray(0, bytes));
    position += bytes;
  }
  return hash.digest('hex');
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AgentProviderConformanceError(`${label} is malformed`);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new AgentProviderConformanceError(`${label} has an invalid shape`);
  }
}

function rejectUnknownKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AgentProviderConformanceError(`${label} is malformed`);
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length > 0) throw new AgentProviderConformanceError(`${label} has unsupported keys: ${unknown.sort().join(', ')}`);
}

function fileIdentity(stat) {
  return Object.freeze({
    device: String(stat.dev),
    inode: String(stat.ino),
    size: String(stat.size),
    mode: String(stat.mode),
    links: String(stat.nlink),
    mtime_ns: String(stat.mtimeNs),
    ctime_ns: String(stat.ctimeNs),
  });
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function verificationStatus(verify, passed, trustedRunner) {
  if (verify === false) return 'not-run';
  if (passed) return 'passed';
  return trustedRunner ? 'failed' : 'unverified-runner';
}

function safeFile(root, relative, label) {
  if (
    typeof relative !== 'string' ||
    path.isAbsolute(relative) ||
    path.win32.isAbsolute(relative) ||
    relative.split(/[\\/]/).includes('..')
  ) {
    throw new AgentProviderConformanceError(`${label} path is unsafe`);
  }
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`)) throw new AgentProviderConformanceError(`${label} escapes the repository`);
  const stat = fs.lstatSync(resolved, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || fs.realpathSync(resolved) !== resolved) {
    throw new AgentProviderConformanceError(`${label} is not a canonical single-link file: ${relative}`);
  }
  return Object.freeze({
    path: relative.replaceAll(path.sep, '/'),
    absolute_path: resolved,
    sha256: sha256File(resolved),
    identity: fileIdentity(stat),
  });
}

function profileForProvider(providerId) {
  return PROFILE_CONTRACTS.find((profile) => profile.model_provider_id === providerId || profile.runtime_provider_id === providerId);
}

function readBindingEvidence(root, spec) {
  if (!spec.binding_template) return null;
  const file = safeFile(root, spec.binding_template, `${spec.provider_id} binding template`);
  let binding;
  try {
    binding = yaml.parse(fs.readFileSync(file.absolute_path, 'utf8'));
  } catch {
    throw new AgentProviderConformanceError(`${spec.provider_id} binding template is not valid YAML`);
  }
  exactKeys(binding, BINDING_KEYS[spec.provider_id], `${spec.provider_id} binding template`);
  const profile = profileForProvider(spec.provider_id);
  const bindingProviderId = spec.provider_kind === 'model' ? binding.provider?.provider_id : binding.runtime_provider_id;
  if (!profile || binding.profile_id !== profile.profile_id || bindingProviderId !== spec.provider_id) {
    throw new AgentProviderConformanceError(`${spec.provider_id} binding template identity drifted`);
  }
  const secretRefs = spec.provider_kind === 'model' ? binding.provider?.secret_refs?.map((entry) => entry.source_ref) : binding.secret_refs;
  if (!same(secretRefs, BINDING_SECRET_REFS[spec.provider_id]))
    throw new AgentProviderConformanceError(`${spec.provider_id} binding template secret refs drifted`);
  if (spec.provider_kind === 'model') {
    if (binding.activation?.operational !== false || binding.activation?.authorized !== false) {
      throw new AgentProviderConformanceError(`${spec.provider_id} binding template overclaims activation`);
    }
  } else {
    for (const field of ['executable', 'cwd']) {
      if (typeof binding[field] !== 'string' || !path.isAbsolute(binding[field])) {
        throw new AgentProviderConformanceError(`${spec.provider_id} binding template ${field} is not absolute`);
      }
    }
    if (!Array.isArray(binding.env_names) || new Set(binding.env_names).size !== binding.env_names.length) {
      throw new AgentProviderConformanceError(`${spec.provider_id} binding template env_names are malformed`);
    }
    if (spec.provider_id === 'runtime:claude-agent-sdk' && !path.isAbsolute(binding.sdk_module)) {
      throw new AgentProviderConformanceError('Claude binding template sdk_module is not absolute');
    }
    if (spec.provider_id === 'runtime:deepseek-harness') {
      if (!path.isAbsolute(binding.entrypoint) || !path.isAbsolute(binding.composition) || binding.network_port !== 443) {
        throw new AgentProviderConformanceError('DeepSeek binding template boundary drifted');
      }
      if (!Array.isArray(binding.secret_env_names) || !binding.secret_env_names.includes('DEEPSEEK_API_KEY')) {
        throw new AgentProviderConformanceError('DeepSeek binding template secret environment drifted');
      }
    }
  }
  const { absolute_path: unused, ...publicFile } = file;
  return Object.freeze(publicFile);
}

function validateProviderManifest(spec, value) {
  if (spec.provider_kind === 'model') return parseContract(ModelProviderManifestSchema, value, `${spec.provider_id} conformance manifest`);
  if (spec.provider_kind === 'runtime')
    return parseContract(RuntimeProviderManifestSchema, value, `${spec.provider_id} conformance manifest`);
  if (
    spec.provider_kind !== 'kernel-runtime' ||
    value?.provider_id !== spec.provider_id ||
    value?.provider_type !== 'kernel-runtime' ||
    value?.contract !== 'AgentRuntime' ||
    value?.conformance_level !== null ||
    !Array.isArray(value?.capabilities) ||
    value.secret_refs?.length !== 0
  ) {
    throw new AgentProviderConformanceError('kernel runtime descriptor is malformed');
  }
  return value;
}

function validateProfiles(catalog) {
  const profiles = Object.entries(catalog.profiles).filter(([, profile]) => profile.agent);
  if (profiles.length !== PROFILE_CONTRACTS.length) throw new AgentProviderConformanceError('agent profile inventory drifted');
  return PROFILE_CONTRACTS.map((expected) => {
    const profile = catalog.profiles[expected.profile_id];
    if (!profile) throw new AgentProviderConformanceError(`agent profile is absent: ${expected.profile_id}`);
    const actual = {
      profile_id: expected.profile_id,
      execution_mode: profile.agent.execution_mode,
      model_provider_id: profile.agent.model_provider_id || null,
      runtime_provider_id: profile.agent.runtime_provider_id,
      secret_refs: profile.agent.secret_refs,
      provider_components: profile.components.filter((component) => component.startsWith('runtime:agent-')).sort(),
    };
    const normalizedExpected = {
      ...expected,
      secret_refs: [...expected.secret_refs],
      provider_components: [...expected.provider_components].sort(),
    };
    if (!same(actual, normalizedExpected))
      throw new AgentProviderConformanceError(`agent profile contract drifted: ${expected.profile_id}`);
    return Object.freeze(actual);
  }).sort((left, right) => left.profile_id.localeCompare(right.profile_id));
}

function inventory(root, providerSpecs = PROVIDER_SPECS, catalogLoader = loadCapabilityCatalog) {
  root = fs.realpathSync(path.resolve(root));
  const profiles = validateProfiles(catalogLoader(root));
  if (!Array.isArray(providerSpecs) || providerSpecs.length === 0) throw new AgentProviderConformanceError('provider specs are absent');
  const known = new Set(providerSpecs.map((spec) => spec.provider_id));
  if (known.size !== providerSpecs.length) throw new AgentProviderConformanceError('provider specs contain duplicate identities');
  const selected = new Set(profiles.flatMap((profile) => [profile.model_provider_id, profile.runtime_provider_id]).filter(Boolean));
  const unknown = [...selected].filter((providerId) => !known.has(providerId)).sort();
  const unselected = [...known].filter((providerId) => !selected.has(providerId)).sort();
  if (unknown.length > 0) throw new AgentProviderConformanceError(`profiles select unknown providers: ${unknown.join(', ')}`);
  if (unselected.length > 0)
    throw new AgentProviderConformanceError(`provider inventory contains unselected providers: ${unselected.join(', ')}`);
  const providers = providerSpecs.map((spec) => {
    const manifest = validateProviderManifest(spec, spec.manifest(root));
    if (manifest.provider_id !== spec.provider_id)
      throw new AgentProviderConformanceError(`provider manifest identity drifted: ${spec.provider_id}`);
    return Object.freeze({
      provider_id: spec.provider_id,
      provider_kind: spec.provider_kind,
      declared_conformance_level: manifest.conformance_level ?? null,
      manifest,
      binding_template: readBindingEvidence(root, spec),
      suites: spec.suites.map((suite) => safeFile(root, suite, 'conformance suite')),
    });
  });
  return Object.freeze({ root, profiles, providers });
}

function runOpenedSuite(descriptor, filename, root) {
  return spawnSync(process.execPath, ['-e', DESCRIPTOR_TEST_RUNNER], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH || '',
      HSEOS_CONFORMANCE_SUITE_FILENAME: filename,
      HSEOS_DISABLE_UPDATE_CHECK: '1',
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
    },
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe', descriptor],
  });
}

function defaultRunner({ root, suite }) {
  let descriptor;
  try {
    const current = safeFile(root, suite.path, 'conformance suite');
    if (current.sha256 !== suite.sha256 || !same(current.identity, suite.identity)) {
      return Object.freeze({ passed: false, exit_code: null, signal: null, artifact_stable: false, artifact_sha256: current.sha256 });
    }
    descriptor = fs.openSync(current.absolute_path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const descriptorBefore = fileIdentity(fs.fstatSync(descriptor, { bigint: true }));
    if (!same(descriptorBefore, suite.identity)) {
      return Object.freeze({ passed: false, exit_code: null, signal: null, artifact_stable: false, artifact_sha256: current.sha256 });
    }
    const result = runOpenedSuite(descriptor, current.absolute_path, root);
    const after = safeFile(root, suite.path, 'conformance suite');
    const descriptorAfter = fileIdentity(fs.fstatSync(descriptor, { bigint: true }));
    const stable =
      same(descriptorBefore, descriptorAfter) &&
      same(after.identity, suite.identity) &&
      after.sha256 === suite.sha256 &&
      sha256Descriptor(descriptor) === suite.sha256;
    return Object.freeze({
      passed: result.status === 0 && stable,
      exit_code: result.status,
      signal: result.signal || null,
      artifact_stable: stable,
      artifact_sha256: after.sha256,
    });
  } catch {
    return Object.freeze({ passed: false, exit_code: null, signal: null, artifact_stable: false, artifact_sha256: null });
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function buildAgentProviderConformance(options = {}) {
  rejectUnknownKeys(options, ['root', 'verify'], 'conformance build options');
  const { root, verify = false } = options;
  const discovered = inventory(root || process.cwd());
  const trustedRunner = true;
  const uniqueSuites = new Map();
  for (const provider of discovered.providers) for (const suite of provider.suites) uniqueSuites.set(suite.path, suite);
  const suiteResults = new Map();
  for (const suite of uniqueSuites.values()) {
    const result = verify ? defaultRunner({ root: discovered.root, suite }) : null;
    const passed = trustedRunner && result?.passed === true && result.artifact_stable === true && result.artifact_sha256 === suite.sha256;
    suiteResults.set(
      suite.path,
      Object.freeze({
        path: suite.path,
        sha256: suite.sha256,
        identity: suite.identity,
        status: verificationStatus(verify, passed, trustedRunner),
        exit_code: result?.exit_code ?? null,
        signal: result?.signal ?? null,
        artifact_stable: result?.artifact_stable === true,
      }),
    );
  }
  let inventoryStable = false;
  if (verify && trustedRunner) {
    try {
      const finalInventory = inventory(discovered.root);
      inventoryStable = same(discovered.profiles, finalInventory.profiles) && same(discovered.providers, finalInventory.providers);
    } catch {
      inventoryStable = false;
    }
  }
  const providers = discovered.providers.map((provider) => {
    const evidence = provider.suites.map((suite) => suiteResults.get(suite.path));
    const passed = verify && inventoryStable && evidence.every((suite) => suite.status === 'passed');
    return Object.freeze({
      provider_id: provider.provider_id,
      provider_kind: provider.provider_kind,
      declared_conformance_level: provider.declared_conformance_level,
      verified_conformance_level: passed ? provider.declared_conformance_level : null,
      contract_conformance_verified: passed,
      status: verificationStatus(verify, passed, trustedRunner),
      manifest: provider.manifest,
      binding_template: provider.binding_template,
      evidence,
    });
  });
  const passed = verify && trustedRunner && providers.every((provider) => provider.status === 'passed');
  return Object.freeze({
    schema_version: 1,
    status: passed ? 'passed' : verify && trustedRunner ? 'failed' : verify ? 'unverified-runner' : 'not-run',
    verification_mode: trustedRunner ? 'stable-local-process' : 'injected-untrusted',
    inventory_stable: inventoryStable,
    conformance_verified: passed,
    operational_activation: false,
    activation_authorized: false,
    profiles: discovered.profiles,
    providers,
  });
}

module.exports = {
  AgentProviderConformanceError,
  PROFILE_CONTRACTS,
  PROVIDER_SPECS,
  buildAgentProviderConformance,
  captureConformanceArtifact: safeFile,
  defaultRunner,
  inventory,
  runOpenedSuite,
};
