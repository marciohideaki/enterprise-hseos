// This release tooling is not shipped in the runtime package.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY = 'marciohideaki/enterprise-hseos';
export const VERSION = '4.0.0-ai-provider.5';
export const TAG = `v${VERSION}`;
export const MANIFEST_PATH = `docs/releases/${TAG}.compatibility.json`;
const REQUIRED = ['test (22.x)', 'test (24.x)', 'governance', 'Standalone clean-env smoke (node:22)', 'compose'];
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error('invalid release JSON');
  }
};
const write = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const run = (command, args, options = {}) => {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: 'pipe', maxBuffer: 16 * 1024 * 1024, ...options }).trim();
  } catch (error) {
    // Never relay signed asset URLs, authentication diagnostics or environment values.
    throw new Error(`${command} failed (exit ${error.status ?? 'unknown'})`);
  }
};
const gh = (args) => JSON.parse(run('gh', args));
const api = (endpoint) => gh(['api', `repos/${REPOSITORY}/${endpoint}`]);

export function releaseForTag(query = api, github = gh) {
  // Authenticated release lists include drafts; never assume the public tag endpoint does.
  const pages = github(['api', `repos/${REPOSITORY}/releases?per_page=100`, '--paginate', '--slurp']);
  assert.ok(Array.isArray(pages) && pages.every((page) => Array.isArray(page)), 'invalid release listing');
  const matches = pages.flat().filter((item) => item.tag_name === TAG);
  assert.equal(matches.length, 1, 'expected exactly one release for the candidate tag');
  assert.ok(Number.isSafeInteger(matches[0].id) && matches[0].id > 0);
  const release = query(`releases/${matches[0].id}`);
  assert.equal(release.id, matches[0].id);
  assert.equal(release.tag_name, TAG);
  return release;
}

function closedObject(value, allowed, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `invalid ${label}`);
  assert.ok(
    Object.keys(value).every((key) => allowed.includes(key)),
    `unknown ${label} field`,
  );
}

function artifactUrl(value, repository, registryPrefixes = []) {
  const url = new URL(value);
  assert.equal(url.protocol, 'https:');
  if (url.username || url.password || url.hash || url.search)
    throw new Error('credential-bearing or non-immutable artifact coordinate rejected');
  const githubPrefix = `https://github.com/${repository}/releases/download/`;
  assert.ok(
    url.href.startsWith(githubPrefix) || registryPrefixes.some((prefix) => url.href.startsWith(prefix)),
    'unexpected artifact origin',
  );
}

export function validateManifest(manifest) {
  closedObject(manifest, ['schema_version', 'state', 'hseos', 'ecp', 'sdks', 'source', 'artifacts'], 'compatibility manifest');
  closedObject(
    manifest.ecp,
    ['version', 'source_sha', 'capabilities', 'artifact_url', 'sha256', 'registry_sha256', 'stacks_sha256'],
    'ECP dependency',
  );
  closedObject(manifest.sdks, ['node', 'dotnet'], 'SDK set');
  assert.equal(manifest.schema_version, '1.0.0');
  assert.equal(manifest.state, 'frozen', 'dependency publication freeze is incomplete');
  assert.deepEqual(manifest.hseos, { repository: REPOSITORY, package: 'hseos', version: VERSION, tag: TAG });
  assert.equal(manifest.ecp.version, '0.6.2');
  assert.ok(SHA.test(manifest.ecp.source_sha));
  assert.ok(manifest.ecp.capabilities >= 26, 'must retain the upstream capability catalog');
  for (const field of ['sha256', 'registry_sha256', 'stacks_sha256']) assert.ok(DIGEST.test(manifest.ecp[field]), `invalid ECP ${field}`);
  artifactUrl(manifest.ecp.artifact_url, 'HideakiSolutions/enterprise-capability-platform');
  assert.equal(
    manifest.ecp.artifact_url,
    `https://github.com/HideakiSolutions/enterprise-capability-platform/releases/download/contracts-v${manifest.ecp.version}/ecp-contracts-${manifest.ecp.version}.tar.gz`,
  );
  for (const [key, name, version, prefix] of [
    [
      'node',
      '@hideakisolutions/platform-node',
      '0.3.0-experimental.3',
      ['https://gitea.hideakiservicos.net/api/packages/HideakiSolutions/npm/@hideakisolutions/platform-node/-/'],
    ],
    [
      'dotnet',
      'Hideakisolutions.Platform.Ai.ProviderAccess',
      '0.1.0-rc.3',
      ['https://gitea.hideakiservicos.net/api/packages/HideakiSolutions/nuget/package/hideakisolutions.platform.ai.provideraccess/'],
    ],
  ]) {
    const sdk = manifest.sdks[key];
    closedObject(
      sdk,
      key === 'dotnet'
        ? ['package', 'version', 'artifact_url', 'sha256', 'dependencies', 'source_sha']
        : ['package', 'version', 'artifact_url', 'sha256', 'source_sha'],
      'SDK dependency',
    );
    assert.equal(sdk.package, name);
    assert.equal(sdk.version, version);
    assert.ok(DIGEST.test(sdk.sha256));
    artifactUrl(sdk.artifact_url, 'HideakiSolutions/backend-core', prefix);
    assert.equal(sdk.source_sha, '1a127d4a8a29dde58e37c3a7ba6ddc6c70b781c2', 'SDK must retain the published source');
    const expectedUri =
      key === 'node'
        ? `https://gitea.hideakiservicos.net/api/packages/HideakiSolutions/npm/@hideakisolutions/platform-node/-/platform-node-${version}.tgz`
        : `https://gitea.hideakiservicos.net/api/packages/HideakiSolutions/nuget/package/${name.toLowerCase()}/${version}/${name.toLowerCase()}.${version}.nupkg`;
    assert.equal(sdk.artifact_url, expectedUri, 'SDK must use its exact published Gitea coordinate');
  }
  const dependencies = manifest.sdks.dotnet.dependencies;
  const expected = ['Hideakisolutions.Platform.Ai.Guardrails', 'Hideakisolutions.Platform.Ai.TokenMetering'];
  assert.ok(Array.isArray(dependencies));
  assert.deepEqual(dependencies.map((item) => item.package).sort(), expected);
  for (const dependency of dependencies) {
    closedObject(dependency, ['package', 'version', 'artifact_url', 'sha256', 'source_sha'], 'NuGet dependency');
    assert.equal(dependency.source_sha, '5ae206152797e1a109bd8ea23d5cf853aac48b6b', 'dependency source must remain original');
    assert.equal(dependency.version, '0.3.0');
    assert.ok(DIGEST.test(dependency.sha256));
    artifactUrl(dependency.artifact_url, 'HideakiSolutions/backend-core', [
      `https://gitea.hideakiservicos.net/api/packages/HideakiSolutions/nuget/package/${dependency.package.toLowerCase()}/`,
    ]);
    assert.equal(
      dependency.artifact_url,
      `https://gitea.hideakiservicos.net/api/packages/HideakiSolutions/nuget/package/${dependency.package.toLowerCase()}/${dependency.version}/${dependency.package.toLowerCase()}.${dependency.version}.nupkg`,
      'dependency must use exact published Gitea coordinate',
    );
  }
  return manifest;
}

export function validateSourceEvidence({ pr, source, tree, reviewedTree, runs, jobs }) {
  assert.ok(SHA.test(source));
  assert.ok(SHA.test(pr.headRefOid));
  assert.equal(pr.state, 'MERGED');
  assert.equal(pr.isCrossRepository, false);
  assert.equal(pr.baseRefName, 'master');
  assert.equal(pr.mergeCommit.oid, source, 'release source must be the recorded PR merge');
  assert.equal(tree, reviewedTree, 'merged and reviewed source trees differ');
  for (const workflow of Object.values(runs)) {
    if (workflow.event === 'pull_request' && workflow.head_sha === pr.headRefOid) {
      assert.equal(workflow.status, 'completed', 'an authoritative PR workflow is pending');
      assert.equal(workflow.conclusion, 'success', 'an authoritative PR workflow did not pass');
    }
  }
  const selected = [];
  for (const name of REQUIRED) {
    for (const check of pr.statusCheckRollup.filter((item) => item.name === name)) {
      const id = check.detailsUrl?.match(/\/actions\/runs\/(\d+)\/job\/\d+$/)?.[1];
      if (runs[id]?.event === 'pull_request' && runs[id].head_sha === pr.headRefOid) {
        assert.equal(check.status, 'COMPLETED');
        assert.equal(check.conclusion, 'SUCCESS', 'a nonpassing required PR check cannot be hidden by an older success');
      }
    }
    const candidates = pr.statusCheckRollup.filter(
      (check) => check.name === name && check.status === 'COMPLETED' && check.conclusion === 'SUCCESS',
    );
    const match = candidates.find((check) => {
      if (!check.detailsUrl?.startsWith(`https://github.com/${REPOSITORY}/actions/runs/`)) return false;
      const [, id, jobId] = check.detailsUrl.match(/\/actions\/runs\/(\d+)\/job\/(\d+)$/) || [];
      const workflow = runs[id];
      const job = jobs[jobId];
      return (
        workflow?.event === 'pull_request' &&
        workflow.head_sha === pr.headRefOid &&
        workflow.status === 'completed' &&
        workflow.conclusion === 'success' &&
        job?.run_id === Number(id) &&
        job.name === name &&
        job.head_sha === pr.headRefOid &&
        job.status === 'completed' &&
        job.conclusion === 'success'
      );
    });
    assert.ok(match, `missing authoritative passing PR context: ${name}`);
    selected.push({ name, status: match.status, conclusion: match.conclusion, detailsUrl: match.detailsUrl });
  }
  return {
    status: 'PASS',
    repository: REPOSITORY,
    source_sha: source,
    reviewed_head: pr.headRefOid,
    tree,
    pull_request: pr.number,
    checks: selected,
  };
}

function verifySource(source, number) {
  assert.ok(SHA.test(source));
  assert.ok(/^\d+$/.test(number));
  assert.equal(run('git', ['rev-parse', 'HEAD']), source);
  run('git', ['merge-base', '--is-ancestor', source, 'origin/master']);
  const pr = gh([
    'pr',
    'view',
    number,
    '--repo',
    REPOSITORY,
    '--json',
    'number,state,baseRefName,headRefOid,mergeCommit,isCrossRepository,statusCheckRollup',
  ]);
  assert.ok(SHA.test(pr.headRefOid));
  const runs = {};
  const jobs = {};
  for (const check of pr.statusCheckRollup) {
    const [, id, jobId] = check.detailsUrl?.match(/\/actions\/runs\/(\d+)\/job\/(\d+)$/) || [];
    if (id && !runs[id]) runs[id] = api(`actions/runs/${id}`);
    if (REQUIRED.includes(check.name) && jobId && runs[id]?.event === 'pull_request' && !jobs[jobId])
      jobs[jobId] = api(`actions/jobs/${jobId}`);
  }
  const evidence = validateSourceEvidence({
    pr,
    source,
    tree: run('git', ['rev-parse', `${source}^{tree}`]),
    reviewedTree: run('git', ['rev-parse', `${pr.headRefOid}^{tree}`]),
    runs,
    jobs,
  });
  assert.equal(json('package.json').version, VERSION);
  return evidence;
}

export function validateSnapshot(manifest, root) {
  const base = path.join(root, '.enterprise/governance/capabilities');
  for (const [name, hash] of [
    ['registry', manifest.ecp.registry_sha256],
    ['stacks', manifest.ecp.stacks_sha256],
  ]) {
    const bytes = fs.readFileSync(path.join(base, `ecp-${name}.snapshot.json`));
    const lock = json(path.join(base, `ecp-${name}.snapshot.lock.json`));
    assert.equal(digest(bytes), hash);
    assert.equal(lock.sha256, hash);
    assert.equal(lock.ref, manifest.ecp.source_sha);
    assert.equal(lock.contracts_version, manifest.ecp.version);
  }
  const registry = json(path.join(base, 'ecp-registry.snapshot.json'));
  assert.equal(registry.generated_from.contracts_version, manifest.ecp.version);
  assert.equal(registry.generated_from.repository, 'HideakiSolutions/enterprise-capability-platform');
  assert.equal(registry.capabilities.length, manifest.ecp.capabilities);
  const capability = registry.capabilities.find((item) => item.name === 'ai.provider-access');
  assert.ok(capability);
  for (const sdk of Object.values(manifest.sdks)) {
    assert.ok(
      capability.implementations.some((item) => item.package === sdk.package && item.package_version === sdk.version),
      `snapshot does not bind published SDK ${sdk.package}`,
    );
  }
}

// Private Gitea artifacts use only the scoped reader. No reader token enters CI.
export function dependencyHeaders(location) {
  assert.equal(location.origin, 'https://gitea.hideakiservicos.net', 'unexpected authenticated registry');
  const user = process.env.GITEA_PACKAGE_READER_USER;
  const token = process.env.GITEA_PACKAGE_READER_TOKEN;
  assert.equal(user, 'pkg-read-hideakisolutions', 'owner-scoped reader identity required');
  assert.ok(token && !/[\r\n]/.test(token), 'scoped reader token must be supplied privately');
  return { Authorization: `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}` };
}

// curl uses the existing verified system HTTPS transport (the public Gitea edge
// rejects some default Node/Python agents). Redirects remain manual and the
// caller strips credentials across origins. Secrets enter stdin, never argv.
export async function registryFetch(url, { headers = {} } = {}) {
  const location = new URL(url);
  assert.equal(location.protocol, 'https:');
  assert.ok(!location.username && !location.password);
  assert.ok(process.env.TMPDIR && path.isAbsolute(process.env.TMPDIR), 'explicit disk-backed TMPDIR required');
  const directory = fs.mkdtempSync(path.join(process.env.TMPDIR, 'hseos-dependency-'));
  try {
    const output = path.join(directory, 'body');
    const head = path.join(directory, 'headers');
    let config = `url = ${JSON.stringify(url)}\n`;
    for (const [key, value] of Object.entries(headers)) {
      assert.ok(/^[A-Za-z0-9-]+$/.test(key) && typeof value === 'string' && !/[\r\n]/.test(value));
      config += `header = ${JSON.stringify(`${key}: ${value}`)}\n`;
    }
    const status = Number(
      run(
        'curl',
        [
          '--disable',
          '--silent',
          '--show-error',
          '--proto',
          '=https',
          '--max-time',
          '60',
          '--max-filesize',
          '134217728',
          '--dump-header',
          head,
          '--output',
          output,
          '--write-out',
          '%{http_code}',
          '--config',
          '-',
        ],
        { input: config },
      ),
    );
    const lines = fs
      .readFileSync(head, 'utf8')
      .trim()
      .split(/\r?\n\r?\n/)
      .at(-1)
      .split(/\r?\n/)
      .slice(1);
    const responseHeaders = new Map(
      lines
        .filter((line) => line.includes(':'))
        .map((line) => [line.slice(0, line.indexOf(':')).toLowerCase(), line.slice(line.indexOf(':') + 1).trim()]),
    );
    const bytes = fs.readFileSync(output);
    assert.ok(bytes.length <= 128 * 1024 * 1024);
    return { status, headers: responseHeaders, body: [bytes] };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

export async function downloadVerified(url, expectedHash, initialHeaders = {}, fetcher = registryFetch) {
  let current = new URL(url);
  // Bypass cached expired signed registry redirects without storing their URLs.
  current.searchParams.set('hseos_readback', randomUUID());
  let headers = { ...initialHeaders };
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    assert.equal(current.protocol, 'https:');
    assert.ok(!current.username && !current.password);
    const response = await fetcher(current.href, { headers, signal: AbortSignal.timeout(60_000), redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      assert.ok(location, 'dependency redirect has no destination');
      const next = new URL(location, current);
      if (next.origin !== current.origin) headers = {};
      await response.body?.cancel?.();
      current = next;
      continue;
    }
    assert.equal(response.status, 200, 'published dependency could not be downloaded');
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      assert.ok(size <= 128 * 1024 * 1024, 'dependency artifact exceeds the release limit');
      hash.update(chunk);
    }
    assert.equal(hash.digest('hex'), expectedHash, 'published dependency digest differs');
    return;
  }
  throw new Error('dependency redirect limit exceeded');
}

export async function verifyDependencies(manifest, scratch) {
  for (const dependency of [manifest.ecp, ...Object.values(manifest.sdks), ...manifest.sdks.dotnet.dependencies]) {
    const location = new URL(dependency.artifact_url);
    if (location.hostname === 'github.com') {
      const parts = location.pathname
        .split('/')
        .filter(Boolean)
        .map((part) => decodeURIComponent(part));
      assert.equal(parts.length, 6);
      const [owner, repository, releases, download, tag, asset] = parts;
      assert.equal(`${releases}/${download}`, 'releases/download');
      assert.ok(/^[A-Za-z0-9._-]+$/.test(tag) && /^[A-Za-z0-9._-]+$/.test(asset));
      const published = gh(['api', `repos/${owner}/${repository}/releases/tags/${tag}`]);
      assert.equal(published.draft, false);
      assert.equal(published.immutable, true, 'GitHub dependency release must be natively immutable');
      const directory = fs.mkdtempSync(path.join(scratch, 'dependency-'));
      run('gh', ['release', 'download', tag, '--repo', `${owner}/${repository}`, '--pattern', asset, '--dir', directory]);
      assert.equal(digest(fs.readFileSync(path.join(directory, asset))), dependency.sha256, 'published dependency digest differs');
      continue;
    }
    await downloadVerified(dependency.artifact_url, dependency.sha256, dependencyHeaders(location));
  }
}

export function assetNames() {
  return [`hseos-${VERSION}.tgz`, `hseos-${VERSION}.cdx.json`, `hseos-${VERSION}.compatibility.json`];
}

export function verifyAssetDirectory(directory, expectedManifestHash) {
  const names = assetNames();
  const checksumFile = path.join(directory, 'SHA256SUMS');
  assert.ok(fs.lstatSync(checksumFile).isFile());
  const checksumText = fs.readFileSync(checksumFile, 'utf8');
  const sums = checksumText.trim().split('\n');
  assert.equal(sums.length, names.length);
  const recorded = new Map();
  for (const line of sums) {
    const parsed = line.match(/^([a-f0-9]{64}) {2}([A-Za-z0-9.-]+)$/);
    assert.ok(parsed && names.includes(parsed[2]) && !recorded.has(parsed[2]), 'unexpected or duplicate checksum entry');
    recorded.set(parsed[2], parsed[1]);
  }
  for (const name of names) {
    const file = path.join(directory, name);
    assert.ok(fs.lstatSync(file).isFile(), 'release assets must be regular files');
    assert.equal(digest(fs.readFileSync(file)), recorded.get(name), `asset digest mismatch: ${name}`);
  }
  assert.equal(
    checksumText,
    `${names.map((name) => `${recorded.get(name)}  ${name}`).join('\n')}\n`,
    'checksums must retain their canonical sealed bytes',
  );
  const manifestName = names[2];
  if (expectedManifestHash)
    assert.equal(recorded.get(manifestName), expectedManifestHash, 'compatibility manifest differs from the expected sealed digest');
  const manifest = validateManifest(json(path.join(directory, manifestName)));
  assert.deepEqual(Object.keys(manifest.artifacts).sort(), names.slice(0, 2).sort());
  for (const name of names.slice(0, 2))
    assert.equal(manifest.artifacts[name], recorded.get(name), 'the expected compatibility digest must bind the package and SBOM bytes');
  assert.ok(SHA.test(manifest.source.source_sha));
  assert.ok(SHA.test(manifest.source.reviewed_head));
  assert.ok(SHA.test(manifest.source.tree));
  assert.equal(manifest.source.repository, REPOSITORY);
  assert.equal(manifest.source.status, 'PASS');
  return { manifest, hashes: Object.fromEntries(recorded) };
}

async function seal(directory, evidenceFile) {
  const manifest = validateManifest(json(MANIFEST_PATH));
  validateSnapshot(manifest, process.cwd());
  const source = json(evidenceFile);
  assert.equal(source.status, 'PASS');
  assert.equal(source.source_sha, run('git', ['rev-parse', 'HEAD']));
  fs.mkdirSync(directory, { recursive: true });
  assert.deepEqual(fs.readdirSync(directory), [], 'pack destination must start empty');
  const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', directory]));
  assert.equal(packed.length, 1);
  assert.equal(packed[0].filename, assetNames()[0]);
  fs.writeFileSync(path.join(directory, assetNames()[1]), `${run('npm', ['sbom', '--sbom-format', 'cyclonedx'])}\n`);
  const artifacts = Object.fromEntries(
    assetNames()
      .slice(0, 2)
      .map((name) => [name, digest(fs.readFileSync(path.join(directory, name)))]),
  );
  write(path.join(directory, assetNames()[2]), { ...manifest, source, artifacts });
  fs.writeFileSync(
    path.join(directory, 'SHA256SUMS'),
    `${assetNames()
      .map((name) => `${digest(fs.readFileSync(path.join(directory, name)))}  ${name}`)
      .join('\n')}\n`,
  );
  return verifyAssetDirectory(directory);
}

export function validateRelease(release, ref, expectedSource, files) {
  assert.equal(release.tag_name, TAG);
  assert.equal(release.prerelease, true);
  assert.equal(ref.object.type, 'commit');
  assert.equal(ref.object.sha, expectedSource);
  assert.deepEqual(release.assets.map((asset) => asset.name).sort(), [...assetNames(), 'SHA256SUMS'].sort());
  for (const asset of release.assets) {
    assert.equal(asset.state, 'uploaded');
    assert.equal(asset.digest, `sha256:${digest(fs.readFileSync(path.join(files, asset.name)))}`);
  }
}

async function stage(directory, expectedSource, manifestHash) {
  const assets = verifyAssetDirectory(directory, manifestHash);
  assert.equal(assets.manifest.source.source_sha, expectedSource);
  assert.ok(SHA.test(expectedSource));
  // POST is create-only: an existing reference is never moved.
  gh(['api', '--method', 'POST', `repos/${REPOSITORY}/git/refs`, '-f', `ref=refs/tags/${TAG}`, '-f', `sha=${expectedSource}`]);
  run('gh', [
    'release',
    'create',
    TAG,
    '--repo',
    REPOSITORY,
    '--verify-tag',
    '--target',
    expectedSource,
    '--draft',
    '--prerelease',
    '--latest=false',
    '--title',
    TAG,
    '--notes-file',
    `docs/releases/${TAG}.md`,
    ...[...assetNames(), 'SHA256SUMS'].map((name) => path.join(directory, name)),
  ]);
  const release = releaseForTag();
  assert.equal(release.draft, true, 'CI only stages a draft');
  validateRelease(release, api(`git/ref/tags/${TAG}`), expectedSource, directory);
  return { status: 'DRAFT_VERIFIED_NOT_PUBLISHED', tag: TAG, source_sha: expectedSource, release_id: release.id, hashes: assets.hashes };
}

export async function finalize(expectedSource, manifestHash, publish, ports = {}) {
  const query = ports.api || api;
  const github = ports.gh || gh;
  const execute = ports.run || run;
  const dependencies = ports.verifyDependencies || verifyDependencies;
  assert.ok(process.env.GH_TOKEN, 'GH_TOKEN must be supplied privately by the operator');
  assert.ok(SHA.test(expectedSource) && DIGEST.test(manifestHash));
  assert.ok(process.env.TMPDIR && path.isAbsolute(process.env.TMPDIR), 'an explicit disk-backed TMPDIR is required');
  const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR, 'hseos-release-finalize-'));
  try {
    const release = releaseForTag(query, github);
    execute('gh', ['release', 'download', TAG, '--repo', REPOSITORY, '--dir', scratch]);
    const assets = verifyAssetDirectory(scratch, manifestHash);
    assert.equal(assets.manifest.source.source_sha, expectedSource);
    validateRelease(release, query(`git/ref/tags/${TAG}`), expectedSource, scratch);
    if (!release.draft) {
      assert.equal(release.immutable, true, 'a published mutable release is not accepted');
      return {
        status: 'PASS',
        publication: 'already-immutable',
        release_id: release.id,
        tag: TAG,
        source_sha: expectedSource,
        hashes: assets.hashes,
      };
    }
    // Private dependency credentials are confined to this external finalizer,
    // never the public repository's CI build or draft job.
    await dependencies(assets.manifest, scratch);
    const policy = query('immutable-releases');
    assert.equal(policy.enabled, true, 'repository immutable releases must be enabled before publication');
    if (!publish) return { status: 'PASS', publication: 'validation-only', tag: TAG, source_sha: expectedSource, hashes: assets.hashes };
    const published = github([
      'api',
      '--method',
      'PATCH',
      `repos/${REPOSITORY}/releases/${release.id}`,
      '-F',
      'draft=false',
      '-F',
      'prerelease=true',
      '-f',
      'make_latest=false',
    ]);
    assert.equal(published.draft, false);
    assert.equal(published.immutable, true, 'server did not seal the published release');
    validateRelease(published, query(`git/ref/tags/${TAG}`), expectedSource, scratch);
    return {
      status: 'PASS',
      publication: 'immutable',
      release_id: published.id,
      url: published.html_url,
      tag: TAG,
      source_sha: expectedSource,
      hashes: assets.hashes,
    };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

async function main(args) {
  const [command, ...values] = args;
  let result;
  switch (command) {
    case 'verify-source': {
      result = verifySource(values[0], values[1]);
      break;
    }
    case 'seal': {
      result = await seal(path.resolve(values[0]), values[1]);
      break;
    }
    case 'verify-assets': {
      result = verifyAssetDirectory(values[0], values[1]);
      break;
    }
    case 'stage': {
      result = await stage(values[0], values[1], values[2]);
      break;
    }
    case 'finalize': {
      result = await finalize(values[0], values[1], values[2] === '--publish');
      break;
    }
    default: {
      throw new Error('Expected verify-source, seal, verify-assets, stage or finalize');
    }
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(`Provider distribution rejected: ${error.code === 'ERR_ASSERTION' ? 'release evidence check failed' : error.message}`);
    process.exitCode = 1;
  }
}
