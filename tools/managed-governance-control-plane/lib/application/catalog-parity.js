'use strict';

const { ImportReportSchema, deepFreeze, parseContract } = require('../../../../packages/managed-governance-contracts');

function countImportItems(items) {
  const count = (field, value) => items.filter((item) => item[field] === value).length;
  return deepFreeze({
    discovered: items.length,
    classified: count('classification_status', 'classified'),
    partial: count('classification_status', 'partial'),
    unclassified: count('classification_status', 'unclassified'),
    created: count('action', 'create'),
    versioned: count('action', 'version'),
    unchanged: count('action', 'noop'),
    review_required: count('action', 'review'),
  });
}

function buildImportReport({ batchId, plan, status, startedAt, completedAt, activeBatch }) {
  return parseContract(
    ImportReportSchema,
    {
      schema_version: 1,
      batch_id: batchId,
      plan_id: plan.plan_id,
      batch_key: plan.batch_key,
      organization_id: plan.organization_id,
      repository_id: plan.repository_id,
      status,
      started_at: startedAt,
      completed_at: completedAt,
      active_batch: activeBatch,
      counts: countImportItems(plan.items),
      items: plan.items,
      issues: plan.issues,
    },
    'import report',
  );
}

function catalogParity(plan, report) {
  const parsedReport = parseContract(ImportReportSchema, report, 'import report');
  const planPaths = plan.items.map((item) => item.source_path).sort();
  const reportPaths = parsedReport.items.map((item) => item.source_path).sort();
  const accounted =
    parsedReport.plan_id === plan.plan_id &&
    parsedReport.batch_key === plan.batch_key &&
    parsedReport.organization_id === plan.organization_id &&
    parsedReport.repository_id === plan.repository_id &&
    planPaths.length === reportPaths.length &&
    planPaths.every((sourcePath, index) => sourcePath === reportPaths[index]);
  return deepFreeze({
    schema_version: 1,
    plan_id: plan.plan_id,
    batch_id: parsedReport.batch_id,
    accounted,
    counts: parsedReport.counts,
    issues: parsedReport.issues,
  });
}

module.exports = {
  buildImportReport,
  catalogParity,
  countImportItems,
};
