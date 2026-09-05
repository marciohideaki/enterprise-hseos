-- T05: getGovernanceRelease/diffGovernanceReleases/verifyGovernanceSnapshot need the release
-- manifest's bound artifact items and validity window; release_publication_attempts (0005)
-- recorded only the release's identity and signature fields, not its full manifest content.
-- Forward-only, additive, nullable so existing rows (recorded before this migration) remain valid.

ALTER TABLE hseos_governance.release_publication_attempts
  ADD COLUMN items jsonb,
  ADD COLUMN issued_at timestamptz,
  ADD COLUMN effective_at timestamptz,
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN sunset_at timestamptz;

ALTER TABLE hseos_governance.release_publication_attempts
  ADD CONSTRAINT release_publication_attempts_items_shape
    CHECK (items IS NULL OR (jsonb_typeof(items) = 'array' AND octet_length(items::text) <= 1048576)),
  ADD CONSTRAINT release_publication_attempts_validity_order
    CHECK (
      issued_at IS NULL
      OR (effective_at IS NOT NULL AND expires_at IS NOT NULL AND issued_at <= effective_at AND effective_at <= expires_at
          AND (sunset_at IS NULL OR expires_at <= sunset_at))
    );
