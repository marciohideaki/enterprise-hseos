'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const { createPostgresPool } = require('../../tools/managed-governance-control-plane/lib/infrastructure/postgres/pool');
const { migrate } = require('../../tools/managed-governance-control-plane/lib/infrastructure/postgres/migrator');
const {
  PostgresGovernanceRepository,
} = require('../../tools/managed-governance-control-plane/lib/infrastructure/postgres/governance-repository');
const { runRepositoryContract } = require('./repository-contract.test');

const DATABASE_URL = process.env.HSEOS_GOVERNANCE_TEST_DATABASE_URL;

test(
  'PostgreSQL migration and repository integration',
  { skip: DATABASE_URL ? false : 'HSEOS_GOVERNANCE_TEST_DATABASE_URL is not set' },
  async (context) => {
    const pool = createPostgresPool({ connectionString: DATABASE_URL, max: 4, applicationName: 'hseos-governance-test' });
    try {
      const first = await migrate(pool);
      const second = await migrate(pool);
      assert.equal(first.current_version, '0001');
      assert.deepEqual(second, { applied: [], current_version: '0001' });

      await context.test('creates every core table with fail-closed tenant RLS', async () => {
        const expectedTables = [
          'acceptance_receipts',
          'artifact_relations',
          'artifact_versions',
          'audit_events',
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

          const outbox = await pool.query(
            'SELECT outbox_message_id, organization_id FROM hseos_governance.outbox_messages ORDER BY created_at LIMIT 1',
          );
          assert.equal(outbox.rows.length, 1);
          await client.query('BEGIN');
          await client.query('SET LOCAL ROLE hseos_governance_application');
          await client.query("SELECT set_config('app.organization_id', $1, true)", [outbox.rows[0].organization_id]);
          await assert.rejects(
            client.query("UPDATE hseos_governance.outbox_messages SET topic = 'tampered' WHERE outbox_message_id = $1", [
              outbox.rows[0].outbox_message_id,
            ]),
            (error) => error.code === '55000',
          );
          await client.query('ROLLBACK');

          await client.query('BEGIN');
          await client.query('SET LOCAL ROLE hseos_governance_application');
          await client.query("SELECT set_config('app.organization_id', $1, true)", [outbox.rows[0].organization_id]);
          await client.query(
            'UPDATE hseos_governance.outbox_messages SET delivered_at = CURRENT_TIMESTAMP, delivery_attempts = delivery_attempts + 1 WHERE outbox_message_id = $1',
            [outbox.rows[0].outbox_message_id],
          );
          await client.query('COMMIT');

          await client.query('BEGIN');
          await client.query('SET LOCAL ROLE hseos_governance_application');
          await client.query("SELECT set_config('app.organization_id', $1, true)", [outbox.rows[0].organization_id]);
          await assert.rejects(
            client.query(
              'UPDATE hseos_governance.outbox_messages SET delivery_attempts = delivery_attempts + 1 WHERE outbox_message_id = $1',
              [outbox.rows[0].outbox_message_id],
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
