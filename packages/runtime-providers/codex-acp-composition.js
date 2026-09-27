'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const profile = require('./codex-acp-profile.json');
function fail() {
  throw new Error('ACP_RESTRICTED_COMPOSITION_INVALID');
}
function hash(file) {
  const digest = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(65_536);
  try {
    let size;
    while ((size = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) digest.update(buffer.subarray(0, size));
    return digest.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}
function canonical(file) {
  if (!path.isAbsolute(file) || fs.realpathSync(file) !== file || !fs.lstatSync(file).isFile()) fail();
  return file;
}
function restrictedConfig({ catalog, model }) {
  const features = Object.fromEntries(profile.disabled_features.map((k) => [k, false]));
  features.skip_host_skill_discovery = true;
  return {
    model,
    model_provider: 'openai',
    forced_login_method: 'chatgpt',
    model_catalog_json: catalog,
    model_reasoning_effort: 'low',
    features,
    tools: { experimental_request_user_input: { enabled: false }, update_plan: { enabled: false } },
    web_search: 'disabled',
    project_doc_max_bytes: 0,
  };
}
function validateRestrictedCatalog(document, model) {
  if (Object.keys(document).length !== 1 || !Array.isArray(document.models) || document.models.length !== 1) fail();
  const m = document.models[0];
  if (
    m.slug !== model ||
    m.apply_patch_tool_type !== null ||
    m.shell_type !== 'disabled' ||
    m.supports_search_tool !== false ||
    m.tool_mode !== 'direct' ||
    m.node_repl_disabled !== true ||
    m.multi_agent_version !== null ||
    m.multi_agent_reasoning_effort !== null ||
    !Array.isArray(m.experimental_supported_tools) ||
    m.experimental_supported_tools.length > 0
  )
    fail();
  for (const key of ['include_skills_usage_instructions', 'include_plugin_usage_instructions', 'include_apps_usage_instructions'])
    if (m[key] !== false) fail();
}
function validateRestrictedDirectories(home, cwd) {
  for (const dir of [home, cwd]) {
    if (!path.isAbsolute(dir) || fs.realpathSync(dir) !== dir || !fs.statSync(dir).isDirectory() || (fs.statSync(dir).mode & 0o077) !== 0)
      fail();
  }
  // Ambient configuration must not add MCP servers, hooks, instructions, or alternate providers.
  for (const dir of [home, cwd])
    for (const name of ['config.toml', '.codex', '.agents', 'AGENTS.md', 'AGENTS.override.md', '.git'])
      if (fs.existsSync(path.join(dir, name))) fail();
  for (const directory of [home, cwd]) {
    for (let current = path.dirname(directory); ; current = path.dirname(current)) {
      if (fs.existsSync(path.join(current, '.codex'))) fail();
      if (path.dirname(current) === current) break;
    }
  }
  if (fs.existsSync('/etc/codex')) fail();
}
function validateRestrictedComposition(value) {
  const allowed = ['binary', 'agent', 'catalog', 'model', 'home', 'cwd', 'auth_source', 'catalog_sha256'];
  if (!value || Object.keys(value).some((k) => !allowed.includes(k)) || allowed.some((k) => typeof value[k] !== 'string')) fail();
  for (const key of ['binary', 'agent']) if (hash(canonical(value[key])) !== profile.sha256[key]) fail();
  if (hash(canonical(value.catalog)) !== value.catalog_sha256) fail();
  const document = JSON.parse(fs.readFileSync(value.catalog, 'utf8'));
  validateRestrictedCatalog(document, value.model);
  validateRestrictedDirectories(value.home, value.cwd);
  if (fs.realpathSync(path.join(value.home, 'auth.json')) !== value.auth_source) fail();
  const config = restrictedConfig(value);
  const digest = createHash('sha256').update(JSON.stringify({ value, config, profile })).digest('hex');
  return { config, evidence_ref: `sha256:${digest}`, effect_boundary: 'instructions_only', lifecycle: 'one_shot' };
}
function toml(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? '{' +
        Object.entries(value)
          .map(([k, v]) => `${JSON.stringify(k)} = ${toml(v)}`)
          .join(', ') +
        '}'
    : JSON.stringify(value);
}
function startupArgs(config) {
  return ['app-server', ...Object.entries(config).flatMap(([k, v]) => ['-c', `${k}=${toml(v)}`])];
}
module.exports = { validateRestrictedComposition, validateRestrictedCatalog, validateRestrictedDirectories, restrictedConfig, startupArgs };
