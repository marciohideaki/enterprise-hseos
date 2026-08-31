const assert = require('node:assert/strict');
const { validateRepositoryContract } = require('../scripts/governance/validate-repository-contract.js');

const valid = {
  schema_version: 'repository-contract/v1',
  repository_id: 'baf2e4be-710d-4b4f-9306-c5bcb9dd2a29',
  identity: { remotes: ['github.com/hideakisolutions/example'] },
  capabilities: { manifest: null },
};

assert.deepEqual(validateRepositoryContract(valid, process.cwd()), []);
assert.match(validateRepositoryContract({ ...valid, repository_id: 'not-a-uuid' }, process.cwd()).join('\n'), /repository_id/);
assert.match(validateRepositoryContract({ ...valid, identity: { remotes: ['same', 'same'] } }, process.cwd()).join('\n'), /duplicates/);
assert.match(
  validateRepositoryContract({ ...valid, capabilities: { manifest: '.agents/capabilities/missing.yaml' } }, process.cwd()).join('\n'),
  /does not exist/,
);
console.log('repository identity contract tests passed');
