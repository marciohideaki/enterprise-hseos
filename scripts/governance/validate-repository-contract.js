const fs = require('node:fs');
const path = require('node:path');
const yaml = require('yaml');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MANIFEST_RE = /^\.agents\/capabilities\/[A-Za-z0-9._/-]+\.ya?ml$/;

function validateRepositoryContract(data, repositoryRoot) {
  const issues = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ['root must be a YAML object'];
  if (data.schema_version !== 'repository-contract/v1') issues.push('schema_version must be repository-contract/v1');
  if (typeof data.repository_id !== 'string' || !UUID_RE.test(data.repository_id)) issues.push('repository_id must be a RFC 4122 UUID');
  const remotes = data.identity?.remotes;
  if (!Array.isArray(remotes) || remotes.some((value) => typeof value !== 'string' || !value.trim()))
    issues.push('identity.remotes must be an array of non-empty strings');
  if (Array.isArray(remotes) && new Set(remotes).size !== remotes.length) issues.push('identity.remotes must not contain duplicates');
  const manifest = data.capabilities?.manifest;
  if (manifest !== null && (typeof manifest !== 'string' || !MANIFEST_RE.test(manifest)))
    issues.push('capabilities.manifest must be null or a .agents/capabilities/*.yaml path');
  if (typeof manifest === 'string' && !fs.existsSync(path.join(repositoryRoot, manifest)))
    issues.push(`capabilities.manifest does not exist: ${manifest}`);
  const allowed = new Set(['schema_version', 'repository_id', 'identity', 'capabilities']);
  for (const key of Object.keys(data)) if (!allowed.has(key)) issues.push(`unexpected root property: ${key}`);
  return issues;
}

function main(argv) {
  const repositoryRoot = path.resolve(argv[2] || process.cwd());
  const contractPath = path.join(repositoryRoot, 'repository-contract.yaml');
  if (!fs.existsSync(contractPath)) {
    console.error(`FAIL: mandatory repository contract missing: ${contractPath}`);
    return 1;
  }
  let data;
  try {
    data = yaml.parse(fs.readFileSync(contractPath, 'utf8'));
  } catch (error) {
    console.error(`FAIL: could not parse ${contractPath}: ${error.message}`);
    return 1;
  }
  const issues = validateRepositoryContract(data, repositoryRoot);
  if (issues.length > 0) {
    for (const issue of issues) console.error(`FAIL: ${issue}`);
    return 1;
  }
  console.log(`OK: repository-contract/v1 valid for ${data.repository_id}`);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv);

module.exports = { validateRepositoryContract };
