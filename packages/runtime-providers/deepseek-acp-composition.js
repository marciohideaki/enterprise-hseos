'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const yaml = require('yaml');

const { deepFreeze } = require('../agent-runtime-contracts');
const { RuntimeProviderError } = require('./acp-runtime-provider');

const MODEL_PLUGIN = '@deepseek-ai/dsh-llm-deepseek';
const AGENT_PLUGIN = '@deepseek-ai/dsh-acp-demo';

function record(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new RuntimeProviderError(`${label} is malformed`, 'invalid_request');
  }
  return value;
}

function exact(value, allowed, label) {
  const object = record(value, label);
  if (Object.keys(object).some((key) => !allowed.includes(key))) {
    throw new RuntimeProviderError(`${label} contains unsupported fields`, 'capability_unavailable');
  }
  return object;
}

function nonEmpty(value, label, maximum = 1024) {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > maximum || /[\u0000\r\n]/u.test(value)) {
    throw new RuntimeProviderError(`${label} is malformed`, 'invalid_request');
  }
  return value;
}

function regularCanonicalFile(filenameValue) {
  if (typeof filenameValue !== 'string' || !path.isAbsolute(filenameValue)) {
    throw new RuntimeProviderError('DeepSeek composition path must be absolute', 'invalid_request');
  }
  const filename = path.resolve(filenameValue);
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || fs.realpathSync(filename) !== filename) {
    throw new RuntimeProviderError('DeepSeek composition must be a canonical regular file', 'invalid_request');
  }
  if (stat.size < 1 || stat.size > 262_144) {
    throw new RuntimeProviderError('DeepSeek composition size is invalid', 'invalid_request');
  }
  return filename;
}

function validateModel(entry) {
  exact(entry, ['id', 'name', 'config'], 'DeepSeek model plugin');
  nonEmpty(entry.id, 'DeepSeek model plugin id');
  if (entry.name !== MODEL_PLUGIN) throw new RuntimeProviderError('DeepSeek model plugin is not allowed', 'capability_unavailable');
  const config = exact(entry.config, ['apiKeyEnv', 'models'], 'DeepSeek model config');
  if (config.apiKeyEnv !== 'DEEPSEEK_API_KEY') {
    throw new RuntimeProviderError('DeepSeek model credential source is not allowed', 'capability_unavailable');
  }
  if (!Array.isArray(config.models) || config.models.length !== 1) {
    throw new RuntimeProviderError('DeepSeek composition requires exactly one model', 'capability_unavailable');
  }
  const model = exact(config.models[0], ['id'], 'DeepSeek model declaration');
  return nonEmpty(model.id, 'DeepSeek model id');
}

function validateAgent(entry, modelId) {
  exact(entry, ['id', 'name', 'config'], 'DeepSeek ACP agent plugin');
  nonEmpty(entry.id, 'DeepSeek ACP agent plugin id');
  if (entry.name !== AGENT_PLUGIN) throw new RuntimeProviderError('DeepSeek ACP agent plugin is not allowed', 'capability_unavailable');
  const config = exact(
    entry.config,
    ['provider', 'model', 'persistenceRoot', 'workspaceContext', 'skills', 'toolBash', 'toolJobs', 'goals', 'persona'],
    'DeepSeek ACP agent config',
  );
  if (config.provider !== 'deepseek-official' || config.model !== modelId) {
    throw new RuntimeProviderError('DeepSeek ACP model route is inconsistent', 'capability_unavailable');
  }
  nonEmpty(config.persistenceRoot, 'DeepSeek persistence root', 4096);
  if (config.workspaceContext !== false || config.toolBash !== false || config.toolJobs !== false || config.goals !== false) {
    throw new RuntimeProviderError('DeepSeek ACP composition enables model-visible capabilities', 'capability_unavailable');
  }
  const skills = exact(config.skills, ['enabled'], 'DeepSeek skills config');
  if (skills.enabled !== false) throw new RuntimeProviderError('DeepSeek skills must be disabled', 'capability_unavailable');
  if (config.persona !== undefined) nonEmpty(config.persona, 'DeepSeek persona', 32_768);
}

function validateDeepSeekAcpComposition(filenameValue) {
  const filename = regularCanonicalFile(filenameValue);
  const source = fs.readFileSync(filename, 'utf8');
  let document;
  try {
    document = yaml.parse(source, { maxAliasCount: 0, prettyErrors: false, strict: true, uniqueKeys: true });
  } catch (error) {
    throw new RuntimeProviderError('DeepSeek composition YAML is invalid', 'invalid_request', { cause: error });
  }
  if (!Array.isArray(document) || document.length !== 2) {
    throw new RuntimeProviderError('DeepSeek tool-free composition requires exactly two plugins', 'capability_unavailable');
  }
  const byName = new Map(document.map((entry) => [record(entry, 'DeepSeek plugin').name, entry]));
  if (byName.size !== 2 || !byName.has(MODEL_PLUGIN) || !byName.has(AGENT_PLUGIN)) {
    throw new RuntimeProviderError('DeepSeek composition plugin set is not tool-free', 'capability_unavailable');
  }
  const modelId = validateModel(byName.get(MODEL_PLUGIN));
  validateAgent(byName.get(AGENT_PLUGIN), modelId);
  const sha256 = createHash('sha256').update(source).digest('hex');
  return deepFreeze({
    composition_path: filename,
    composition_sha256: sha256,
    effect_boundary: 'instructions_only',
    lifecycle: 'one_shot',
    model_id: modelId,
    evidence_ref: `sha256:${sha256}`,
  });
}

module.exports = { AGENT_PLUGIN, MODEL_PLUGIN, validateDeepSeekAcpComposition };
