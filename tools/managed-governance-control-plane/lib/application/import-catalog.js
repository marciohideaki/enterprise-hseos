'use strict';

const { digestCanonical } = require('../../../../packages/managed-governance-contracts');
const { assertGovernanceRepository } = require('../domain/repository-port');
const { buildImportPlan } = require('../domain/import-plan');
const { catalogParity } = require('./catalog-parity');

class ImportCatalogService {
  constructor({ repository, source }) {
    this.repository = assertGovernanceRepository(repository);
    if (!source || typeof source.discover !== 'function') throw new TypeError('governance source with discover() is required');
    this.source = source;
  }

  async plan({ organizationId, importerVersion }) {
    const discovery = await this.source.discover();
    const existingEntries = await this.repository.listCatalogEntries(organizationId, discovery.repository_id);
    const plan = buildImportPlan({ discovery, existingEntries, organizationId, importerVersion });
    return { discovery, plan };
  }

  async apply({ discovery, plan, actor, idempotencyKey, canonicalRemote }) {
    const commandKey =
      idempotencyKey || `catalog-import:${digestCanonical({ plan_id: plan.plan_id, actor, canonical_remote: canonicalRemote }).slice(7)}`;
    const report = await this.repository.applyImportBatch({
      discovery,
      plan,
      actor,
      idempotency_key: commandKey,
      canonical_remote: canonicalRemote,
    });
    return { report, parity: catalogParity(plan, report) };
  }

  async seedCurrent({ organizationId, organizationDisplayName, importerVersion, actor, canonicalRemote }) {
    const { discovery, plan } = await this.plan({ organizationId, importerVersion });
    await this.repository.ensureOrganization({
      organization_id: organizationId,
      idempotency_key: `catalog-seed-org:${digestCanonical({
        organization_id: organizationId,
        repository_id: discovery.repository_id,
        actor,
        organization: { slug: organizationId, display_name: organizationDisplayName },
      }).slice(7)}`,
      actor,
      organization: { slug: organizationId, display_name: organizationDisplayName },
    });
    const applied = await this.apply({ discovery, plan, actor, canonicalRemote });
    return { discovery, plan, ...applied };
  }
}

module.exports = {
  ImportCatalogService,
};
