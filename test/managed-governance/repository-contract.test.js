'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { assertGovernanceRepository } = require('../../tools/managed-governance-control-plane/lib/domain/repository-port');
const {
  MemoryGovernanceRepository,
} = require('../../tools/managed-governance-control-plane/lib/infrastructure/memory/governance-repository');
const { readMigrations } = require('../../tools/managed-governance-control-plane/lib/infrastructure/postgres/migrator');
const { createPostgresPool } = require('../../tools/managed-governance-control-plane/lib/infrastructure/postgres/pool');

function organizationCommand(organizationId, idempotencyKey, displayName = 'Managed Governance Test') {
  return {
    organization_id: organizationId,
    idempotency_key: idempotencyKey,
    actor: { type: 'automation', id: 'repository-contract-test' },
    organization: { slug: organizationId, display_name: displayName },
  };
}

async function runRepositoryContract(context, createRepository, label) {
  const suffix = crypto.randomBytes(6).toString('hex');
  const organizationId = `${label}-${suffix}`;
  const otherOrganizationId = `${label}-other-${suffix}`;
  const repository = assertGovernanceRepository(await createRepository());

  await context.test('commits domain state, audit, outbox and receipt atomically', async () => {
    const result = await repository.ensureOrganization(organizationCommand(organizationId, 'organization-create'));
    assert.equal(result.operation, 'organization.ensure');
    assert.equal(result.organization.organization_id, organizationId);
    assert.equal(Object.isFrozen(result), true);
    assert.deepEqual(await repository.getOrganization(organizationId), result.organization);
    assert.equal((await repository.listAuditEvents(organizationId)).length, 1);
    assert.equal((await repository.listOutboxMessages(organizationId)).length, 1);
    assert.equal((await repository.getCommandReceipt(organizationId, 'organization-create')).command_digest.length, 71);
  });

  await context.test('returns the original result for an exact idempotent retry', async () => {
    const command = organizationCommand(organizationId, 'organization-create');
    const first = await repository.ensureOrganization(command);
    const second = await repository.ensureOrganization(command);
    assert.deepEqual(second, first);
    assert.equal((await repository.listAuditEvents(organizationId)).length, 1);
    assert.equal((await repository.listOutboxMessages(organizationId)).length, 1);
  });

  await context.test('rejects conflicting idempotency reuse without partial writes', async () => {
    await assert.rejects(
      repository.ensureOrganization(organizationCommand(organizationId, 'organization-create', 'Changed Name')),
      (error) => error.code === 'MANAGED_GOVERNANCE_IDEMPOTENCY_CONFLICT',
    );
    assert.equal((await repository.listAuditEvents(organizationId)).length, 1);
    assert.equal((await repository.listOutboxMessages(organizationId)).length, 1);
    assert.equal((await repository.getOrganization(organizationId)).display_name, 'Managed Governance Test');
  });

  await context.test('serializes concurrent retries to one committed mutation', async () => {
    const command = organizationCommand(otherOrganizationId, 'concurrent-create');
    const [left, right] = await Promise.all([repository.ensureOrganization(command), repository.ensureOrganization(command)]);
    assert.deepEqual(left, right);
    assert.equal((await repository.listAuditEvents(otherOrganizationId)).length, 1);
    assert.equal((await repository.listOutboxMessages(otherOrganizationId)).length, 1);
  });

  await context.test('keeps tenant reads isolated and closes explicitly', async () => {
    assert.equal(await repository.getOrganization(`${label}-absent-${suffix}`), null);
    assert.deepEqual(await repository.listAuditEvents(`${label}-absent-${suffix}`), []);
    await repository.close();
    await assert.rejects(repository.getOrganization(organizationId), (error) => error.code === 'MANAGED_GOVERNANCE_REPOSITORY_CLOSED');
  });
}

if (require.main === module) {
  test('in-memory governance repository satisfies the v1 port contract', async (context) => {
    await runRepositoryContract(
      context,
      async () => new MemoryGovernanceRepository({ clock: () => new Date('2026-09-01T00:00:00.000Z') }),
      'memory',
    );
  });

  test('migration reader pins bounded regular files and rejects link aliases', async () => {
    const migrationsDirectory = path.resolve(__dirname, '../../tools/managed-governance-control-plane/migrations');
    const migrations = await readMigrations(migrationsDirectory);
    assert.equal(migrations.length, 1);
    assert.equal(Object.isFrozen(migrations), true);
    assert.match(migrations[0].checksum, /^sha256:[a-f0-9]{64}$/);

    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-governance-migrations-'));
    try {
      const target = path.join(fixture, 'target.sql');
      fs.writeFileSync(target, 'SELECT 1;');
      const hardDirectory = path.join(fixture, 'hard');
      fs.mkdirSync(hardDirectory);
      fs.linkSync(target, path.join(hardDirectory, '0001_hard.sql'));
      await assert.rejects(readMigrations(hardDirectory), (error) => error.code === 'MANAGED_GOVERNANCE_MIGRATION_INVALID');

      const symbolicDirectory = path.join(fixture, 'symbolic');
      fs.mkdirSync(symbolicDirectory);
      fs.symlinkSync(target, path.join(symbolicDirectory, '0001_symbolic.sql'));
      await assert.rejects(readMigrations(symbolicDirectory), (error) => error.code === 'MANAGED_GOVERNANCE_MIGRATION_INVALID');
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('pool configuration is closed, bounded and does not load a driver when injected', () => {
    class FakePool {
      constructor(options) {
        this.options = options;
      }
    }
    const pool = createPostgresPool({ connectionString: 'postgresql://localhost/governance', max: 2 }, FakePool);
    assert.equal(pool.options.max, 2);
    assert.equal(pool.options.statement_timeout, 15_000);
    assert.throws(
      () => createPostgresPool({ connectionString: 'https://localhost/governance' }, FakePool),
      (error) => error.code === 'MANAGED_GOVERNANCE_POSTGRES_CONFIG_INVALID',
    );
    assert.throws(
      () => createPostgresPool({ connectionString: 'postgresql://localhost/governance', unknown: true }, FakePool),
      (error) => error.code === 'MANAGED_GOVERNANCE_POSTGRES_CONFIG_INVALID',
    );
  });
}

module.exports = {
  runRepositoryContract,
};
