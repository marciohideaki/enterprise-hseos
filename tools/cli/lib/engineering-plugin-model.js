'use strict';

const { z, IdentifierSchema, ModelNameSchema, deepFreeze } = require('../../../packages/agent-runtime-contracts');
const { ModelProviderRegistry } = require('../../../packages/model-providers');
const { validateManifest } = require('../../../packages/model-providers/common');
const { restoreExecutionPluginSelection, parseExecutionPluginSelection } = require('../../lib/execution-plugin-selection');
const { engineeringDigest } = require('./engineering-task-state');
const { ProviderCampaignControl } = require('./provider-campaign-control');
const { createExecutionPluginModel } = require('./execution-plugin-model');
const { readControlStateIdentity, controlStateIdentitySchema } = require('./control-configuration');
const { ExecutionPluginError } = require('../../lib/execution-plugin-manifest');

const referenceSchema = z.object({ selection_id: IdentifierSchema, campaign_id: z.string().uuid() }).strict();
const configurationSchema = z
  .object({
    schema_version: z.literal(1),
    binding_id: IdentifierSchema,
    model: ModelNameSchema,
    models: z.array(ModelNameSchema).min(1).max(128),
    limits: z.unknown(),
  })
  .strict();
const pinSchema = referenceSchema
  .extend({
    schema_version: z.literal(1),
    control_identity: controlStateIdentitySchema,
    resource_id: z.string().uuid(),
    binding_id: IdentifierSchema,
    model: ModelNameSchema,
    provider_manifest: z.unknown(),
    binding_manifest_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
function reject(code) {
  throw new ExecutionPluginError(code);
}

function parseTaskPluginModel(value, selection) {
  const pin = pinSchema.parse(value);
  const manifest = validateManifest(pin.provider_manifest);
  const selected = parseExecutionPluginSelection(selection);
  const entry = selected.entries.find((candidate) => candidate.selection_id === pin.selection_id);
  if (
    !entry ||
    !selected.selected.includes(pin.selection_id) ||
    entry.kind !== 'model-provider' ||
    manifest.provider_id !== `model:plugin-${entry.id}` ||
    manifest.provider_version !== entry.version ||
    !manifest.models.includes(pin.model)
  )
    reject('PLUGIN_TASK_MODEL_INVALID');
  return deepFreeze(pin);
}

/** Host-only construction; attach proves existing campaign scope without producing an effect. */
function prepareTaskPluginModel({ reference, selection, catalog, campaigns, deadline, resourceId }) {
  const ref = referenceSchema.parse(reference);
  z.number().int().positive().safe().parse(deadline);
  z.string().uuid().parse(resourceId);
  if (!(campaigns instanceof ProviderCampaignControl)) reject('PLUGIN_CAMPAIGN_BINDING_REQUIRED');
  const resolved = restoreExecutionPluginSelection(catalog, selection);
  const entry = resolved.entries.find((candidate) => candidate.pin.selection_id === ref.selection_id);
  if (!entry || !resolved.selection.selected.includes(ref.selection_id) || entry.pin.kind !== 'model-provider')
    reject('PLUGIN_TASK_MODEL_INVALID');
  const config = configurationSchema.parse(entry.configuration);
  const port = createExecutionPluginModel({ admission: entry.admission, ...config, deadline_at: deadline });
  if (!port.manifest.models.includes(config.model)) reject('PLUGIN_TASK_MODEL_INVALID');
  const facade = campaigns.withBinding(port.binding);
  port.attach({ campaign: facade, campaign_id: ref.campaign_id, task_id: resourceId });
  const pin = parseTaskPluginModel(
    {
      schema_version: 1,
      control_identity: readControlStateIdentity(campaigns.control.state),
      ...ref,
      resource_id: resourceId,
      binding_id: config.binding_id,
      model: config.model,
      provider_manifest: port.manifest,
      binding_manifest_sha256: engineeringDigest(port.binding.manifest),
    },
    selection,
  );
  const registry = new ModelProviderRegistry();
  registry.register(port.provider, port.manifest);
  return {
    pin,
    snapshot: registry.snapshot(),
    async connect() {
      if (campaigns.closing || Date.now() >= deadline) reject('PLUGIN_TASK_DEADLINE');
      const current = campaigns.query(ref.campaign_id);
      if (current.cancelled) reject('CONTROL_CAMPAIGN_CANCELLED');
    },
    drain: port.drain,
    close: port.close,
  };
}

function assertTaskPluginControl({ pin, campaigns, resourceId, directory }) {
  if (!(campaigns instanceof ProviderCampaignControl)) reject('PLUGIN_CAMPAIGN_BINDING_REQUIRED');
  if (pin.resource_id !== resourceId) reject('PLUGIN_TASK_RESOURCE_DRIFT');
  if (engineeringDigest(pin.control_identity) !== engineeringDigest(readControlStateIdentity(campaigns.control.state)))
    reject('PLUGIN_TASK_CONTROL_DRIFT');
  if (directory !== undefined && campaigns.control.location(resourceId) !== directory) reject('PLUGIN_TASK_RESOURCE_DRIFT');
}

function restoreTaskPluginModel({ pin, ...options }) {
  const expected = parseTaskPluginModel(pin, options.selection);
  assertTaskPluginControl({ pin: expected, campaigns: options.campaigns, resourceId: options.resourceId });
  const restored = prepareTaskPluginModel({
    ...options,
    reference: {
      selection_id: expected.selection_id,
      campaign_id: expected.campaign_id,
    },
  });
  if (engineeringDigest(restored.pin) !== engineeringDigest(expected)) reject('PLUGIN_TASK_MODEL_DRIFT');
  return restored;
}

/** Used only for a locally declared campaign binding; no external import or process. */
function createPluginModelCampaignAdapter({ manifest, options }) {
  const config = z
    .object({ catalog: z.record(z.string(), z.json()), selection_id: IdentifierSchema })
    .strict()
    .parse(options);
  const resolved = require('../../lib/execution-plugin-selection').pinExecutionPluginSelection(config.catalog, [config.selection_id]);
  const entry = resolved.entries.find((candidate) => candidate.pin.selection_id === config.selection_id);
  const configuration = configurationSchema.parse(entry.configuration);
  const port = createExecutionPluginModel({ admission: entry.admission, ...configuration });
  if (engineeringDigest(manifest) !== engineeringDigest(port.binding.manifest)) reject('CONTROL_PROVIDER_BINDING_DRIFT');
  return port.binding;
}

module.exports = {
  parseTaskPluginModel,
  prepareTaskPluginModel,
  restoreTaskPluginModel,
  createPluginModelCampaignAdapter,
  assertTaskPluginControl,
};
