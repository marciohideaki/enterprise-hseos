'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const { digestCanonical } = require('../../packages/managed-governance-contracts');
const { ImportCatalogService } = require('../../tools/managed-governance-control-plane/lib/application/import-catalog');
const { rollbackImport } = require('../../tools/managed-governance-control-plane/lib/application/rollback-import');
const { classifySource } = require('../../tools/managed-governance-control-plane/lib/infrastructure/git/classifiers');
const { createPostgresPool } = require('../../tools/managed-governance-control-plane/lib/infrastructure/postgres/pool');
const { migrate } = require('../../tools/managed-governance-control-plane/lib/infrastructure/postgres/migrator');
const {
  PostgresGovernanceRepository,
} = require('../../tools/managed-governance-control-plane/lib/infrastructure/postgres/governance-repository');
const { runRepositoryContract } = require('./repository-contract.test');

const DATABASE_URL = process.env.HSEOS_GOVERNANCE_TEST_DATABASE_URL;

function contentDigest(content) {
  return `sha256:${crypto.createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

function discoveredEntry(sourcePath, rawContent) {
  const normalizedContent = rawContent.replaceAll(/\r\n?/g, '\n');
  const base = {
    source_path: sourcePath,
    source_kind: 'policy',
    raw_content: rawContent,
    normalized_content: normalizedContent,
    content_digest: contentDigest(normalizedContent),
  };
  return { ...base, classification: classifySource(base) };
}

function discoveredCatalog(repositoryId, commit, entries) {
  return {
    schema_version: 1,
    repository_id: repositoryId,
    source_commit: commit,
    source_timestamp: '2026-09-01T00:00:00.000Z',
    source_profile: 'enterprise-hseos:v1',
    source_profile_digest: digestCanonical({ profile: 'enterprise-hseos:v1' }),
    entries,
  };
}

test(
  'PostgreSQL migration and repository integration',
  { skip: DATABASE_URL ? false : 'HSEOS_GOVERNANCE_TEST_DATABASE_URL is not set' },
  async (context) => {
    const pool = createPostgresPool({ connectionString: DATABASE_URL, max: 4, applicationName: 'hseos-governance-test' });
    try {
      const first = await migrate(pool);
      const second = await migrate(pool);
      assert.equal(first.current_version, '0004');
      assert.deepEqual(second, { applied: [], current_version: '0004' });

      await context.test('creates every core table with fail-closed tenant RLS', async () => {
        const expectedTables = [
          'acceptance_receipts',
          'artifact_relations',
          'artifact_versions',
          'audit_events',
          'catalog_source_snapshots',
          'command_receipts',
          'draft_reviews',
          'drafts',
          'governance_artifacts',
          'governance_exceptions',
          'governance_releases',
          'governance_rules',
          'import_batch_items',
          'import_batches',
          'organizations',
          'outbox_messages',
          'project_assignments',
          'projection_checkpoints',
          'publication_requests',
          'release_items',
          'release_signatures',
          'repositories',
          'review_queue',
          'revocations',
          'rule_scopes',
          'session_leases',
          'subjects',
        ];
        const tables = await pool.query(
          `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'hseos_governance' AND c.relkind = 'r'
            ORDER BY c.relname`,
        );
        const tenantTables = tables.rows.filter((row) => row.relname !== 'schema_migrations');
        assert.deepEqual(
          tenantTables.map((row) => row.relname),
          expectedTables,
        );
        assert.ok(tenantTables.every((row) => row.relrowsecurity && row.relforcerowsecurity));
        const organizationColumns = await pool.query(
          `SELECT table_name
             FROM information_schema.columns
            WHERE table_schema = 'hseos_governance' AND column_name = 'organization_id'
            ORDER BY table_name`,
        );
        assert.deepEqual(
          organizationColumns.rows.map((row) => row.table_name),
          expectedTables,
        );
      });

      await runRepositoryContract(
        context,
        async () => new PostgresGovernanceRepository({ pool, clock: () => new Date('2026-09-01T00:00:00.000Z') }),
        'postgres',
      );

      await context.test('applies, repeats, versions and rolls back a catalog transactionally', async () => {
        const suffix = crypto.randomBytes(6).toString('hex');
        const organizationId = `postgres-import-${suffix}`;
        const repositoryId = crypto.randomUUID();
        const actor = { type: 'automation', id: 'postgres-import-test' };
        const source = {
          current: discoveredCatalog(repositoryId, 'a'.repeat(40), [discoveredEntry('policies/a.md', '# Policy A\n')]),
          async discover() {
            return structuredClone(this.current);
          },
        };
        const repository = new PostgresGovernanceRepository({
          pool,
          clock: () => new Date('2026-09-01T03:00:00.000Z'),
        });
        const service = new ImportCatalogService({ repository, source });
        await repository.ensureOrganization({
          organization_id: organizationId,
          idempotency_key: 'ensure-import-organization',
          actor,
          organization: { slug: organizationId, display_name: 'PostgreSQL Import Test' },
        });
        const firstPlan = await service.plan({ organizationId, importerVersion: '1.0.0' });
        const first = await service.apply({
          ...firstPlan,
          actor,
          canonicalRemote: 'https://example.invalid/postgres-import.git',
        });
        const firstCatalog = await repository.listCatalogEntries(organizationId, repositoryId);
        const repeatedPlan = await service.plan({ organizationId, importerVersion: '1.0.0' });
        const repeated = await service.apply({
          ...repeatedPlan,
          actor,
          canonicalRemote: 'https://example.invalid/postgres-import.git',
        });
        assert.equal(repeated.report.batch_id, first.report.batch_id);
        assert.equal(repeated.report.counts.unchanged, 1);

        source.current = discoveredCatalog(repositoryId, 'b'.repeat(40), [discoveredEntry('policies/a.md', '# Policy A\nChanged\n')]);
        const secondPlan = await service.plan({ organizationId, importerVersion: '1.0.0' });
        const second = await service.apply({
          ...secondPlan,
          actor,
          canonicalRemote: 'https://example.invalid/postgres-import.git',
        });
        const secondCatalog = await repository.listCatalogEntries(organizationId, repositoryId);
        assert.notEqual(secondCatalog[0].artifact_version_id, firstCatalog[0].artifact_version_id);
        const versions = await pool.query(
          'SELECT count(*)::integer AS count FROM hseos_governance.artifact_versions WHERE organization_id = $1',
          [organizationId],
        );
        assert.equal(versions.rows[0].count, 2);

        await rollbackImport({
          repository,
          organizationId,
          repositoryId,
          batchId: second.report.batch_id,
          actor,
          idempotencyKey: 'rollback-import-batch',
        });
        assert.deepEqual(await repository.listCatalogEntries(organizationId, repositoryId), firstCatalog);
        const immutableVersions = await pool.query(
          'SELECT count(*)::integer AS count FROM hseos_governance.artifact_versions WHERE organization_id = $1',
          [organizationId],
        );
        assert.equal(immutableVersions.rows[0].count, 2);
        await repository.close();
      });

      await context.test('preserves the prior active catalog when import audit persistence fails', async () => {
        const suffix = crypto.randomBytes(6).toString('hex');
        const organizationId = `failed-import-${suffix}`;
        const repositoryId = crypto.randomUUID();
        const actor = { type: 'automation', id: 'failed-import-test' };
        const source = {
          current: discoveredCatalog(repositoryId, 'c'.repeat(40), [discoveredEntry('policies/a.md', '# Stable\n')]),
          async discover() {
            return structuredClone(this.current);
          },
        };
        const repository = new PostgresGovernanceRepository({ pool });
        const service = new ImportCatalogService({ repository, source });
        await repository.ensureOrganization({
          organization_id: organizationId,
          idempotency_key: 'ensure-failed-import-organization',
          actor,
          organization: { slug: organizationId, display_name: 'Failed Import Test' },
        });
        const firstPlan = await service.plan({ organizationId, importerVersion: '1.0.0' });
        await service.apply({ ...firstPlan, actor, canonicalRemote: 'https://example.invalid/failed-import.git' });
        const stableCatalog = await repository.listCatalogEntries(organizationId, repositoryId);

        await pool.query(`
          CREATE OR REPLACE FUNCTION hseos_governance.test_reject_import_audit()
          RETURNS trigger LANGUAGE plpgsql AS $body$
          BEGIN
            IF NEW.organization_id = '${organizationId}' AND NEW.event_type = 'catalog.import.completed' THEN
              RAISE EXCEPTION 'injected import audit failure';
            END IF;
            RETURN NEW;
          END
          $body$;
          DROP TRIGGER IF EXISTS test_reject_import_audit ON hseos_governance.audit_events;
          CREATE TRIGGER test_reject_import_audit
          BEFORE INSERT ON hseos_governance.audit_events
          FOR EACH ROW EXECUTE FUNCTION hseos_governance.test_reject_import_audit();
        `);
        source.current = discoveredCatalog(repositoryId, 'd'.repeat(40), [discoveredEntry('policies/a.md', '# Uncommitted candidate\n')]);
        try {
          const failedPlan = await service.plan({ organizationId, importerVersion: '1.0.0' });
          await assert.rejects(
            service.apply({ ...failedPlan, actor, canonicalRemote: 'https://example.invalid/failed-import.git' }),
            (error) => error.code === 'MANAGED_GOVERNANCE_DATABASE_FAILED',
          );
        } finally {
          await pool.query('DROP TRIGGER IF EXISTS test_reject_import_audit ON hseos_governance.audit_events');
          await pool.query('DROP FUNCTION IF EXISTS hseos_governance.test_reject_import_audit()');
        }
        assert.deepEqual(await repository.listCatalogEntries(organizationId, repositoryId), stableCatalog);
        const retained = await pool.query(
          `SELECT
             (SELECT count(*) FROM hseos_governance.import_batches WHERE organization_id = $1)::integer AS batches,
             (SELECT count(*) FROM hseos_governance.artifact_versions WHERE organization_id = $1)::integer AS versions`,
          [organizationId],
        );
        assert.deepEqual(retained.rows[0], { batches: 1, versions: 1 });
        await repository.close();
      });

      await context.test('rolls back domain state when the paired audit write fails', async () => {
        const organizationId = `rollback-${crypto.randomBytes(6).toString('hex')}`;
        await pool.query(`
          CREATE OR REPLACE FUNCTION hseos_governance.test_reject_audit_insert()
          RETURNS trigger LANGUAGE plpgsql AS $body$
          BEGIN
            IF NEW.aggregate_id LIKE 'rollback-%' THEN
              RAISE EXCEPTION 'injected audit failure';
            END IF;
            RETURN NEW;
          END
          $body$;
          DROP TRIGGER IF EXISTS test_reject_audit_insert ON hseos_governance.audit_events;
          CREATE TRIGGER test_reject_audit_insert
          BEFORE INSERT ON hseos_governance.audit_events
          FOR EACH ROW EXECUTE FUNCTION hseos_governance.test_reject_audit_insert();
        `);
        const repository = new PostgresGovernanceRepository({ pool });
        try {
          await assert.rejects(
            repository.ensureOrganization({
              organization_id: organizationId,
              idempotency_key: 'rollback-test',
              actor: { type: 'automation', id: 'postgres-integration-test' },
              organization: { slug: organizationId, display_name: 'Rollback Test' },
            }),
            (error) => error.code === 'MANAGED_GOVERNANCE_DATABASE_FAILED',
          );
        } finally {
          await repository.close();
          await pool.query('DROP TRIGGER IF EXISTS test_reject_audit_insert ON hseos_governance.audit_events');
          await pool.query('DROP FUNCTION IF EXISTS hseos_governance.test_reject_audit_insert()');
        }
        const rollbackChecks = new Map([
          ['organizations', 'SELECT count(*)::integer AS count FROM hseos_governance.organizations WHERE organization_id = $1'],
          ['audit_events', 'SELECT count(*)::integer AS count FROM hseos_governance.audit_events WHERE organization_id = $1'],
          ['outbox_messages', 'SELECT count(*)::integer AS count FROM hseos_governance.outbox_messages WHERE organization_id = $1'],
          ['command_receipts', 'SELECT count(*)::integer AS count FROM hseos_governance.command_receipts WHERE organization_id = $1'],
        ]);
        for (const [table, query] of rollbackChecks) {
          const result = await pool.query(query, [organizationId]);
          assert.equal(result.rows[0].count, 0, `${table} retained a partial write`);
        }
      });

      await context.test('database roles and immutable records are enforced by PostgreSQL', async () => {
        const roles = await pool.query('SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[]) ORDER BY rolname', [
          ['hseos_governance_application', 'hseos_governance_auditor', 'hseos_governance_migrator'],
        ]);
        assert.equal(roles.rows.length, 3);
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('SET LOCAL ROLE hseos_governance_application');
          const withoutTenant = await client.query('SELECT count(*)::integer AS count FROM hseos_governance.organizations');
          assert.equal(withoutTenant.rows[0].count, 0);
          await assert.rejects(
            client.query('UPDATE hseos_governance.audit_events SET event_type = $1', ['tampered']),
            (error) => error.code === '42501' || error.code === '55000',
          );
          await client.query('ROLLBACK');

          const organization = await pool.query(
            'SELECT organization_id FROM hseos_governance.organizations ORDER BY organization_id LIMIT 1',
          );
          assert.equal(organization.rows.length, 1);
          const outboxMessageId = crypto.randomUUID();
          await pool.query(
            `INSERT INTO hseos_governance.outbox_messages(
               outbox_message_id, organization_id, topic, aggregate_type, aggregate_id, payload, created_at
             ) VALUES ($1::uuid, $2, 'immutability.test', 'test', $1::text, '{}'::jsonb, CURRENT_TIMESTAMP)`,
            [outboxMessageId, organization.rows[0].organization_id],
          );
          await client.query('BEGIN');
          await client.query('SET LOCAL ROLE hseos_governance_application');
          await client.query("SELECT set_config('app.organization_id', $1, true)", [organization.rows[0].organization_id]);
          await assert.rejects(
            client.query("UPDATE hseos_governance.outbox_messages SET topic = 'tampered' WHERE outbox_message_id = $1", [outboxMessageId]),
            (error) => error.code === '55000',
          );
          await client.query('ROLLBACK');

          await client.query('BEGIN');
          await client.query('SET LOCAL ROLE hseos_governance_application');
          await client.query("SELECT set_config('app.organization_id', $1, true)", [organization.rows[0].organization_id]);
          await client.query(
            'UPDATE hseos_governance.outbox_messages SET delivered_at = CURRENT_TIMESTAMP, delivery_attempts = delivery_attempts + 1 WHERE outbox_message_id = $1',
            [outboxMessageId],
          );
          await client.query('COMMIT');

          await client.query('BEGIN');
          await client.query('SET LOCAL ROLE hseos_governance_application');
          await client.query("SELECT set_config('app.organization_id', $1, true)", [organization.rows[0].organization_id]);
          await assert.rejects(
            client.query(
              'UPDATE hseos_governance.outbox_messages SET delivery_attempts = delivery_attempts + 1 WHERE outbox_message_id = $1',
              [outboxMessageId],
            ),
            (error) => error.code === '55000',
          );
          await client.query('ROLLBACK');
        } finally {
          client.release();
        }
      });
    } finally {
      await pool.end();
    }
  },
);
