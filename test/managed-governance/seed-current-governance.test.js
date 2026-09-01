'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { ImportCatalogService } = require('../../tools/managed-governance-control-plane/lib/application/import-catalog');
const { GitGovernanceSource } = require('../../tools/managed-governance-control-plane/lib/infrastructure/git/governance-source');
const {
  MemoryGovernanceRepository,
} = require('../../tools/managed-governance-control-plane/lib/infrastructure/memory/governance-repository');
const { createCommittedGovernanceFixture } = require('./git-fixture');

const REPOSITORY_ROOT = path.resolve(__dirname, '../..');

test('current canonical governance seeds through the normal import path and then no-ops', async () => {
  const sourceRepository = createCommittedGovernanceFixture(REPOSITORY_ROOT);
  const repository = new MemoryGovernanceRepository({ clock: () => new Date('2026-09-01T02:00:00.000Z') });
  const service = new ImportCatalogService({
    repository,
    source: new GitGovernanceSource({ repositoryRoot: sourceRepository }),
  });
  const input = {
    organizationId: 'hideaki-solutions',
    organizationDisplayName: 'Hideaki Solutions',
    importerVersion: '1.0.0',
    actor: { type: 'automation', id: 'governance-seed-test' },
    canonicalRemote: 'https://github.com/marciohideaki/enterprise-hseos.git',
  };
  try {
    const first = await service.seedCurrent(input);
    assert.equal(first.parity.accounted, true);
    assert.equal(first.report.counts.discovered, first.discovery.entries.length);
    assert.ok(first.discovery.entries.some((entry) => entry.classification.artifact_type === 'constitution'));
    assert.ok(first.report.counts.created > 0);
    const firstCatalog = await repository.listCatalogEntries('hideaki-solutions', first.discovery.repository_id);

    const second = await service.seedCurrent(input);
    assert.equal(second.parity.accounted, true);
    assert.equal(second.report.batch_id, first.report.batch_id);
    assert.equal(second.report.counts.created, 0);
    assert.equal(second.report.counts.versioned, 0);
    assert.ok(second.report.counts.unchanged > 0);
    assert.deepEqual(await repository.listCatalogEntries('hideaki-solutions', first.discovery.repository_id), firstCatalog);
    assert.deepEqual(
      (await repository.listAuditEvents('hideaki-solutions')).map((event) => event.event_type),
      ['organization.ensured', 'catalog.import.completed'],
    );
  } finally {
    fs.rmSync(sourceRepository, { recursive: true, force: true });
  }
});
