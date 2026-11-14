// Publication-boundary regressions. No registry access, releases or model calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const yaml = require('yaml');

let release;
const originalToken = process.env.GH_TOKEN;
const originalTmpdir = process.env.TMPDIR;
let fixtureTmpdir;
before(async () => {
  release = await import('../.github/scripts/provider-distribution.mjs');
  process.env.GH_TOKEN = 'fixture-only-not-a-credential';
  const scratchBase = process.env.RUNNER_TEMP || (fs.existsSync('/build/tmp') ? '/build/tmp' : os.tmpdir());
  fixtureTmpdir = fs.mkdtempSync(path.join(scratchBase, 'provider-publisher-test-'));
  process.env.TMPDIR = fixtureTmpdir;
});
after(() => {
  if (originalToken === undefined) delete process.env.GH_TOKEN;
  else process.env.GH_TOKEN = originalToken;
  if (originalTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = originalTmpdir;
  if (fixtureTmpdir) fs.rmSync(fixtureTmpdir, { recursive: true, force: true });
});

const source = 'a'.repeat(40);
const reviewed = 'b'.repeat(40);
const tree = 'c'.repeat(40);
const hash = 'd'.repeat(64);
const names = ['test (22.x)', 'test (24.x)', 'governance', 'Standalone clean-env smoke (node:22)', 'compose'];

function manifest() {
  return {
    schema_version: '1.0.0',
    state: 'frozen',
    hseos: { repository: 'marciohideaki/enterprise-hseos', package: 'hseos', version: '4.0.0-ai-provider.6', tag: 'v4.0.0-ai-provider.6' },
    ecp: {
      version: '0.6.2',
      source_sha: 'e'.repeat(40),
      capabilities: 26,
      artifact_url:
        'https://github.com/HideakiSolutions/enterprise-capability-platform/releases/download/contracts-v0.6.2/ecp-contracts-0.6.2.tar.gz',
      sha256: hash,
      registry_sha256: hash,
      stacks_sha256: hash,
    },
    sdks: {
      node: {
        package: '@hideakisolutions/platform-node',
        version: '0.3.0-experimental.3',
        artifact_url:
          'https://gitea.hideakiservicos.net/api/packages/HideakiSolutions/npm/@hideakisolutions/platform-node/-/platform-node-0.3.0-experimental.3.tgz',
        source_sha: '1a127d4a8a29dde58e37c3a7ba6ddc6c70b781c2',
        sha256: hash,
      },
      dotnet: {
        package: 'Hideakisolutions.Platform.Ai.ProviderAccess',
        version: '0.1.0-rc.3',
        artifact_url:
          'https://gitea.hideakiservicos.net/api/packages/HideakiSolutions/nuget/package/hideakisolutions.platform.ai.provideraccess/0.1.0-rc.3/hideakisolutions.platform.ai.provideraccess.0.1.0-rc.3.nupkg',
        source_sha: '1a127d4a8a29dde58e37c3a7ba6ddc6c70b781c2',
        sha256: hash,
        dependencies: ['Guardrails', 'TokenMetering'].map((name) => ({
          package: `Hideakisolutions.Platform.Ai.${name}`,
          version: '0.3.0',
          artifact_url: `https://gitea.hideakiservicos.net/api/packages/HideakiSolutions/nuget/package/hideakisolutions.platform.ai.${name.toLowerCase()}/0.3.0/hideakisolutions.platform.ai.${name.toLowerCase()}.0.3.0.nupkg`,
          source_sha: '5ae206152797e1a109bd8ea23d5cf853aac48b6b',
          sha256: hash,
        })),
      },
    },
  };
}

function evidence() {
  const checks = names.map((name, i) => ({
    name,
    status: 'COMPLETED',
    conclusion: 'SUCCESS',
    detailsUrl: `https://github.com/marciohideaki/enterprise-hseos/actions/runs/${i + 1}/job/${i + 10}`,
  }));
  return {
    source,
    tree,
    reviewedTree: tree,
    pr: {
      number: 321,
      state: 'MERGED',
      baseRefName: 'master',
      isCrossRepository: false,
      headRefOid: reviewed,
      mergeCommit: { oid: source },
      statusCheckRollup: checks,
    },
    runs: Object.fromEntries(
      names.map((_, i) => [String(i + 1), { event: 'pull_request', head_sha: reviewed, status: 'completed', conclusion: 'success' }]),
    ),
    jobs: Object.fromEntries(
      names.map((name, i) => [String(i + 10), { run_id: i + 1, name, head_sha: reviewed, status: 'completed', conclusion: 'success' }]),
    ),
  };
}

function assets() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-distribution-test-'));
  const files = release.assetNames();
  fs.writeFileSync(path.join(directory, files[0]), 'sealed fixture package');
  fs.writeFileSync(path.join(directory, files[1]), '{"bomFormat":"CycloneDX"}');
  const doc = {
    ...manifest(),
    source: { status: 'PASS', repository: release.REPOSITORY, source_sha: source, reviewed_head: reviewed, tree },
    artifacts: Object.fromEntries(files.slice(0, 2).map((file) => [file, release.digest(fs.readFileSync(path.join(directory, file)))])),
  };
  fs.writeFileSync(path.join(directory, files[2]), `${JSON.stringify(doc)}\n`);
  const checksums = () =>
    fs.writeFileSync(
      path.join(directory, 'SHA256SUMS'),
      `${files.map((file) => `${release.digest(fs.readFileSync(path.join(directory, file)))}  ${file}`).join('\n')}\n`,
    );
  checksums();
  return {
    directory,
    files,
    doc,
    checksums,
    manifestHash: release.digest(fs.readFileSync(path.join(directory, files[2]))),
    cleanup: () => fs.rmSync(directory, { recursive: true, force: true }),
  };
}

test('unfrozen dependency metadata is rejected and older catalogs cannot replace upstream', () => {
  const draft = manifest();
  draft.state = 'awaiting-dependency-freeze';
  assert.throws(() => release.validateManifest(draft), /freeze is incomplete/);
  const stale = manifest();
  stale.ecp.capabilities = 24;
  assert.throws(() => release.validateManifest(stale), /retain the upstream/);
  assert.equal(release.validateManifest(manifest()).sdks.dotnet.version, '0.1.0-rc.3');
});

test('credentials, arbitrary origins and superseded SDK versions cannot enter release coordinates', () => {
  for (const url of [
    'http://github.com/HideakiSolutions/backend-core/releases/download/v5/a.tgz',
    'https://user:secret@github.com/HideakiSolutions/backend-core/releases/download/v5/a.tgz',
    'https://example.invalid/a.tgz',
    'https://github.com/Another/repository/releases/download/v5/a.tgz',
  ]) {
    const doc = manifest();
    doc.sdks.node.artifact_url = url;
    assert.throws(() => release.validateManifest(doc));
  }
  const old = manifest();
  old.sdks.node.version = '0.2.1-ai-provider.4';
  assert.throws(() => release.validateManifest(old));
});

test('required checks must be successful authoritative PR runs on the exact reviewed tree', () => {
  assert.equal(release.validateSourceEvidence(evidence()).status, 'PASS');
  for (const mutate of [
    (e) => {
      e.tree = 'f'.repeat(40);
    },
    (e) => {
      e.pr.state = 'OPEN';
    },
    (e) => {
      e.pr.isCrossRepository = true;
    },
    (e) => {
      e.pr.mergeCommit.oid = reviewed;
    },
    (e) => {
      e.pr.statusCheckRollup[0].conclusion = 'FAILURE';
    },
    (e) => {
      e.runs['1'].event = 'push';
    },
    (e) => {
      e.runs['1'].head_sha = source;
    },
    (e) => {
      e.runs['1'].conclusion = 'cancelled';
    },
    (e) => {
      e.jobs['10'].name = 'different gate';
    },
    (e) => {
      e.jobs['10'].head_sha = source;
    },
    (e) => {
      e.jobs['10'].run_id = 99;
    },
    (e) => {
      e.pr.statusCheckRollup.pop();
    },
  ]) {
    const data = evidence();
    mutate(data);
    assert.throws(() => release.validateSourceEvidence(data));
  }
});

test('a push success cannot substitute for a failed PR check', () => {
  const data = evidence();
  data.pr.statusCheckRollup[0].conclusion = 'FAILURE';
  data.pr.statusCheckRollup.push({
    ...data.pr.statusCheckRollup[0],
    conclusion: 'SUCCESS',
    detailsUrl: 'https://github.com/marciohideaki/enterprise-hseos/actions/runs/9/job/10',
  });
  data.runs['9'] = { event: 'push', head_sha: reviewed, status: 'completed', conclusion: 'success' };
  assert.throws(() => release.validateSourceEvidence(data));
});

test('a failed or pending authoritative PR workflow cannot hide behind the five other passing contexts', () => {
  for (const [status, conclusion] of [
    ['in_progress', ''],
    ['completed', 'failure'],
  ]) {
    const data = evidence();
    data.runs.extra = { event: 'pull_request', head_sha: reviewed, status, conclusion };
    assert.throws(() => release.validateSourceEvidence(data), /authoritative PR workflow/);
  }
});

test('the expected compatibility digest binds tarball and SBOM even if self-reported checksums are rewritten', () => {
  const fixture = assets();
  try {
    release.verifyAssetDirectory(fixture.directory, fixture.manifestHash);
    fs.appendFileSync(path.join(fixture.directory, fixture.files[0]), 'tampered');
    fixture.checksums();
    assert.throws(() => release.verifyAssetDirectory(fixture.directory, fixture.manifestHash), /bind the package and SBOM/);
  } finally {
    fixture.cleanup();
  }
});

test('checksum traversal, duplicates and different sealed manifest bytes are rejected', () => {
  const fixture = assets();
  try {
    assert.throws(() => release.verifyAssetDirectory(fixture.directory, '0'.repeat(64)), /expected sealed digest/);
    fs.writeFileSync(path.join(fixture.directory, 'SHA256SUMS'), `${hash}  ../outside\n${hash}  ../outside\n${hash}  ../outside\n`);
    assert.throws(() => release.verifyAssetDirectory(fixture.directory, fixture.manifestHash), /unexpected or duplicate/);
  } finally {
    fixture.cleanup();
  }
});

test('registry redirects strip authentication permanently when the host changes', async () => {
  const calls = [];
  const content = Buffer.from('published dependency fixture');
  const replies = [
    { status: 302, headers: new Map([['location', 'https://registry-storage.blob.core.windows.net/package?sig=fixture-only']]) },
    { status: 302, headers: new Map([['location', 'https://npm.pkg.github.com/return']]) },
    { status: 200, body: [content] },
  ];
  await release.downloadVerified(
    'https://npm.pkg.github.com/download/package',
    release.digest(content),
    { Authorization: 'fixture-only', 'X-NuGet-ApiKey': 'fixture-only' },
    async (url, options) => {
      calls.push({ url, headers: options.headers });
      assert.equal(options.redirect, 'manual');
      return replies.shift();
    },
  );
  assert.equal(calls[0].headers.Authorization, 'fixture-only');
  assert.deepEqual(calls[1].headers, {});
  assert.deepEqual(calls[2].headers, {});
});

test('registry downloads reject an HTTP redirect or a byte digest mismatch', async () => {
  let calls = 0;
  await assert.rejects(
    release.downloadVerified('https://npm.pkg.github.com/a', hash, { Authorization: 'fixture-only' }, async () => {
      calls += 1;
      return { status: 302, headers: new Map([['location', 'http://example.invalid/a']]) };
    }),
  );
  assert.equal(calls, 1, 'insecure redirect must not receive a request');
  await assert.rejects(
    release.downloadVerified('https://npm.pkg.github.com/a', hash, {}, async () => ({ status: 200, body: [Buffer.from('wrong bytes')] })),
    /digest differs/,
  );
});

function finalizerPorts(fixture, { enabled = true, corrupt = false, tagSource = source, published = false, immutable = false } = {}) {
  const events = [];
  const meta = {
    id: 12,
    tag_name: release.TAG,
    draft: !published,
    prerelease: true,
    immutable,
    html_url: `https://github.com/${release.REPOSITORY}/releases/tag/${release.TAG}`,
    assets: [...fixture.files, 'SHA256SUMS'].map((name) => ({
      name,
      state: 'uploaded',
      digest: `sha256:${release.digest(fs.readFileSync(path.join(fixture.directory, name)))}`,
    })),
  };
  return {
    events,
    api(endpoint) {
      events.push(`GET:${endpoint}`);
      if (endpoint === 'immutable-releases') return { enabled };
      if (endpoint.startsWith('git/ref/')) return { object: { type: 'commit', sha: tagSource } };
      return meta;
    },
    run(command, args) {
      assert.equal(command, 'gh');
      assert.deepEqual(args.slice(0, 2), ['release', 'download']);
      events.push('DOWNLOAD');
      const target = args[args.indexOf('--dir') + 1];
      for (const name of [...fixture.files, 'SHA256SUMS']) fs.copyFileSync(path.join(fixture.directory, name), path.join(target, name));
      if (corrupt) fs.appendFileSync(path.join(target, fixture.files[0]), 'changed');
      return '';
    },
    async verifyDependencies(doc) {
      assert.equal(doc.ecp.version, '0.6.2');
      events.push('DEPENDENCIES_VERIFIED');
    },
    gh(args) {
      if (args[0] === 'api' && args.includes('--slurp')) {
        events.push('LIST_RELEASES');
        return [[{ id: 99, tag_name: 'unrelated' }], [meta]];
      }
      assert.equal(args[2], 'PATCH');
      events.push('PUBLISH');
      return { ...meta, draft: false, immutable: true };
    },
  };
}

test('finalization cannot publish a corrupt download, changed tag or disabled immutable setting', async () => {
  for (const change of [{ corrupt: true }, { tagSource: reviewed }, { enabled: false }]) {
    const fixture = assets();
    const ports = finalizerPorts(fixture, change);
    try {
      await assert.rejects(release.finalize(source, fixture.manifestHash, true, ports));
      assert.ok(!ports.events.includes('PUBLISH'));
    } finally {
      fixture.cleanup();
    }
  }
});

test('validation-only never publishes; real finalization verifies dependencies and immutability immediately before PATCH', async () => {
  const fixture = assets();
  try {
    const dry = finalizerPorts(fixture);
    assert.equal((await release.finalize(source, fixture.manifestHash, false, dry)).publication, 'validation-only');
    assert.ok(!dry.events.includes('PUBLISH'));
    const ports = finalizerPorts(fixture);
    assert.equal((await release.finalize(source, fixture.manifestHash, true, ports)).publication, 'immutable');
    const index = ports.events.indexOf('PUBLISH');
    assert.equal(ports.events[index - 1], 'GET:immutable-releases');
    assert.ok(ports.events.indexOf('DEPENDENCIES_VERIFIED') < index);
  } finally {
    fixture.cleanup();
  }
});

test('an existing immutable release is verified without republishing, while a mutable published release is rejected', async () => {
  const fixture = assets();
  try {
    const existing = finalizerPorts(fixture, { published: true, immutable: true });
    assert.equal((await release.finalize(source, fixture.manifestHash, true, existing)).publication, 'already-immutable');
    assert.ok(!existing.events.includes('PUBLISH'));
    const mutable = finalizerPorts(fixture, { published: true, immutable: false });
    await assert.rejects(release.finalize(source, fixture.manifestHash, true, mutable), /mutable release/);
    assert.ok(!mutable.events.includes('PUBLISH'));
  } finally {
    fixture.cleanup();
  }
});

test('the dedicated workflow never finalizes, limits write access to the guarded draft job and preserves the legacy publisher', () => {
  const root = path.join(__dirname, '..');
  const workflow = yaml.parse(fs.readFileSync(path.join(root, '.github/workflows/provider-distribution.yaml'), 'utf8'));
  assert.equal(workflow.on.workflow_dispatch.inputs.publish.default, false);
  assert.equal(workflow.permissions.contents, 'read');
  assert.equal(workflow.jobs.bundle.permissions, undefined);
  const draft = workflow.jobs.draft;
  assert.equal(draft.permissions.contents, 'write');
  assert.match(draft.if, /github.ref == 'refs\/heads\/master'/);
  assert.match(draft.if, /inputs.publish/);
  assert.deepEqual(draft.needs, 'bundle');
  assert.equal(workflow.jobs.bundle.steps[0].with['persist-credentials'], false);
  const commands = draft.steps.map((s) => s.run || '').join('\n');
  assert.match(commands, /provider-distribution\.mjs stage/);
  assert.doesNotMatch(commands, /\bfinalize\b|--publish|--draft=false|immutable-releases/);
  assert.ok(
    draft.steps.findIndex((s) => s.uses === 'actions/checkout@v4') <
      draft.steps.findIndex((s) => s.uses === 'actions/download-artifact@v4'),
  );
  assert.match(fs.readFileSync(path.join(root, '.github/workflows/release.yaml'), 'utf8'), /npm test/);
});

test('candidate lookup includes authenticated draft pages and rejects absent or duplicate tags', () => {
  const draft = { id: 12, tag_name: release.TAG, draft: true };
  const query = (endpoint) => {
    assert.equal(endpoint, 'releases/12');
    return draft;
  };
  assert.equal(
    release.releaseForTag(query, () => [[{ id: 1, tag_name: 'other' }], [draft]]),
    draft,
  );
  for (const pages of [[], [[]], [[draft], [draft]]]) assert.throws(() => release.releaseForTag(query, () => pages));
});

test('published SDK source and exact Gitea coordinate cannot be replaced by a stale registry', () => {
  for (const mutate of [
    (doc) => {
      doc.sdks.node.source_sha = 'f'.repeat(40);
    },
    (doc) => {
      doc.sdks.dotnet.dependencies[0].source_sha = source;
    },
    (doc) => {
      doc.sdks.node.artifact_url = doc.sdks.node.artifact_url.replace('HideakiSolutions', 'AnotherOwner');
    },
    (doc) => {
      doc.sdks.node.artifact_url = 'https://npm.pkg.github.com/download/@hideakisolutions/platform-node/0.3.0-experimental.3/package.tgz';
    },
    (doc) => {
      doc.sdks.dotnet.dependencies[0].artifact_url = doc.sdks.dotnet.dependencies[0].artifact_url.replace(
        'guardrails.0.3.0.nupkg',
        'other.0.3.0.nupkg',
      );
    },
  ]) {
    const doc = manifest();
    mutate(doc);
    assert.throws(() => release.validateManifest(doc));
  }
});

test('registry credentials require the exact separate owner reader and never accept a foreign origin', () => {
  const user = process.env.GITEA_PACKAGE_READER_USER,
    token = process.env.GITEA_PACKAGE_READER_TOKEN;
  try {
    delete process.env.GITEA_PACKAGE_READER_USER;
    delete process.env.GITEA_PACKAGE_READER_TOKEN;
    assert.throws(() => release.dependencyHeaders(new URL('https://gitea.hideakiservicos.net/a')));
    process.env.GITEA_PACKAGE_READER_USER = 'pkg-read-hideakisolutions';
    process.env.GITEA_PACKAGE_READER_TOKEN = 'fixture-reader-token';
    assert.deepEqual(release.dependencyHeaders(new URL('https://gitea.hideakiservicos.net/a')), {
      Authorization: `Basic ${Buffer.from('pkg-read-hideakisolutions:fixture-reader-token').toString('base64')}`,
    });
    assert.throws(() => release.dependencyHeaders(new URL('https://another.invalid/a')));
    process.env.GITEA_PACKAGE_READER_USER = 'gitea-sysadmin';
    assert.throws(() => release.dependencyHeaders(new URL('https://gitea.hideakiservicos.net/a')));
  } finally {
    if (user === undefined) delete process.env.GITEA_PACKAGE_READER_USER;
    else process.env.GITEA_PACKAGE_READER_USER = user;
    if (token === undefined) delete process.env.GITEA_PACKAGE_READER_TOKEN;
    else process.env.GITEA_PACKAGE_READER_TOKEN = token;
  }
});

test('fixture scratch setup does not weaken the finalizer missing TMPDIR guard', async () => {
  const fixture = assets();
  const saved = process.env.TMPDIR;
  const ports = finalizerPorts(fixture);
  try {
    delete process.env.TMPDIR;
    await assert.rejects(release.finalize(source, fixture.manifestHash, false, ports), /explicit disk-backed TMPDIR/);
    assert.deepEqual(ports.events, [], 'guard must fail before network or publication');
  } finally {
    process.env.TMPDIR = saved;
    fixture.cleanup();
  }
});

test('the clean probe uses the real guarded minimal installer contract with zero hooks', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-minimal-contract-'));
  try {
    const cli = path.join(__dirname, '../tools/hseos-npx-wrapper.js');
    const receipt = JSON.parse(execFileSync(process.execPath, [cli, ...release.minimalInstallArguments(project)], { encoding: 'utf8' }));
    assert.equal(receipt.profile, 'minimal');
    for (const key of ['skills', 'hooks', 'mcp_servers']) assert.equal(receipt[key], 0);
    assert.equal(fs.existsSync(path.join(project, '.git/hooks')), false);
    const smoke = fs.readFileSync(path.join(__dirname, '../.github/scripts/provider-distribution-smoke.mjs'), 'utf8');
    assert.match(smoke, /minimalInstallArguments\(project\)/);
    assert.doesNotMatch(smoke, /--no-git-hooks|--tools/);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('sealed assets are escrowed after consumer failure but never before successful sealing', () => {
  const workflow = yaml.parse(fs.readFileSync(path.join(__dirname, '../.github/workflows/provider-distribution.yaml'), 'utf8'));
  const uploads = workflow.jobs.bundle.steps.filter((step) => step.uses === 'actions/upload-artifact@v4');
  assert.deepEqual(
    uploads.map((step) => step.with.name),
    ['hseos-provider-sealed', 'hseos-provider-validation'],
  );
  for (const upload of uploads) {
    assert.equal(upload.if, "always() && steps.seal.outcome == 'success'");
    assert.equal(upload.with['if-no-files-found'], 'error');
  }
});

test('draft staging uses the workflow controller while preserving the sealed release source', () => {
  const workflow = yaml.parse(fs.readFileSync(path.join(__dirname, '../.github/workflows/provider-distribution.yaml'), 'utf8'));
  const draft = workflow.jobs.draft;
  const checkout = draft.steps.find((step) => step.uses === 'actions/checkout@v4');
  assert.equal(checkout.with.ref, '${{ github.sha }}');
  const stage = draft.steps.find((step) => step.name === 'Verify the sealed assets before a create-only tag and draft');
  assert.equal(stage.env.SOURCE_SHA, '${{ needs.bundle.outputs.source_sha }}');
  assert.equal(stage.env.MANIFEST_SHA256, '${{ needs.bundle.outputs.manifest_sha256 }}');
  const probe = draft.steps.find((step) => step.name === 'Verify and install the downloaded draft, preserving the original bytes');
  assert.match(probe.run, /GITHUB_WORKSPACE\/\.github\/scripts:\/probe:ro/);
});
