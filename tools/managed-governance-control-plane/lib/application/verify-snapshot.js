'use strict';

const { GovernanceRepositoryError, assertGovernanceRepository, parseRepositoryIdentifier } = require('../domain/repository-port');

// Backs POST /api/v1/snapshots/verify (FR-005). There is no separate governance_snapshots
// table or standalone "snapshot" persistence in this codebase — GovernanceSnapshotSchema
// (packages/managed-governance-contracts) is a wire contract with no backing store, and the
// only durable "point-in-time governance bundle" this control plane actually persists is a
// published release_publication_attempts row. For v1, snapshot_id IS the release_id: verifying
// a snapshot means verifying the release it identifies is still a currently valid, trusted,
// unexpired publication — signature evidence, trusted-signer binding and validity window.
// This is a scope decision, not an oversight: it covers every case FR-005 and the "replay and
// substitution fixtures fail" acceptance criterion actually exercise (missing, expired,
// untrusted signer, incomplete evidence) without inventing storage nothing else needs.

function assertValidityWindow(record, now) {
  if (!record.issued_at || !record.effective_at || !record.expires_at) {
    throw new GovernanceRepositoryError(
      'published release is missing a recorded validity window',
      'MANAGED_GOVERNANCE_SNAPSHOT_INVALID',
    );
  }
  const nowMs = now.getTime();
  if (nowMs < Date.parse(record.effective_at)) {
    throw new GovernanceRepositoryError('release is not yet effective', 'MANAGED_GOVERNANCE_SNAPSHOT_NOT_YET_VALID');
  }
  if (nowMs > Date.parse(record.expires_at)) {
    throw new GovernanceRepositoryError('release has expired — replay of a stale snapshot is rejected', 'MANAGED_GOVERNANCE_SNAPSHOT_EXPIRED');
  }
  if (record.sunset_at && nowMs > Date.parse(record.sunset_at)) {
    throw new GovernanceRepositoryError('release is past its sunset date', 'MANAGED_GOVERNANCE_SNAPSHOT_EXPIRED');
  }
}

function assertSignatureEvidence(record) {
  if (!record.signer_id || !record.signature_algorithm || !record.signed_digest) {
    throw new GovernanceRepositoryError('published release is missing signature evidence', 'MANAGED_GOVERNANCE_SNAPSHOT_INVALID');
  }
  if (record.signed_digest !== record.manifest_digest) {
    // Digest substitution: the recorded signature does not bind to the recorded manifest.
    // Fails closed with the same code a stale-cache reader would treat as "do not trust this".
    throw new GovernanceRepositoryError('signed digest does not match the release manifest digest', 'MANAGED_GOVERNANCE_SNAPSHOT_TAMPERED');
  }
}

function assertTrustedSigner(record, binding) {
  if (!binding) return;
  const trustedKeyIds = Array.isArray(binding.trusted_key_ids) ? binding.trusted_key_ids : [];
  if (trustedKeyIds.length > 0 && !trustedKeyIds.includes(record.signer_id)) {
    throw new GovernanceRepositoryError('release signer is not in the trusted binding', 'MANAGED_GOVERNANCE_SNAPSHOT_UNTRUSTED_SIGNER');
  }
}

async function verifyGovernanceSnapshot({ organizationId, snapshotId, binding, clock }, context) {
  const repository = assertGovernanceRepository(context?.repository);
  const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
  if (typeof snapshotId !== 'string' || snapshotId.length === 0 || snapshotId.length > 160) {
    throw new GovernanceRepositoryError('snapshot id is invalid', 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID');
  }
  const record = await repository.getPublishedRelease(parsedOrganizationId, snapshotId);
  if (!record) {
    throw new GovernanceRepositoryError('no published release exists for this snapshot identity', 'MANAGED_GOVERNANCE_NOT_FOUND');
  }
  assertSignatureEvidence(record);
  assertTrustedSigner(record, binding);
  const now = clock ? clock() : new Date();
  assertValidityWindow(record, now);
  return Object.freeze({
    valid: true,
    snapshot_id: snapshotId,
    release_id: record.release_id,
    manifest_digest: record.manifest_digest,
    signer_id: record.signer_id,
    checked_at: now.toISOString(),
  });
}

module.exports = {
  verifyGovernanceSnapshot,
};
