'use strict';

const crypto = require('node:crypto');
const { ShadowReceiptSchema, digestCanonical, parseContract } = require('../../../../packages/managed-governance-contracts');
const { assertGovernanceRepository, parseRepositoryIdentifier, parseRepositoryUuid } = require('../domain/repository-port');

// FR-009/FR-024: every session preflight (a native adapter hook or the portable bootstrap)
// emits exactly one bounded receipt before the session's first task action. receipt_id is
// derived from the (organization, repository, adapter, session) identity tuple rather than
// generated at random, so a retried submission of the *same* session's result is a true
// no-op through T03's command_receipts idempotency — recordShadowReceipt is "idempotent by
// receipt ID and adapter/session identity" (design.md) because the identity IS the receipt id.
// A second submission for the same session that disagrees on status/digests is a genuine
// conflict (MANAGED_GOVERNANCE_IDEMPOTENCY_CONFLICT from the repository), not something this
// function silently resolves — shadow evidence is append-only, immutable evidence.

function deterministicReceiptId(seed) {
  const hash = crypto.createHash('sha256').update(seed, 'utf8').digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function recordShadowReceipt(
  {
    organizationId,
    actor,
    repositoryId,
    adapter,
    sessionFingerprint,
    localDigest,
    remoteDigest,
    releaseDigest,
    status,
    reasonCode,
    observedAt,
  },
  context,
) {
  const repository = assertGovernanceRepository(context?.repository);
  const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
  const parsedRepositoryId = parseRepositoryUuid(repositoryId, 'repository id');

  const receiptId = deterministicReceiptId(
    digestCanonical({
      organization_id: parsedOrganizationId,
      repository_id: parsedRepositoryId,
      adapter,
      session_fingerprint: sessionFingerprint,
    }),
  );

  const receipt = parseContract(
    ShadowReceiptSchema,
    {
      schema_version: 1,
      contract: 'shadow-receipt/v1',
      receipt_id: receiptId,
      organization_id: parsedOrganizationId,
      repository_id: parsedRepositoryId,
      adapter,
      session_fingerprint: sessionFingerprint,
      local_digest: localDigest ?? null,
      remote_digest: remoteDigest ?? null,
      release_digest: releaseDigest ?? null,
      status,
      reason_code: reasonCode,
      observed_at: observedAt,
    },
    'shadow receipt',
  );

  return repository.recordShadowReceipt({ organization_id: parsedOrganizationId, actor, receipt });
}

module.exports = {
  deterministicReceiptId,
  recordShadowReceipt,
};
