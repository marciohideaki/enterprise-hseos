'use strict';

const {
  ExternalSignatureEvidenceSchema,
  ExternalSignerBindingSchema,
  GovernanceReleaseManifestSchema,
  deepFreeze,
  parseContract,
} = require('../../../../packages/managed-governance-contracts');

// The core never sees a private key. `sign(digest, binding)` receives only the release
// manifest's content digest and the public binding metadata (algorithm, key id, public key
// reference) — never the manifest itself, never key material. The signer is an injected
// adapter (HSM, KMS, external CI step); this module only shapes and validates its inputs
// and its response.

const REQUIRED_SIGNER_METHODS = Object.freeze(['sign']);

class ExternalSignerError extends Error {
  constructor(message, code = 'MANAGED_GOVERNANCE_EXTERNAL_SIGNER_INVALID', details = {}) {
    super(message);
    this.name = 'ExternalSignerError';
    this.code = code;
    this.details = details;
  }
}

function assertExternalSigner(signer) {
  if (!signer || typeof signer !== 'object') {
    throw new ExternalSignerError('external signer is required', 'MANAGED_GOVERNANCE_EXTERNAL_SIGNER_PORT_INVALID');
  }
  const missing = REQUIRED_SIGNER_METHODS.filter((method) => typeof signer[method] !== 'function');
  if (missing.length > 0) {
    throw new ExternalSignerError('external signer does not implement the v1 port', 'MANAGED_GOVERNANCE_EXTERNAL_SIGNER_PORT_INVALID', {
      missing,
    });
  }
  return signer;
}

function prepareSignatureRequest(manifest, binding) {
  let parsedManifest;
  try {
    parsedManifest = parseContract(GovernanceReleaseManifestSchema, manifest, 'release manifest');
  } catch (error) {
    throw new ExternalSignerError('release manifest is invalid', 'MANAGED_GOVERNANCE_EXTERNAL_SIGNER_INPUT_INVALID', { cause: error.code });
  }
  let parsedBinding;
  try {
    parsedBinding = parseContract(ExternalSignerBindingSchema, binding, 'external signer binding');
  } catch (error) {
    throw new ExternalSignerError('external signer binding is invalid', 'MANAGED_GOVERNANCE_EXTERNAL_SIGNER_INPUT_INVALID', {
      cause: error.code,
    });
  }
  // Only the digest crosses the boundary to the signer — see the module note above.
  return deepFreeze({ digest: parsedManifest.manifest_digest, binding: parsedBinding });
}

function buildSignatureEvidence({ binding, digest, rawSignature, clock }) {
  if (!rawSignature || typeof rawSignature !== 'object' || typeof rawSignature.value !== 'string') {
    throw new ExternalSignerError(
      'external signer returned an invalid response',
      'MANAGED_GOVERNANCE_EXTERNAL_SIGNER_INVALID_RESPONSE',
    );
  }
  // No algorithm downgrade: the signer cannot silently return a different algorithm than the
  // one requested in the binding — the evidence's algorithm always echoes the binding's, never
  // whatever the signer response claims, so a compromised or misconfigured signer can never
  // widen (or narrow) the algorithm the caller actually asked for.
  const now = clock ? clock() : new Date();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new ExternalSignerError('signer clock returned an invalid date', 'MANAGED_GOVERNANCE_EXTERNAL_SIGNER_INVALID_RESPONSE');
  }
  const evidence = {
    schema_version: 1,
    contract: 'external-signature-evidence/v1',
    signer_id: binding.signer_id,
    algorithm: binding.algorithm,
    key_id: binding.key_id,
    signed_digest: digest,
    value: rawSignature.value,
    signed_at: now.toISOString(),
  };
  try {
    return parseContract(ExternalSignatureEvidenceSchema, evidence, 'external signature evidence');
  } catch (error) {
    throw new ExternalSignerError('external signature evidence is invalid', 'MANAGED_GOVERNANCE_EXTERNAL_SIGNER_INVALID_RESPONSE', {
      cause: error.code,
    });
  }
}

function verifySignatureEvidence(manifest, evidence, binding) {
  const parsedManifest = parseContract(GovernanceReleaseManifestSchema, manifest, 'release manifest');
  const parsedEvidence = parseContract(ExternalSignatureEvidenceSchema, evidence, 'external signature evidence');
  const parsedBinding = parseContract(ExternalSignerBindingSchema, binding, 'external signer binding');
  if (parsedEvidence.signed_digest !== parsedManifest.manifest_digest) {
    throw new ExternalSignerError('signature evidence does not bind to this manifest', 'MANAGED_GOVERNANCE_EXTERNAL_SIGNER_MISMATCH');
  }
  if (parsedEvidence.algorithm !== parsedBinding.algorithm || parsedEvidence.key_id !== parsedBinding.key_id) {
    throw new ExternalSignerError('signature evidence does not match the requested binding', 'MANAGED_GOVERNANCE_EXTERNAL_SIGNER_MISMATCH');
  }
  return parsedEvidence;
}

module.exports = {
  ExternalSignerError,
  REQUIRED_SIGNER_METHODS,
  assertExternalSigner,
  buildSignatureEvidence,
  prepareSignatureRequest,
  verifySignatureEvidence,
};
