'use strict';

const { deepFreeze } = require('../../../../../packages/managed-governance-contracts');
const {
  GovernanceRepositoryError,
  buildOrganizationMutation,
  parseRepositoryIdentifier,
  prepareEnsureOrganizationCommand,
} = require('../../domain/repository-port');

function clone(value) {
  return value === null || value === undefined ? value : structuredClone(value);
}

class MemoryGovernanceRepository {
  constructor(options = {}) {
    this.clock = options.clock;
    this.organizations = new Map();
    this.receipts = new Map();
    this.auditEvents = [];
    this.outboxMessages = [];
    this.closed = false;
    this.queue = Promise.resolve();
  }

  _assertOpen() {
    if (this.closed) throw new GovernanceRepositoryError('governance repository is closed', 'MANAGED_GOVERNANCE_REPOSITORY_CLOSED');
  }

  _receiptKey(organizationId, idempotencyKey) {
    return `${organizationId}\0${idempotencyKey}`;
  }

  async ensureOrganization(command) {
    this._assertOpen();
    const prepared = prepareEnsureOrganizationCommand(command, { clock: this.clock });
    const execute = async () => {
      this._assertOpen();
      const receiptKey = this._receiptKey(prepared.organization_id, prepared.idempotency_key);
      const receipt = this.receipts.get(receiptKey);
      if (receipt) {
        if (receipt.command_digest !== prepared.command_digest) {
          throw new GovernanceRepositoryError(
            'idempotency key was already used for a different command',
            'MANAGED_GOVERNANCE_IDEMPOTENCY_CONFLICT',
          );
        }
        return deepFreeze(clone(receipt.result));
      }

      const existing = this.organizations.get(prepared.organization_id);
      if (existing && (existing.slug !== prepared.organization.slug || existing.display_name !== prepared.organization.display_name)) {
        throw new GovernanceRepositoryError('organization already exists with different data', 'MANAGED_GOVERNANCE_CONFLICT');
      }
      const mutation = buildOrganizationMutation(prepared, existing || null);
      this.organizations.set(prepared.organization_id, clone(mutation.organization));
      this.auditEvents.push(clone(mutation.auditEvent));
      this.outboxMessages.push(clone(mutation.outboxMessage));
      this.receipts.set(receiptKey, {
        organization_id: prepared.organization_id,
        idempotency_key: prepared.idempotency_key,
        command_digest: prepared.command_digest,
        result: clone(mutation.result),
        created_at: prepared.occurred_at,
      });
      return deepFreeze(clone(mutation.result));
    };
    const operation = this.queue.then(execute, execute);
    this.queue = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }

  async getOrganization(organizationId) {
    this._assertOpen();
    const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
    const value = this.organizations.get(parsedOrganizationId);
    return value ? deepFreeze(clone(value)) : null;
  }

  async getCommandReceipt(organizationId, idempotencyKey) {
    this._assertOpen();
    const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
    const parsedIdempotencyKey = parseRepositoryIdentifier(idempotencyKey, 'idempotency key');
    const value = this.receipts.get(this._receiptKey(parsedOrganizationId, parsedIdempotencyKey));
    return value ? deepFreeze(clone(value)) : null;
  }

  async listAuditEvents(organizationId) {
    this._assertOpen();
    const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
    return deepFreeze(clone(this.auditEvents.filter((event) => event.organization_id === parsedOrganizationId)));
  }

  async listOutboxMessages(organizationId) {
    this._assertOpen();
    const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
    return deepFreeze(clone(this.outboxMessages.filter((message) => message.organization_id === parsedOrganizationId)));
  }

  async close() {
    this.closed = true;
  }
}

module.exports = {
  MemoryGovernanceRepository,
};
