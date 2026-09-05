'use strict';

const { createProjectGovernanceQueryAdapter } = require('../lib/governance-query-adapter');

const identifier = { type: 'string', minLength: 1, maxLength: 160 };

function tool(name, description, method, portFactory, properties = {}, required = []) {
  return {
    name,
    description,
    inputSchema: { type: 'object', additionalProperties: false, properties, ...(required.length > 0 ? { required } : {}) },
    handler(_db, args) {
      const port = portFactory();
      return port[method](args);
    },
  };
}

function createManagedQueryTools(portFactory = createProjectGovernanceQueryAdapter) {
  return [
    tool(
      'get_effective_governance_context',
      'Get the effective managed-shadow governance context',
      'getEffectiveGovernanceContext',
      portFactory,
      { repository_id: identifier },
      ['repository_id'],
    ),
    tool(
      'evaluate_governed_action',
      'Evaluate an action without changing local authority',
      'evaluateGovernedAction',
      portFactory,
      { context: { type: 'object' } },
      ['context'],
    ),
    tool(
      'explain_governance_decision',
      'Explain a managed-shadow governance decision',
      'explainGovernanceDecision',
      portFactory,
      { context: { type: 'object' } },
      ['context'],
    ),
    tool(
      'get_governance_artifact',
      'Read one immutable governance artifact',
      'getGovernanceArtifact',
      portFactory,
      { artifact_id: identifier },
      ['artifact_id'],
    ),
    tool(
      'get_governance_release',
      'Read one immutable governance release',
      'getGovernanceRelease',
      portFactory,
      { release_id: identifier },
      ['release_id'],
    ),
    tool(
      'diff_governance_releases',
      'Read two releases for deterministic comparison',
      'diffGovernanceReleases',
      portFactory,
      { base_release_id: identifier, target_release_id: identifier },
      ['base_release_id', 'target_release_id'],
    ),
    tool(
      'verify_governance_snapshot',
      'Read a snapshot for digest verification',
      'verifyGovernanceSnapshot',
      portFactory,
      { snapshot_id: identifier },
      ['snapshot_id'],
    ),
    tool('get_governance_session_status', 'Read managed-shadow session and sidecar readiness', 'getGovernanceSessionStatus', portFactory),
    tool(
      'get_governance_session_preflight',
      'Compare the local Constitution with the managed-shadow catalog without changing authority',
      'getGovernanceSessionPreflight',
      portFactory,
    ),
    // Read-only by construction: getGovernanceReadiness only ever GETs /api/v1/readiness. There
    // is deliberately no MCP tool for submitting a shadow receipt -- that stays CLI/hook-only
    // (FR-006/ADR-0023: MCP never carries mutable governance authority).
    tool('get_governance_readiness', 'Read the current 30-day managed-shadow readiness report, if one has been evaluated', 'getGovernanceReadiness', portFactory),
  ];
}

module.exports = createManagedQueryTools();
module.exports.createManagedQueryTools = createManagedQueryTools;
