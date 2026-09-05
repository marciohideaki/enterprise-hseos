'use strict';

const {
  ExternalSignerError,
  assertExternalSigner,
  buildSignatureEvidence,
  prepareSignatureRequest,
  verifySignatureEvidence,
} = require('../domain/external-signer-port');
const { GovernanceRepositoryError, assertGovernanceRepository, parseRepositoryIdentifier } = require('../domain/repository-port');

async function requestExternalSignature(manifest, signer, binding, options = {}) {
  const assertedSigner = assertExternalSigner(signer);
  const { digest, binding: parsedBinding } = prepareSignatureRequest(manifest, binding);
  let rawSignature;
  try {
    // The signer receives only the digest and the public binding — never the manifest body,
    // never a private key. See domain/external-signer-port.js for why.
    rawSignature = await assertedSigner.sign(digest, parsedBinding);
  } catch (error) {
    if (error instanceof ExternalSignerError) throw error;
    throw new ExternalSignerError('external signer failed', 'MANAGED_GOVERNANCE_EXTERNAL_SIGNER_FAILED', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  return buildSignatureEvidence({ binding: parsedBinding, digest, rawSignature, clock: options.clock });
}

async function publishGovernanceRelease({ organizationId, actor, manifest, evidence, binding }, context) {
  const repository = assertGovernanceRepository(context?.repository);
  const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');

  // "Invalid signature persists nothing": verification happens before any repository call.
  // A mismatch throws here and the release_publication_attempts table never learns this
  // publish attempt happened at all — there is deliberately no "rejected" row recorded for
  // a signature that fails structural verification, only for a signer that explicitly
  // declines to sign (a different, future caller decision, not this function's).
  const verifiedEvidence = verifySignatureEvidence(manifest, evidence, binding);

  return repository.recordReleasePublicationAttempt({
    organization_id: parsedOrganizationId,
    actor,
    manifest,
    stage: 'published',
    signer_id: verifiedEvidence.signer_id,
    signature_algorithm: verifiedEvidence.algorithm,
    signed_digest: verifiedEvidence.signed_digest,
    rejection_reason: null,
  });
}

module.exports = {
  publishGovernanceRelease,
  requestExternalSignature,
};
