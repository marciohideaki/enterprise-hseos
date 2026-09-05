'use strict';

const crypto = require('node:crypto');
const { RECEIPT_STATUSES, ReadinessReportSchema, digestCanonical, parseContract } = require('../../../../packages/managed-governance-contracts');
const { GovernanceRepositoryError, assertGovernanceRepository, parseRepositoryIdentifier, parseRepositoryUuid } = require('../domain/repository-port');

// NFR-011: readiness requires 30 CONSECUTIVE, COMPLETED UTC days. Rather than trust a
// caller-supplied window_end (which could be miscounted), this module derives it from
// window_start — the window size is a structural invariant of the function, not caller input.
//
// This module never queries the repository for evidence itself (there is deliberately no
// "list shadow receipts in a window" repository method yet — see T07's output_contract, which
// only adds this file, record-shadow-receipt.js and its test). Like catalog-parity.js, it is a
// pure projector over evidence the caller already assembled; context.repository is used only to
// persist the resulting report via recordReadinessEvaluation, exactly as generatePatchBundle
// (T06) computes a bundle before its one repository write.
//
// "Sparse evidence never green" (T07 constraint) is enforced at three independent layers:
// missing days/repositories/adapters are named explicitly (never silently dropped), a
// remote-unavailable or not-configured receipt is recorded and reported but never counts toward
// coverage (see CONCLUSIVE_STATUSES below), and a covered window with no latency telemetry at
// all fails closed instead of reporting an implausible 0ms p95.

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;

// NFR-011 ("remote unavailability MUST NOT count as equivalence") and FR-011 ("MUST NOT infer
// readiness from sparse heartbeats") are read together as a coverage rule, not just a labeling
// rule: a receipt only counts toward eligible-session coverage and toward a day/repository/
// adapter's "covered" status when it reached an actual conclusion about parity. remote_unavailable
// (we could not reach the remote) and not_configured (the adapter never bound the session) are
// still recorded, bounded evidence — FR-009 requires that much — but they are evidence *of an
// attempt*, not evidence *of coverage*, so they can never silently satisfy the 95% bar or a
// day's evidence requirement the way an equivalent/drift_detected/invalid_local_contract receipt
// does. Without this, a month where every single session timed out against the remote would
// read as "ready" — exactly what T07's "sparse evidence never green" constraint forbids.
const CONCLUSIVE_STATUSES = Object.freeze(['equivalent', 'drift_detected', 'invalid_local_contract']);

function invalid(message, code = 'MANAGED_GOVERNANCE_READINESS_INPUT_INVALID', details = {}) {
  return new GovernanceRepositoryError(message, code, details);
}

// receipts here are `shadow_receipts` repository records — the shape recordShadowReceipt and
// repository.getShadowReceipt actually return (record_id field shadow_receipt_id, no
// schema_version/contract envelope) — not the ShadowReceipt/v1 wire contract those functions
// validate against before persisting. This mirrors query-release.js's releaseSummary(), which
// reads repository record fields directly rather than re-parsing a persisted row through its
// original wire schema.
function assertReceiptRecord(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.shadow_receipt_id !== 'string' ||
    typeof value.organization_id !== 'string' ||
    typeof value.repository_id !== 'string' ||
    typeof value.adapter !== 'string' ||
    !RECEIPT_STATUSES.includes(value.status) ||
    typeof value.observed_at !== 'string' ||
    Number.isNaN(Date.parse(value.observed_at))
  ) {
    throw invalid('shadow receipt record is malformed');
  }
  return value;
}

function parseUtcMidnight(value, label) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw invalid(`${label} is invalid`);
  }
  const date = new Date(value);
  if (
    date.getUTCHours() !== 0 ||
    date.getUTCMinutes() !== 0 ||
    date.getUTCSeconds() !== 0 ||
    date.getUTCMilliseconds() !== 0
  ) {
    throw invalid(`${label} must be exact UTC midnight`, 'MANAGED_GOVERNANCE_READINESS_WINDOW_INVALID');
  }
  return date;
}

function percentile95(samplesMs) {
  const sorted = [...samplesMs].sort((left, right) => left - right);
  const rank = Math.min(Math.max(Math.ceil(0.95 * sorted.length) - 1, 0), sorted.length - 1);
  return sorted[rank];
}

function deterministicReportId(seed) {
  const hash = crypto.createHash('sha256').update(seed, 'utf8').digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function dayBounds(windowStartMs, dayIndex) {
  const start = windowStartMs + dayIndex * DAY_MS;
  return [start, start + DAY_MS];
}

function hasEvidenceOnDay(receipts, dayStart, dayEnd, matches) {
  return receipts.some((receipt) => {
    const observedAtMs = Date.parse(receipt.observed_at);
    return observedAtMs >= dayStart && observedAtMs < dayEnd && matches(receipt);
  });
}

function missingCoverage(receipts, windowStartMs, identifiers, matches) {
  const covered = [];
  const missing = [];
  for (const identifier of identifiers) {
    let coveredEveryDay = true;
    for (let dayIndex = 0; dayIndex < WINDOW_DAYS; dayIndex += 1) {
      const [dayStart, dayEnd] = dayBounds(windowStartMs, dayIndex);
      if (!hasEvidenceOnDay(receipts, dayStart, dayEnd, (receipt) => matches(receipt, identifier))) {
        coveredEveryDay = false;
        break;
      }
    }
    (coveredEveryDay ? covered : missing).push(identifier);
  }
  return { covered: covered.sort(), missing: missing.sort() };
}

async function evaluateShadowReadiness(
  {
    organizationId,
    actor,
    windowStart,
    evaluatedAt,
    receipts,
    eligibleSessions,
    activeRepositories,
    enabledAdapters,
    preflightLatencySamplesMs,
    signerEvidenceCurrent,
    recoveryEvidenceCurrent,
    threatModelEvidenceCurrent,
    rollbackEvidenceCurrent,
  },
  context,
) {
  const repository = assertGovernanceRepository(context?.repository);
  const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');

  const windowStartDate = parseUtcMidnight(windowStart, 'window start');
  const windowStartMs = windowStartDate.getTime();
  const windowEndMs = windowStartMs + WINDOW_DAYS * DAY_MS;
  const windowEndDate = new Date(windowEndMs);

  if (typeof evaluatedAt !== 'string' || Number.isNaN(Date.parse(evaluatedAt))) {
    throw invalid('evaluated at is invalid');
  }
  if (Date.parse(evaluatedAt) < windowEndMs) {
    throw invalid('readiness cannot be evaluated before its 30-day window has completed', 'MANAGED_GOVERNANCE_READINESS_WINDOW_INCOMPLETE');
  }

  if (!Array.isArray(activeRepositories) || activeRepositories.length === 0) {
    throw invalid('at least one active repository is required');
  }
  if (!Array.isArray(enabledAdapters) || enabledAdapters.length === 0) {
    throw invalid('at least one enabled adapter is required');
  }
  if (!Array.isArray(receipts)) {
    throw invalid('receipts must be an array');
  }
  if (!Number.isInteger(eligibleSessions) || eligibleSessions < 0) {
    throw invalid('eligible sessions must be a non-negative integer');
  }
  if (!Array.isArray(preflightLatencySamplesMs)) {
    throw invalid('preflight latency samples must be an array');
  }

  const parsedRepositoryIds = activeRepositories.map((repositoryId) => parseRepositoryUuid(repositoryId, 'active repository id'));
  const seenReceiptIds = new Set();
  const windowedReceipts = [];
  for (const raw of receipts) {
    const receipt = assertReceiptRecord(raw);
    if (receipt.organization_id !== parsedOrganizationId) {
      throw invalid('shadow receipt belongs to a different organization', 'MANAGED_GOVERNANCE_READINESS_INPUT_INVALID');
    }
    if (seenReceiptIds.has(receipt.shadow_receipt_id)) {
      throw invalid(`duplicate shadow receipt in evaluation input: ${receipt.shadow_receipt_id}`);
    }
    seenReceiptIds.add(receipt.shadow_receipt_id);
    const observedAtMs = Date.parse(receipt.observed_at);
    if (observedAtMs >= windowStartMs && observedAtMs < windowEndMs) {
      windowedReceipts.push(receipt);
    }
  }

  const conclusiveReceipts = windowedReceipts.filter((receipt) => CONCLUSIVE_STATUSES.includes(receipt.status));
  const coveredSessions = conclusiveReceipts.length;
  if (coveredSessions > eligibleSessions) {
    throw invalid('covered sessions cannot exceed eligible sessions', 'MANAGED_GOVERNANCE_READINESS_INPUT_INVALID');
  }
  if (coveredSessions > 0 && preflightLatencySamplesMs.length === 0) {
    throw invalid('preflight latency samples are required when the window has covered sessions');
  }

  const repositoryCoverage = missingCoverage(
    conclusiveReceipts,
    windowStartMs,
    parsedRepositoryIds,
    (receipt, repositoryId) => receipt.repository_id === repositoryId,
  );
  const adapterCoverage = missingCoverage(conclusiveReceipts, windowStartMs, enabledAdapters, (receipt, adapter) => receipt.adapter === adapter);

  const openDriftCount = windowedReceipts.filter((receipt) => receipt.status === 'drift_detected').length;
  const openInvalidContractCount = windowedReceipts.filter((receipt) => receipt.status === 'invalid_local_contract').length;
  const remoteUnavailableSamples = windowedReceipts.filter((receipt) => receipt.status === 'remote_unavailable').length;
  const preflightLatencyP95Ms = preflightLatencySamplesMs.length > 0 ? percentile95(preflightLatencySamplesMs) : 0;

  const coverageRatio = eligibleSessions === 0 ? 1 : coveredSessions / eligibleSessions;
  const ready =
    coverageRatio >= 0.95 &&
    repositoryCoverage.missing.length === 0 &&
    adapterCoverage.missing.length === 0 &&
    preflightLatencyP95Ms <= 500 &&
    openDriftCount === 0 &&
    openInvalidContractCount === 0 &&
    Boolean(signerEvidenceCurrent) &&
    Boolean(recoveryEvidenceCurrent) &&
    Boolean(threatModelEvidenceCurrent) &&
    Boolean(rollbackEvidenceCurrent);

  const windowStartIso = windowStartDate.toISOString();
  const windowEndIso = windowEndDate.toISOString();
  const reportId = deterministicReportId(digestCanonical({ organization_id: parsedOrganizationId, window_start: windowStartIso, window_end: windowEndIso }));

  const report = parseContract(
    ReadinessReportSchema,
    {
      schema_version: 1,
      contract: 'readiness-report/v1',
      report_id: reportId,
      organization_id: parsedOrganizationId,
      window_start: windowStartIso,
      window_end: windowEndIso,
      window_days: WINDOW_DAYS,
      eligible_sessions: eligibleSessions,
      covered_sessions: coveredSessions,
      repositories_covered: repositoryCoverage.covered,
      repositories_missing_evidence: repositoryCoverage.missing,
      adapters_covered: adapterCoverage.covered,
      adapters_missing_evidence: adapterCoverage.missing,
      preflight_latency_p95_ms: preflightLatencyP95Ms,
      open_drift_count: openDriftCount,
      open_invalid_contract_count: openInvalidContractCount,
      remote_unavailable_samples: remoteUnavailableSamples,
      signer_evidence_current: Boolean(signerEvidenceCurrent),
      recovery_evidence_current: Boolean(recoveryEvidenceCurrent),
      threat_model_evidence_current: Boolean(threatModelEvidenceCurrent),
      rollback_evidence_current: Boolean(rollbackEvidenceCurrent),
      ready,
      authorizes_enforcement: false,
      evaluated_at: evaluatedAt,
    },
    'readiness report',
  );

  return repository.recordReadinessEvaluation({ organization_id: parsedOrganizationId, actor, report });
}

module.exports = {
  deterministicReportId,
  evaluateShadowReadiness,
  percentile95,
};
