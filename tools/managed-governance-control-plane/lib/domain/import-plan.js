'use strict';

const { ImportPlanSchema, canonicalize, digestCanonical, parseContract } = require('../../../../packages/managed-governance-contracts');

class ImportPlanError extends Error {
  constructor(message, code = 'MANAGED_GOVERNANCE_IMPORT_PLAN_INVALID') {
    super(message);
    this.name = 'ImportPlanError';
    this.code = code;
  }
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateExisting(existing) {
  const requiredStrings = ['source_path', 'artifact_id', 'artifact_type', 'classification_status', 'content_digest'];
  if (!existing || typeof existing !== 'object' || requiredStrings.some((field) => typeof existing[field] !== 'string')) {
    throw new ImportPlanError('existing catalog entry is incomplete');
  }
}

function toPlanItem(entry, action, overrides = {}) {
  return {
    source_path: entry.source_path,
    artifact_id: overrides.artifact_id === undefined ? entry.classification.artifact_id : overrides.artifact_id,
    artifact_type: entry.classification.artifact_type,
    classification_status: entry.classification.classification_status,
    content_digest: entry.content_digest,
    action,
    previous_source_path: overrides.previous_source_path || null,
    issues: [...entry.classification.issues, ...(overrides.issues || [])],
  };
}

function buildImportItems(entries, existingEntries = []) {
  const sortedEntries = [...entries].sort((left, right) => compareText(left.source_path, right.source_path));
  const allDiscoveredPaths = new Set();
  for (const entry of sortedEntries) {
    if (allDiscoveredPaths.has(entry.source_path)) throw new ImportPlanError('discovery contains duplicate source paths');
    allDiscoveredPaths.add(entry.source_path);
  }
  const existingByPath = new Map();
  for (const existing of existingEntries) {
    validateExisting(existing);
    if (existingByPath.has(existing.source_path)) throw new ImportPlanError('existing catalog has duplicate source paths');
    existingByPath.set(existing.source_path, existing);
  }

  const consumedExistingPaths = new Set();
  const items = [];
  for (const entry of sortedEntries) {
    const current = existingByPath.get(entry.source_path);
    if (current) {
      consumedExistingPaths.add(current.source_path);
      if (
        entry.classification.classification_status !== 'classified' ||
        current.artifact_type !== entry.classification.artifact_type ||
        current.classification_status !== entry.classification.classification_status
      )
        items.push(toPlanItem(entry, 'review', { artifact_id: current.artifact_id }));
      else
        items.push(
          toPlanItem(entry, current.content_digest === entry.content_digest ? 'noop' : 'version', { artifact_id: current.artifact_id }),
        );
      continue;
    }

    const renameCandidates = existingEntries.filter(
      (existing) =>
        !consumedExistingPaths.has(existing.source_path) &&
        !allDiscoveredPaths.has(existing.source_path) &&
        existing.content_digest === entry.content_digest &&
        existing.artifact_type === entry.classification.artifact_type,
    );
    if (renameCandidates.length === 1 && entry.classification.classification_status === 'classified') {
      const renamed = renameCandidates[0];
      consumedExistingPaths.add(renamed.source_path);
      items.push(toPlanItem(entry, 'rename', { artifact_id: renamed.artifact_id, previous_source_path: renamed.source_path }));
    } else if (renameCandidates.length > 1) {
      items.push(
        toPlanItem(entry, 'review', {
          issues: [
            {
              code: 'source.rename_ambiguous',
              path: entry.source_path,
              message: 'Multiple prior sources share this digest; rename requires review',
              severity: 'warning',
            },
          ],
        }),
      );
    } else {
      items.push(toPlanItem(entry, entry.classification.classification_status === 'classified' ? 'create' : 'review'));
    }
  }

  for (const existing of [...existingEntries].sort((left, right) => compareText(left.source_path, right.source_path))) {
    if (consumedExistingPaths.has(existing.source_path) || allDiscoveredPaths.has(existing.source_path)) continue;
    items.push({
      source_path: existing.source_path,
      artifact_id: existing.artifact_id,
      artifact_type: existing.artifact_type,
      classification_status: existing.classification_status,
      content_digest: existing.content_digest,
      action: 'deactivate',
      previous_source_path: null,
      issues: [],
    });
  }

  return items.sort((left, right) => compareText(left.source_path, right.source_path) || compareText(left.action, right.action));
}

function buildImportPlan(input) {
  if (!input || typeof input !== 'object') throw new ImportPlanError('import plan input must be an object');
  const discovery = input.discovery;
  if (!discovery || !Array.isArray(discovery.entries)) throw new ImportPlanError('discovery entries are required');
  const items = buildImportItems(discovery.entries, input.existingEntries || []);
  const issues = items.flatMap((item) => item.issues);
  const batchKey = digestCanonical({
    repository_id: discovery.repository_id,
    source_commit: discovery.source_commit,
    importer_version: input.importerVersion,
    source_profile_digest: discovery.source_profile_digest,
  });
  const unsignedPlan = {
    schema_version: 1,
    batch_key: batchKey,
    organization_id: input.organizationId,
    repository_id: discovery.repository_id,
    source_commit: discovery.source_commit,
    importer_version: input.importerVersion,
    source_profile: discovery.source_profile,
    source_profile_digest: discovery.source_profile_digest,
    generated_at: discovery.source_timestamp,
    items,
    issues,
  };
  const plan = { ...unsignedPlan, plan_id: digestCanonical(unsignedPlan) };
  return parseContract(ImportPlanSchema, plan, 'import plan');
}

function serializeImportPlan(plan) {
  return canonicalize(parseContract(ImportPlanSchema, plan, 'import plan'));
}

module.exports = {
  ImportPlanError,
  buildImportItems,
  buildImportPlan,
  serializeImportPlan,
};
