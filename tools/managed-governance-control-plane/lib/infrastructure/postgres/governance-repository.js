'use strict';

const { randomUUID } = require('node:crypto');
const { deepFreeze } = require('../../../../../packages/managed-governance-contracts');
const {
  GovernanceRepositoryError,
  buildOrganizationMutation,
  parseRepositoryIdentifier,
  prepareEnsureOrganizationCommand,
} = require('../../domain/repository-port');

function freezeRows(rows) {
  return deepFreeze(
    rows.map((row) =>
      Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value])),
    ),
  );
}

function databaseError(error, fallbackCode = 'MANAGED_GOVERNANCE_DATABASE_FAILED') {
  if (error instanceof GovernanceRepositoryError) return error;
  const mapping = new Map([
    ['23503', 'MANAGED_GOVERNANCE_CONFLICT'],
    ['23505', 'MANAGED_GOVERNANCE_CONFLICT'],
    ['23514', 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID'],
    ['40001', 'MANAGED_GOVERNANCE_DATABASE_RETRYABLE'],
    ['40P01', 'MANAGED_GOVERNANCE_DATABASE_RETRYABLE'],
    ['42501', 'MANAGED_GOVERNANCE_DATABASE_FORBIDDEN'],
  ]);
  return new GovernanceRepositoryError('PostgreSQL governance operation failed', mapping.get(error?.code) || fallbackCode, {
    database_code: typeof error?.code === 'string' ? error.code : null,
  });
}

class PostgresGovernanceRepository {
  constructor({ pool, clock, closePool = false }) {
    if (!pool || typeof pool.connect !== 'function') {
      throw new GovernanceRepositoryError('a PostgreSQL pool is required', 'MANAGED_GOVERNANCE_POSTGRES_CONFIG_INVALID');
    }
    this.pool = pool;
    this.clock = clock;
    this.closePool = closePool;
    this.closed = false;
  }

  _assertOpen() {
    if (this.closed) throw new GovernanceRepositoryError('governance repository is closed', 'MANAGED_GOVERNANCE_REPOSITORY_CLOSED');
  }

  async _transaction(organizationId, operation) {
    this._assertOpen();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE hseos_governance_application');
      await client.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The original error remains authoritative.
      }
      throw databaseError(error);
    } finally {
      client.release();
    }
  }

  async ensureOrganization(command) {
    const prepared = prepareEnsureOrganizationCommand(command, { clock: this.clock });
    return this._transaction(prepared.organization_id, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        JSON.stringify([prepared.organization_id, prepared.idempotency_key]),
      ]);
      const receiptResult = await client.query(
        'SELECT command_digest, result FROM hseos_governance.command_receipts WHERE organization_id = $1 AND idempotency_key = $2',
        [prepared.organization_id, prepared.idempotency_key],
      );
      const receipt = receiptResult.rows[0];
      if (receipt) {
        if (receipt.command_digest !== prepared.command_digest) {
          throw new GovernanceRepositoryError(
            'idempotency key was already used for a different command',
            'MANAGED_GOVERNANCE_IDEMPOTENCY_CONFLICT',
          );
        }
        return deepFreeze(structuredClone(receipt.result));
      }

      const existingResult = await client.query(
        'SELECT organization_pk, organization_id, slug, display_name, created_at FROM hseos_governance.organizations WHERE organization_id = $1',
        [prepared.organization_id],
      );
      const existing = freezeRows(existingResult.rows)[0] || null;
      if (existing && (existing.slug !== prepared.organization.slug || existing.display_name !== prepared.organization.display_name)) {
        throw new GovernanceRepositoryError('organization already exists with different data', 'MANAGED_GOVERNANCE_CONFLICT');
      }
      const mutation = buildOrganizationMutation(prepared, existing);
      if (!existing) {
        await client.query(
          'INSERT INTO hseos_governance.organizations(organization_pk, organization_id, slug, display_name, created_at) VALUES ($1, $2, $3, $4, $5)',
          [
            mutation.organization.organization_pk,
            mutation.organization.organization_id,
            mutation.organization.slug,
            mutation.organization.display_name,
            mutation.organization.created_at,
          ],
        );
      }
      await client.query(
        'INSERT INTO hseos_governance.audit_events(audit_event_id, organization_id, event_type, aggregate_type, aggregate_id, actor, payload, occurred_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)',
        [
          mutation.auditEvent.audit_event_id,
          mutation.auditEvent.organization_id,
          mutation.auditEvent.event_type,
          mutation.auditEvent.aggregate_type,
          mutation.auditEvent.aggregate_id,
          JSON.stringify(mutation.auditEvent.actor),
          JSON.stringify(mutation.auditEvent.payload),
          mutation.auditEvent.occurred_at,
        ],
      );
      await client.query(
        'INSERT INTO hseos_governance.outbox_messages(outbox_message_id, organization_id, topic, aggregate_type, aggregate_id, payload, created_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)',
        [
          mutation.outboxMessage.outbox_message_id,
          mutation.outboxMessage.organization_id,
          mutation.outboxMessage.topic,
          mutation.outboxMessage.aggregate_type,
          mutation.outboxMessage.aggregate_id,
          JSON.stringify(mutation.outboxMessage.payload),
          mutation.outboxMessage.created_at,
        ],
      );
      await client.query(
        'INSERT INTO hseos_governance.command_receipts(command_receipt_id, organization_id, idempotency_key, command_digest, result, created_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6)',
        [
          randomUUID(),
          prepared.organization_id,
          prepared.idempotency_key,
          prepared.command_digest,
          JSON.stringify(mutation.result),
          prepared.occurred_at,
        ],
      );
      return mutation.result;
    });
  }

  async _readTenant(organizationId, query, parameters) {
    return this._transaction(organizationId, async (client) => freezeRows((await client.query(query, parameters)).rows));
  }

  async getOrganization(organizationId) {
    const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
    const rows = await this._readTenant(
      parsedOrganizationId,
      'SELECT organization_pk, organization_id, slug, display_name, created_at FROM hseos_governance.organizations WHERE organization_id = $1',
      [parsedOrganizationId],
    );
    return rows[0] || null;
  }

  async getCommandReceipt(organizationId, idempotencyKey) {
    const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
    const parsedIdempotencyKey = parseRepositoryIdentifier(idempotencyKey, 'idempotency key');
    const rows = await this._readTenant(
      parsedOrganizationId,
      'SELECT organization_id, idempotency_key, command_digest, result, created_at FROM hseos_governance.command_receipts WHERE organization_id = $1 AND idempotency_key = $2',
      [parsedOrganizationId, parsedIdempotencyKey],
    );
    return rows[0] || null;
  }

  async listAuditEvents(organizationId) {
    const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
    return this._readTenant(
      parsedOrganizationId,
      'SELECT audit_event_id, organization_id, event_type, aggregate_type, aggregate_id, actor, payload, occurred_at FROM hseos_governance.audit_events WHERE organization_id = $1 ORDER BY occurred_at, audit_event_id',
      [parsedOrganizationId],
    );
  }

  async listOutboxMessages(organizationId) {
    const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
    return this._readTenant(
      parsedOrganizationId,
      'SELECT outbox_message_id, organization_id, topic, aggregate_type, aggregate_id, payload, created_at, delivered_at FROM hseos_governance.outbox_messages WHERE organization_id = $1 ORDER BY created_at, outbox_message_id',
      [parsedOrganizationId],
    );
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.closePool && typeof this.pool.end === 'function') await this.pool.end();
  }
}

module.exports = {
  PostgresGovernanceRepository,
  databaseError,
};
