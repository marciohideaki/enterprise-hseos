'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
// eslint-disable-next-line n/no-unsupported-features/node-builtins -- describe is available throughout the supported Node 20 line
const { describe, test } = require('node:test');
const { digestCanonical } = require('../../packages/managed-governance-contracts');
const { ImportCatalogService } = require('../../tools/managed-governance-control-plane/lib/application/import-catalog');
const { rollbackImport } = require('../../tools/managed-governance-control-plane/lib/application/rollback-import');
const { classifySource } = require('../../tools/managed-governance-control-plane/lib/infrastructure/git/classifiers');
const {
  MemoryGovernanceRepository,
} = require('../../tools/managed-governance-control-plane/lib/infrastructure/memory/governance-repository');

const ORGANIZATION_ID = 'managed-import-test';
const REPOSITORY_ID = '7f9f9b79-638c-4138-9a29-8a2406ad9fb8';
const ACTOR = { type: 'automation', id: 'managed-import-test' };
const CANONICAL_REMOTE = 'https://example.invalid/hseos.git';

function digest(content) {
  return `sha256:${crypto.createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

function entry(sourcePath, rawContent, sourceKind = 'policy') {
  const normalizedContent = rawContent.replace(/^\uFEFF/, '').replaceAll(/\r\n?/g, '\n');
  const base = {
    source_path: sourcePath,
    source_kind: sourceKind,
    raw_content: rawContent,
    normalized_content: normalizedContent,
    content_digest: digest(normalizedContent),
  };
  return { ...base, classification: classifySource(base) };
}

function discovery(sourceCommit, entries) {
  return {
    schema_version: 1,
    repository_id: REPOSITORY_ID,
    source_commit: sourceCommit,
    source_timestamp: '2026-09-01T00:00:00.000Z',
    source_profile: 'enterprise-hseos:v1',
    source_profile_digest: digestCanonical({ profile: 'enterprise-hseos:v1' }),
    entries,
  };
}

function source(initialDiscovery) {
  return {
    current: initialDiscovery,
    async discover() {
      return structuredClone(this.current);
    },
  };
}

async function createService(initialDiscovery) {
  const repository = new MemoryGovernanceRepository({ clock: () => new Date('2026-09-01T01:00:00.000Z') });
  const mutableSource = source(initialDiscovery);
  const service = new ImportCatalogService({ repository, source: mutableSource });
  await repository.ensureOrganization({
    organization_id: ORGANIZATION_ID,
    idempotency_key: 'ensure-managed-import-test',
    actor: ACTOR,
    organization: { slug: ORGANIZATION_ID, display_name: 'Managed Import Test' },
  });
  return { repository, mutableSource, service };
}

describe('managed governance catalog synchronization', () => {
  test('applies create, review, version, rename and deactivate with exact parity', async () => {
    const firstDiscovery = discovery('a'.repeat(40), [
      entry('policies/a.md', '# Policy A\nFirst\n'),
      entry('policies/b.md', '# Policy B\n'),
      entry('unknown/review.md', '# Needs review\n', 'unknown'),
    ]);
    const { repository, mutableSource, service } = await createService(firstDiscovery);
    const first = await service.plan({ organizationId: ORGANIZATION_ID, importerVersion: '1.0.0' });
    const firstApplied = await service.apply({ ...first, actor: ACTOR, canonicalRemote: CANONICAL_REMOTE });
    assert.equal(firstApplied.parity.accounted, true);
    assert.deepEqual(firstApplied.report.counts, {
      discovered: 3,
      classified: 2,
      partial: 0,
      unclassified: 1,
      created: 2,
      versioned: 0,
      unchanged: 0,
      review_required: 1,
    });
    const firstCatalog = await repository.listCatalogEntries(ORGANIZATION_ID, REPOSITORY_ID);

    const repeat = await service.plan({ organizationId: ORGANIZATION_ID, importerVersion: '1.0.0' });
    const repeated = await service.apply({ ...repeat, actor: ACTOR, canonicalRemote: CANONICAL_REMOTE });
    assert.equal(repeated.parity.accounted, true);
    assert.equal(repeated.report.batch_id, firstApplied.report.batch_id);
    assert.equal(repeated.report.counts.unchanged, 2);
    assert.deepEqual(await repository.listCatalogEntries(ORGANIZATION_ID, REPOSITORY_ID), firstCatalog);

    mutableSource.current = discovery('b'.repeat(40), [
      entry('policies/a.md', '# Policy A\nChanged\n'),
      entry('policies/renamed-b.md', '# Policy B\n'),
    ]);
    const second = await service.plan({ organizationId: ORGANIZATION_ID, importerVersion: '1.0.0' });
    assert.deepEqual(Object.fromEntries(second.plan.items.map((item) => [item.source_path, item.action])), {
      'policies/a.md': 'version',
      'policies/renamed-b.md': 'rename',
      'unknown/review.md': 'deactivate',
    });
    const secondApplied = await service.apply({ ...second, actor: ACTOR, canonicalRemote: CANONICAL_REMOTE });
    assert.equal(secondApplied.parity.accounted, true);
    const secondCatalog = await repository.listCatalogEntries(ORGANIZATION_ID, REPOSITORY_ID);
    assert.deepEqual(
      secondCatalog.map((item) => item.source_path),
      ['policies/a.md', 'policies/renamed-b.md'],
    );
    assert.notEqual(
      secondCatalog.find((item) => item.source_path === 'policies/a.md').artifact_version_id,
      firstCatalog.find((item) => item.source_path === 'policies/a.md').artifact_version_id,
    );
    assert.equal(
      secondCatalog.find((item) => item.source_path === 'policies/renamed-b.md').artifact_version_id,
      firstCatalog.find((item) => item.source_path === 'policies/b.md').artifact_version_id,
    );

    const rolledBack = await rollbackImport({
      repository,
      organizationId: ORGANIZATION_ID,
      repositoryId: REPOSITORY_ID,
      batchId: secondApplied.report.batch_id,
      actor: ACTOR,
      idempotencyKey: 'rollback-second-import',
    });
    assert.equal(rolledBack.status, 'rolled-back');
    assert.deepEqual(await repository.listCatalogEntries(ORGANIZATION_ID, REPOSITORY_ID), firstCatalog);
    assert.deepEqual(
      (await repository.listAuditEvents(ORGANIZATION_ID)).map((event) => event.event_type),
      ['organization.ensured', 'catalog.import.completed', 'catalog.import.completed', 'catalog.import.rolled-back'],
    );
  });

  test('rejects forged plan identity and altered source bytes before persistence', async () => {
    const original = discovery('c'.repeat(40), [entry('policies/a.md', '# Policy A\n')]);
    const { repository, service } = await createService(original);
    const planned = await service.plan({ organizationId: ORGANIZATION_ID, importerVersion: '1.0.0' });
    const forgedPlan = { ...planned.plan, plan_id: digest('forged') };
    await assert.rejects(
      service.apply({ discovery: planned.discovery, plan: forgedPlan, actor: ACTOR, canonicalRemote: CANONICAL_REMOTE }),
      (error) => error.code === 'MANAGED_GOVERNANCE_IMPORT_PLAN_INTEGRITY_FAILED',
    );
    const alteredDiscovery = structuredClone(planned.discovery);
    alteredDiscovery.entries[0].raw_content = '# Altered\n';
    await assert.rejects(
      service.apply({ discovery: alteredDiscovery, plan: planned.plan, actor: ACTOR, canonicalRemote: CANONICAL_REMOTE }),
      (error) => error.code === 'MANAGED_GOVERNANCE_IMPORT_DISCOVERY_MISMATCH',
    );
    assert.deepEqual(await repository.listCatalogEntries(ORGANIZATION_ID, REPOSITORY_ID), []);
    assert.equal((await repository.listAuditEvents(ORGANIZATION_ID)).length, 1);
  });
});
