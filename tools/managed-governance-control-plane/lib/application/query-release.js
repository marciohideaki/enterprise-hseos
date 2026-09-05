'use strict';

const { GovernanceRepositoryError, assertGovernanceRepository, parseRepositoryIdentifier } = require('../domain/repository-port');

// Backs GET /api/v1/releases/:id and POST /api/v1/releases/diff (FR-004). Both read from
// release_publication_attempts (T03/T04) filtered to stage='published' — the highest sequence
// per release_id is "the release". There is deliberately no separate governance_releases
// write path here: T04's publishGovernanceRelease already persists the one authoritative
// published record per (release_id, sequence); this module only reads it back.
//
// "Revoked" is not a modeled stage yet (RELEASE_ATTEMPT_STAGES has planned/signed/published/
// rejected, no revocation) — a release can be superseded by a later sequence, but a published
// attempt itself is never retracted here. Revocation is future work for whichever ADR
// introduces it; getGovernanceRelease fails closed on "missing" and "identity mismatch" only.

function releaseSummary(record) {
  return Object.freeze({
    release_id: record.release_id,
    sequence: record.sequence,
    source_repository_id: record.source_repository_id,
    source_commit: record.source_commit,
    approved_tag: record.approved_tag,
    manifest_digest: record.manifest_digest,
    previous_release_digest: record.previous_release_digest,
    items: record.items,
    issued_at: record.issued_at,
    effective_at: record.effective_at,
    expires_at: record.expires_at,
    sunset_at: record.sunset_at,
    signer_id: record.signer_id,
    signature_algorithm: record.signature_algorithm,
    signed_digest: record.signed_digest,
    published_at: record.attempted_at,
  });
}

async function getGovernanceRelease({ organizationId, releaseId }, context) {
  const repository = assertGovernanceRepository(context?.repository);
  const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
  if (typeof releaseId !== 'string' || releaseId.length === 0 || releaseId.length > 160) {
    throw new GovernanceRepositoryError('release id is invalid', 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID');
  }
  const record = await repository.getPublishedRelease(parsedOrganizationId, releaseId);
  if (!record) {
    throw new GovernanceRepositoryError('no published release with this identity exists for this organization', 'MANAGED_GOVERNANCE_NOT_FOUND');
  }
  return releaseSummary(record);
}

function diffItems(baseItems, targetItems) {
  const baseByArtifact = new Map((baseItems || []).map((item) => [item.artifact_id, item]));
  const targetByArtifact = new Map((targetItems || []).map((item) => [item.artifact_id, item]));
  const added = [];
  const removed = [];
  const changed = [];
  for (const [artifactId, targetItem] of targetByArtifact) {
    const baseItem = baseByArtifact.get(artifactId);
    if (!baseItem) {
      added.push(artifactId);
    } else if (baseItem.content_digest !== targetItem.content_digest || baseItem.artifact_version_id !== targetItem.artifact_version_id) {
      changed.push(artifactId);
    }
  }
  for (const artifactId of baseByArtifact.keys()) {
    if (!targetByArtifact.has(artifactId)) removed.push(artifactId);
  }
  return {
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort(),
  };
}

async function diffGovernanceReleases({ organizationId, baseReleaseId, targetReleaseId }, context) {
  const base = await getGovernanceRelease({ organizationId, releaseId: baseReleaseId }, context);
  const target = await getGovernanceRelease({ organizationId, releaseId: targetReleaseId }, context);
  return Object.freeze({
    base_release_id: base.release_id,
    target_release_id: target.release_id,
    digest_changed: base.manifest_digest !== target.manifest_digest,
    sequence_delta: target.sequence - base.sequence,
    signer_changed: base.signer_id !== target.signer_id,
    source_commit_changed: base.source_commit !== target.source_commit,
    items: diffItems(base.items, target.items),
  });
}

module.exports = {
  diffGovernanceReleases,
  getGovernanceRelease,
};
