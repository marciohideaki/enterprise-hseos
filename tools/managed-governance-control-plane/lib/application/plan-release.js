'use strict';

const { GovernanceReleaseManifestSchema, digestCanonical, parseContract } = require('../../../../packages/managed-governance-contracts');
const { GovernanceRepositoryError, assertGovernanceRepository, parseRepositoryIdentifier, parseRepositoryUuid } = require('../domain/repository-port');

// Mirrors domain/import-plan.js's shape: a deterministic builder over already-imported
// catalog state. planGovernanceRelease never writes — release_publication_attempts only
// gains a row once publish-release.js records an actual outcome (planned/signed/published/
// rejected). Given the same repository state and the same input, this always produces the
// same manifest_digest (FR-002) — no clock read, no random id, happens inside this function.

function sortByArtifactId(items) {
  return [...items].sort((left, right) => (left.artifact_id < right.artifact_id ? -1 : left.artifact_id > right.artifact_id ? 1 : 0));
}

async function planGovernanceRelease(input, context) {
  if (!input || typeof input !== 'object') {
    throw new GovernanceRepositoryError('release plan input must be an object', 'MANAGED_GOVERNANCE_RELEASE_PLAN_INVALID');
  }
  const repository = assertGovernanceRepository(context?.repository);
  const organizationId = parseRepositoryIdentifier(input.organizationId, 'organization id');
  const repositoryId = parseRepositoryUuid(input.repositoryId, 'repository id');

  // FR-001: the release is materialized only from the commit the catalog was actually
  // imported from — not from whatever the caller claims — so the plan can never diverge from
  // parity-checked, already-imported source. This is the "existing source and parity checks"
  // FR-001 requires, reusing the same read path ImportCatalogService.plan() uses rather than
  // introducing a second, potentially divergent notion of "current commit".
  const projection = await repository.getCatalogProjectionMetadata(organizationId, repositoryId);
  if (!projection) {
    throw new GovernanceRepositoryError('repository has no active imported catalog to release from', 'MANAGED_GOVERNANCE_RELEASE_PLAN_NOT_READY');
  }
  if (projection.source_commit !== input.sourceCommit) {
    throw new GovernanceRepositoryError(
      'source commit does not match the currently active imported catalog',
      'MANAGED_GOVERNANCE_RELEASE_PLAN_COMMIT_MISMATCH',
    );
  }

  const entries = await repository.listCatalogEntries(organizationId, repositoryId);
  const releasableEntries = entries.filter((entry) => entry.artifact_id && entry.artifact_version_id);
  if (releasableEntries.length === 0) {
    throw new GovernanceRepositoryError('no releasable catalog entries are active', 'MANAGED_GOVERNANCE_RELEASE_PLAN_EMPTY');
  }
  const items = sortByArtifactId(
    releasableEntries.map((entry) => ({
      artifact_id: entry.artifact_id,
      artifact_version_id: entry.artifact_version_id,
      artifact_type: entry.artifact_type,
      content_digest: entry.content_digest,
    })),
  );

  const unsignedManifest = {
    schema_version: 1,
    contract: 'governance-release-manifest/v1',
    release_id: input.releaseId,
    sequence: input.sequence,
    source_repository_id: repositoryId,
    source_commit: input.sourceCommit,
    approved_tag: input.approvedTag,
    previous_release_digest: input.previousReleaseDigest ?? null,
    items,
    issued_at: input.issuedAt,
    effective_at: input.effectiveAt,
    expires_at: input.expiresAt,
    sunset_at: input.sunsetAt ?? null,
    change_class: input.changeClass,
    runtime_min_version: input.runtimeMinVersion,
    runtime_max_version: input.runtimeMaxVersion ?? null,
    issuer: input.issuer,
  };
  const manifest = { ...unsignedManifest, manifest_digest: digestCanonical(unsignedManifest) };
  return parseContract(GovernanceReleaseManifestSchema, manifest, 'release manifest');
}

module.exports = {
  planGovernanceRelease,
};
