'use strict';

const { assertGovernanceRepository } = require('../domain/repository-port');

async function rollbackImport({ repository, organizationId, repositoryId, batchId, actor, idempotencyKey }) {
  return assertGovernanceRepository(repository).rollbackImportBatch({
    organization_id: organizationId,
    repository_id: repositoryId,
    batch_id: batchId,
    actor,
    idempotency_key: idempotencyKey,
  });
}

module.exports = {
  rollbackImport,
};
