'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { z } = require('zod');
const { deepFreeze } = require('../../../packages/agent-runtime-contracts');
const { parseProviderControlManifest, inspectProviderControlManifest } = require('../../lib/provider-control-manifest');
const { authorizationSchema } = require('./provider-campaign-control');
const { assertTemporaryFixtureDirectory } = require('../../mcp-project-state/lib/execution-ledger-schema');
const identity = z.object({ device: z.string().regex(/^\d+$/), inode: z.string().regex(/^\d+$/) }).strict();

const canonicalPath = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => path.isAbsolute(value));
const controlStateIdentitySchema = z.object({ state: canonicalPath, state_identity: identity, ledger_identity: identity }).strict();
const bindingSchema = z
  .object({
    manifest: z.unknown(),
    subordinate_binding_ids: z.array(z.string().min(1).max(160)).max(16).default([]),
    binding: canonicalPath.optional(),
    options: z.record(z.string(), z.json()).default({}),
  })
  .strict();
const schema = z
  .object({
    workspaces: z.array(z.string()).min(1),
    bindings: z.record(z.string(), z.string()).default({}),
    extensions: z.record(z.string(), z.json()).optional(),
    port: z.number().int().min(0).max(65_535).default(0),
    provider_control: z
      .object({
        schema_version: z.literal(1),
        state: canonicalPath,
        state_identity: identity,
        ledger_identity: identity,
        bindings: z.record(z.string(), bindingSchema),
        authorizations: z.record(z.string().uuid(), authorizationSchema),
      })
      .strict()
      .optional(),
  })
  .strict();

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function readControlStateIdentity(state) {
  const stat = fs.lstatSync(state, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(state) !== state) fail('CONTROL_PROVIDER_STATE_DRIFT');
  const fixture = assertTemporaryFixtureDirectory(state);
  const ledger = fs.lstatSync(fixture.filename, { bigint: true });
  return controlStateIdentitySchema.parse({
    state,
    state_identity: { device: String(stat.dev), inode: String(stat.ino) },
    ledger_identity: { device: String(ledger.dev), inode: String(ledger.ino) },
  });
}

function assertState(configuration, override) {
  const state = configuration.state;
  if (override !== undefined && path.resolve(override) !== state) fail('CONTROL_PROVIDER_STATE_OVERRIDE');
  const actual = readControlStateIdentity(state);
  for (const field of ['state_identity', 'ledger_identity']) {
    if (actual[field].device !== configuration[field].device || actual[field].inode !== configuration[field].inode)
      fail('CONTROL_PROVIDER_STATE_DRIFT');
  }
  return state;
}

/** Factories are trusted, lazy service code, never paths supplied by API clients. */
function loadControlConfiguration(filename, { state, adapterFactories = {} } = {}) {
  try {
    const file = path.resolve(filename);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1_048_576) fail('CONTROL_CONFIGURATION_INVALID');
    const config = schema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
    const result = { workspaces: config.workspaces, bindings: config.bindings, port: config.port, state };
    if (config.extensions) result.extensionCatalog = deepFreeze(config.extensions);
    if (!config.provider_control) return result;
    const settings = config.provider_control;
    result.state = assertState(settings, state);
    const declarations = Object.entries(settings.bindings).map(([id, entry]) => {
      const manifest = parseProviderControlManifest(entry.manifest);
      if (id !== manifest.binding_id || (manifest.adapter !== 'execution-plugin-v1' && !entry.binding))
        fail('CONTROL_PROVIDER_CONFIGURATION_INVALID');
      if (!Object.hasOwn(adapterFactories, manifest.adapter) || typeof adapterFactories[manifest.adapter] !== 'function')
        fail('CONTROL_PROVIDER_ADAPTER_UNAVAILABLE');
      return { id, manifest, entry };
    });
    for (const declaration of declarations) {
      if (declaration.entry.subordinate_binding_ids.length > 0 && declaration.manifest.provider_kind !== 'client')
        fail('CONTROL_PROVIDER_COMPOSITION_INVALID');
      for (const id of declaration.entry.subordinate_binding_ids) {
        if (!declarations.some((candidate) => candidate.id === id && candidate.manifest.provider_kind === 'model'))
          fail('CONTROL_PROVIDER_COMPOSITION_INVALID');
      }
    }
    for (const grant of Object.values(settings.authorizations)) {
      if (grant.binding_ids.some((id) => !Object.hasOwn(settings.bindings, id))) fail('CONTROL_PROVIDER_AUTHORIZATION_BINDING_UNKNOWN');
    }
    result.providerBindings = {};
    for (const { id, manifest, entry } of declarations) {
      const loaded = adapterFactories[manifest.adapter](
        deepFreeze({
          manifest,
          binding: entry.binding,
          options: entry.options,
          state: result.state,
        }),
      );
      inspectProviderControlManifest(manifest, loaded?.binding_sha256);
      if (typeof loaded?.adapter?.inspect !== 'function' || typeof loaded?.adapter?.run !== 'function')
        fail('CONTROL_PROVIDER_CONFIGURATION_INVALID');
      result.providerBindings[id] = {
        manifest,
        binding_sha256: loaded.binding_sha256,
        adapter: loaded.adapter,
        subordinate_binding_ids: entry.subordinate_binding_ids,
      };
    }
    result.providerAuthorizations = deepFreeze(settings.authorizations);
    // Recheck after factories so a replacement during construction cannot select a fresh ledger.
    assertState(settings, state);
    return result;
  } catch (error) {
    if (
      [
        'CONTROL_PROVIDER_COMPOSITION_INVALID',
        'CONTROL_CONFIGURATION_INVALID',
        'CONTROL_PROVIDER_STATE_OVERRIDE',
        'CONTROL_PROVIDER_STATE_DRIFT',
        'CONTROL_PROVIDER_CONFIGURATION_INVALID',
        'CONTROL_PROVIDER_ADAPTER_UNAVAILABLE',
        'CONTROL_PROVIDER_AUTHORIZATION_BINDING_UNKNOWN',
        'CONTROL_PROVIDER_MANIFEST_INVALID',
        'CONTROL_PROVIDER_BINDING_DRIFT',
        'EXECUTION_LEDGER_OPERATIONAL_MIGRATION_REQUIRES_APPROVAL',
      ].includes(error.code)
    )
      fail(error.code);
    fail('CONTROL_CONFIGURATION_INVALID');
  }
}

module.exports = { loadControlConfiguration, readControlStateIdentity, controlStateIdentitySchema };
