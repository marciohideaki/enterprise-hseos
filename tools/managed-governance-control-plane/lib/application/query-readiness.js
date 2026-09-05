'use strict';

const { digestCanonical } = require('../../../../packages/managed-governance-contracts');
const { GovernanceRepositoryError, assertGovernanceRepository, parseRepositoryIdentifier } = require('../domain/repository-port');
const { deterministicReportId } = require('./evaluate-readiness');

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;

// FR-016/T07: readiness is always evaluated over "the most recently completed 30 consecutive
// UTC days" -- there is deliberately no new repository method here to list or find "the latest"
// evaluation. evaluateShadowReadiness (T07) already derives report_id deterministically from
// (organization_id, window_start, window_end); this function derives the exact same window for
// "now" and looks up the exact same id. If a readiness evaluation has been run for that window,
// this finds it under any adapter (CLI, HTTP, MCP, console) that calls it; if not, "not yet
// evaluated" is itself honest, real evidence -- never a guess, never a stale report served as if
// it were current.
function mostRecentCompletedWindow(asOf) {
  const asOfMs = Date.parse(asOf);
  if (Number.isNaN(asOfMs)) {
    throw new GovernanceRepositoryError('as-of timestamp is invalid', 'MANAGED_GOVERNANCE_READINESS_QUERY_INVALID');
  }
  const windowEndMs = Math.floor(asOfMs / DAY_MS) * DAY_MS;
  const windowStartMs = windowEndMs - WINDOW_DAYS * DAY_MS;
  return {
    windowStart: new Date(windowStartMs).toISOString(),
    windowEnd: new Date(windowEndMs).toISOString(),
  };
}

async function getCurrentReadiness({ organizationId, asOf }, context) {
  const repository = assertGovernanceRepository(context?.repository);
  const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
  const { windowStart, windowEnd } = mostRecentCompletedWindow(asOf || new Date().toISOString());
  const reportId = deterministicReportId(
    digestCanonical({ organization_id: parsedOrganizationId, window_start: windowStart, window_end: windowEnd }),
  );
  const record = await repository.getReadinessEvaluation(parsedOrganizationId, reportId);
  if (!record) {
    return Object.freeze({
      organization_id: parsedOrganizationId,
      window_start: windowStart,
      window_end: windowEnd,
      evaluated: false,
      ready: false,
      authorizes_enforcement: false,
      report: null,
    });
  }
  return Object.freeze({
    organization_id: parsedOrganizationId,
    window_start: record.window_start,
    window_end: record.window_end,
    evaluated: true,
    ready: record.ready,
    authorizes_enforcement: false,
    report: record,
  });
}

module.exports = {
  getCurrentReadiness,
  mostRecentCompletedWindow,
};
