'use strict';

const { randomUUID } = require('node:crypto');
const {
  IdentifierSchema,
  canonicalize,
  deepFreeze,
  digestCanonical,
  parseContract,
} = require('../../../../packages/managed-governance-contracts');

const REQUIRED_METHODS = Object.freeze([
  'ensureOrganization',
  'getOrganization',
  'getCommandReceipt',
  'listAuditEvents',
  'listOutboxMessages',
  'close',
]);

class GovernanceRepositoryError extends Error {
  constructor(message, code = 'MANAGED_GOVERNANCE_REPOSITORY_INVALID', details = {}) {
    super(message);
    this.name = 'GovernanceRepositoryError';
    this.code = code;
    this.details = details;
  }
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GovernanceRepositoryError(`${label} must be an object`);
  }
  const allowed = new Set(expected);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new GovernanceRepositoryError(`${label} contains unknown fields`, 'MANAGED_GOVERNANCE_REPOSITORY_UNKNOWN_FIELD', {
      fields: unknown.sort(),
    });
  }
}

function identifier(value, label) {
  try {
    return parseContract(IdentifierSchema, value, label);
  } catch (error) {
    throw new GovernanceRepositoryError(`${label} is invalid`, 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID', {
      cause: error.code,
    });
  }
}

function parseRepositoryIdentifier(value, label = 'repository identifier') {
  return identifier(value, label);
}

function boundedText(value, label, maximumBytes) {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0 || Buffer.byteLength(value, 'utf8') > maximumBytes) {
    throw new GovernanceRepositoryError(`${label} is invalid`, 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID');
  }
  return value;
}

function prepareEnsureOrganizationCommand(command, options = {}) {
  assertExactKeys(command, ['organization_id', 'idempotency_key', 'actor', 'organization'], 'organization command');
  assertExactKeys(command.actor, ['type', 'id'], 'actor');
  assertExactKeys(command.organization, ['slug', 'display_name'], 'organization');
  const prepared = {
    organization_id: identifier(command.organization_id, 'organization id'),
    idempotency_key: identifier(command.idempotency_key, 'idempotency key'),
    actor: {
      type: identifier(command.actor.type, 'actor type'),
      id: identifier(command.actor.id, 'actor id'),
    },
    organization: {
      slug: identifier(command.organization.slug, 'organization slug'),
      display_name: boundedText(command.organization.display_name, 'organization display name', 512),
    },
  };
  if (prepared.organization.slug !== prepared.organization_id) {
    throw new GovernanceRepositoryError(
      'organization slug must equal organization_id in v1',
      'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID',
    );
  }
  const now = options.clock ? options.clock() : new Date();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new GovernanceRepositoryError('repository clock returned an invalid date');
  }
  return deepFreeze({
    ...prepared,
    command_digest: digestCanonical(prepared),
    occurred_at: now.toISOString(),
    audit_event_id: randomUUID(),
    outbox_message_id: randomUUID(),
  });
}

function buildOrganizationMutation(prepared, existingOrganization = null) {
  const organization = existingOrganization || {
    organization_pk: randomUUID(),
    organization_id: prepared.organization_id,
    slug: prepared.organization.slug,
    display_name: prepared.organization.display_name,
    created_at: prepared.occurred_at,
  };
  const result = {
    schema_version: 1,
    operation: 'organization.ensure',
    organization,
  };
  const auditEvent = {
    audit_event_id: prepared.audit_event_id,
    organization_id: prepared.organization_id,
    event_type: 'organization.ensured',
    aggregate_type: 'organization',
    aggregate_id: prepared.organization_id,
    actor: prepared.actor,
    payload: { slug: organization.slug, display_name: organization.display_name },
    occurred_at: prepared.occurred_at,
  };
  const outboxMessage = {
    outbox_message_id: prepared.outbox_message_id,
    organization_id: prepared.organization_id,
    topic: 'governance.organization.ensured',
    aggregate_type: 'organization',
    aggregate_id: prepared.organization_id,
    payload: { audit_event_id: auditEvent.audit_event_id, organization },
    created_at: prepared.occurred_at,
    delivered_at: null,
  };
  canonicalize(result);
  canonicalize(auditEvent);
  canonicalize(outboxMessage);
  return deepFreeze({ organization, result, auditEvent, outboxMessage });
}

function assertGovernanceRepository(repository) {
  if (!repository || typeof repository !== 'object') {
    throw new GovernanceRepositoryError('governance repository is required');
  }
  const missing = REQUIRED_METHODS.filter((method) => typeof repository[method] !== 'function');
  if (missing.length > 0) {
    throw new GovernanceRepositoryError(
      'governance repository does not implement the v1 port',
      'MANAGED_GOVERNANCE_REPOSITORY_PORT_INVALID',
      {
        missing,
      },
    );
  }
  return repository;
}

module.exports = {
  GovernanceRepositoryError,
  REQUIRED_METHODS,
  assertGovernanceRepository,
  buildOrganizationMutation,
  parseRepositoryIdentifier,
  prepareEnsureOrganizationCommand,
};
