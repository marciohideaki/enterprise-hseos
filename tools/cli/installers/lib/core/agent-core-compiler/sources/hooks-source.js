'use strict';

/**
 * Hooks source.
 *
 * Canonical source: .enterprise/governance/hooks/registry.yaml (+ handlers/).
 * Compatibility fallbacks (in order): the compiled .agents/hooks/registry.yaml
 * of the target, then of the source root, then a legacy hooks.json bootstrap.
 *
 * When sourcePath ends with .yaml  → treat as neutral registry (preferred)
 * When sourcePath ends with .json  → read legacy hooks.json and convert (bootstrap only)
 * When sourcePath is null/absent   → write empty registry
 *
 * `syncHandlers` copies handler scripts from the enterprise source into
 * .agents/hooks/handlers/ (CRLF-normalized, mode preserved) and returns
 * hash-pin entries for the manifest, mirroring how skills are pinned.
 */

const path = require('node:path');
const fs = require('fs-extra');
const yaml = require('yaml');
const { slug } = require('../lib/slug');
const { hash } = require('../lib/hash');

const HOOK_STATUSES = new Set(['active', 'inactive', 'pending', 'deprecated']);
const HOOK_KEYS = new Set([
  'id',
  'event',
  'matcher',
  'type',
  'command',
  'timeout',
  'blocking',
  'status',
  'description',
  'platform_support',
  'fallback',
]);

function validateHookRegistryDocument(registry) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    throw new Error('Hook registry must be an object');
  }
  const schemaVersion = registry.schema_version === undefined ? 'legacy' : String(registry.schema_version);
  if (!['legacy', '1.0', '2.0'].includes(schemaVersion)) {
    throw new Error(`Unsupported hook registry schema_version: ${schemaVersion}`);
  }
  if (!Array.isArray(registry.hooks)) throw new Error('Hook registry hooks must be an array');

  const strict = schemaVersion === '2.0';
  if (strict) {
    const unknownTopLevel = Object.keys(registry).filter(
      (key) => !new Set(['version', 'schema_version', 'source', 'handlers_dir', 'hooks']).has(key),
    );
    if (unknownTopLevel.length > 0) throw new Error(`Hook registry has unknown field(s): ${unknownTopLevel.join(', ')}`);
    if (String(registry.version) !== '2.0') throw new Error('Hook registry schema v2 requires version 2.0');
    if (typeof registry.handlers_dir !== 'string' || !registry.handlers_dir.trim()) {
      throw new Error('Hook registry schema v2 requires handlers_dir');
    }
  }

  const ids = new Set();
  for (const [index, hook] of registry.hooks.entries()) {
    const label = `Hook registry entry ${index}`;
    if (!hook || typeof hook !== 'object' || Array.isArray(hook)) throw new Error(`${label} must be an object`);
    if (strict) {
      const unknown = Object.keys(hook).filter((key) => !HOOK_KEYS.has(key));
      if (unknown.length > 0) throw new Error(`${label} has unknown field(s): ${unknown.join(', ')}`);
    }
    if (typeof hook.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(hook.id)) throw new Error(`${label} has invalid id`);
    if (ids.has(hook.id)) throw new Error(`Hook registry has duplicate id: ${hook.id}`);
    ids.add(hook.id);
    if (strict && !HOOK_STATUSES.has(hook.status)) throw new Error(`Hook registry entry ${hook.id} requires an explicit status`);
    if (hook.status !== undefined && !HOOK_STATUSES.has(hook.status)) {
      throw new Error(`Hook registry entry ${hook.id} has invalid status`);
    }
    if (typeof hook.event !== 'string' || !hook.event.trim()) throw new Error(`Hook registry entry ${hook.id} requires event`);
    if (typeof hook.matcher !== 'string' || !hook.matcher.trim()) throw new Error(`Hook registry entry ${hook.id} requires matcher`);
    if (hook.type !== 'command' || typeof hook.command !== 'string' || !hook.command.trim()) {
      throw new Error(`Hook registry entry ${hook.id} requires a command hook`);
    }
    if (hook.timeout !== null && hook.timeout !== undefined && (!Number.isInteger(hook.timeout) || hook.timeout <= 0)) {
      throw new Error(`Hook registry entry ${hook.id} has invalid timeout`);
    }
    if (typeof hook.blocking !== 'boolean') throw new Error(`Hook registry entry ${hook.id} requires blocking boolean`);
    if (strict && (typeof hook.description !== 'string' || !hook.description.trim())) {
      throw new Error(`Hook registry entry ${hook.id} requires description`);
    }
    if (
      strict &&
      (!Array.isArray(hook.platform_support) ||
        hook.platform_support.length === 0 ||
        new Set(hook.platform_support).size !== hook.platform_support.length ||
        hook.platform_support.some((platform) => typeof platform !== 'string' || !platform.trim()))
    ) {
      throw new Error(`Hook registry entry ${hook.id} requires unique platform_support values`);
    }
  }
  return { schemaVersion, strict };
}

async function writeHookRegistry(root, sourcePath, _legacyFallback, agentsDirName = '.agents') {
  const outputDir = path.join(root, agentsDirName, 'hooks');
  await fs.ensureDir(outputDir);

  let hooks = [];

  let parsedRegistry = {};

  if (sourcePath && (await fs.pathExists(sourcePath))) {
    if (sourcePath.endsWith('.yaml') || sourcePath.endsWith('.yml')) {
      parsedRegistry = yaml.parse(await fs.readFile(sourcePath, 'utf8')) || {};
      hooks = parsedRegistry.hooks || [];
    } else {
      // Legacy bootstrap: convert hooks.json → neutral registry entries
      const parsed = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
      for (const [event, groups] of Object.entries(parsed.hooks || {})) {
        for (const group of groups || []) {
          for (const hook of group.hooks || []) {
            hooks.push({
              id: slug(`${event}-${group.matcher || 'all'}-${hook.description || hook.command}`),
              event,
              matcher: group.matcher || '*',
              type: hook.type || 'command',
              command: hook.command,
              timeout: hook.timeout || null,
              blocking: event === 'PreToolUse',
              status: 'active',
              description: hook.description || '',
              platform_support: ['claude-code'],
              fallback: 'Use repository scripts or quality gates when the target platform has no native hook event.',
            });
          }
        }
      }
    }
  }

  const validation = validateHookRegistryDocument({ ...parsedRegistry, hooks });
  hooks = hooks.map((hook) => ({ ...hook, status: hook.status || 'active' }));

  const registry = {
    version: validation.strict ? '2.0' : '1.1',
    schema_version: parsedRegistry.schema_version || '1.0',
    source: sourcePath ? path.relative(root, sourcePath).replaceAll(path.sep, '/') : 'none',
    handlers_dir: parsedRegistry.handlers_dir || `${agentsDirName}/hooks/handlers`,
    hooks,
  };

  const header = [
    '# Generated by `hseos agent-core compile` — DO NOT EDIT.',
    `# Canonical source: ${registry.source} (edit hooks and handlers there).`,
    '# `status` semantics (enforced by the platform adapter emitters):',
    '#   active -- compiled into platform adapters (.claude/hooks.json, ...)',
    '#   any other value (pending / inactive / deprecated) -- kept in the registry for',
    '#   migration/audit, never emitted to adapters.',
    '',
  ].join('\n');

  await fs.writeFile(path.join(outputDir, 'registry.yaml'), header + yaml.stringify(registry, { lineWidth: 0 }), 'utf8');
  return hooks;
}

async function syncHandlers(root, sourceHandlersDir, agentsDirName = '.agents') {
  if (!sourceHandlersDir || !(await fs.pathExists(sourceHandlersDir))) return [];

  const outputDir = path.join(root, agentsDirName, 'hooks', 'handlers');
  await fs.ensureDir(outputDir);

  const handlers = [];
  const names = (await fs.readdir(sourceHandlersDir)).filter((name) => !name.startsWith('.')).sort();
  for (const name of names) {
    const sourceFile = path.join(sourceHandlersDir, name);
    const stat = await fs.stat(sourceFile);
    if (!stat.isFile()) continue;

    const content = (await fs.readFile(sourceFile, 'utf8')).replaceAll('\r\n', '\n');
    const outputFile = path.join(outputDir, name);
    await fs.writeFile(outputFile, content, { mode: stat.mode });

    handlers.push({
      file: `${agentsDirName}/hooks/handlers/${name}`,
      source: path.relative(root, sourceFile).replaceAll(path.sep, '/'),
      sha256: hash(content),
    });
  }
  return handlers;
}

module.exports = { syncHandlers, validateHookRegistryDocument, writeHookRegistry };
