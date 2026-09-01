'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
// eslint-disable-next-line n/no-unsupported-features/node-builtins -- describe is available throughout the supported Node 20 line
const { after, before, describe, test } = require('node:test');
const { digestCanonical } = require('../../packages/managed-governance-contracts');
const {
  buildImportItems,
  buildImportPlan,
  serializeImportPlan,
} = require('../../tools/managed-governance-control-plane/lib/domain/import-plan');
const { classifySource } = require('../../tools/managed-governance-control-plane/lib/infrastructure/git/classifiers');
const {
  GitGovernanceSource,
  assertGitSourcesClean,
  assertRealDirectory,
  secureReadRegularFile,
} = require('../../tools/managed-governance-control-plane/lib/infrastructure/git/governance-source');
const { createCommittedGovernanceFixture, git } = require('./git-fixture');

const REPOSITORY_ROOT = path.resolve(__dirname, '../..');
const ORGANIZATION_ID = 'hideaki-solutions';
const IMPORTER_VERSION = '1.0.0';

function digest(content) {
  return `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
}

function discoveredEntry(sourcePath, content, sourceKind = 'policy') {
  const normalizedContent = content.replaceAll(/\r\n?/g, '\n');
  const base = {
    source_path: sourcePath,
    source_kind: sourceKind,
    raw_content: content,
    normalized_content: normalizedContent,
    content_digest: digest(normalizedContent),
  };
  return { ...base, classification: classifySource(base) };
}

function existingEntry(entry, overrides = {}) {
  return {
    source_path: entry.source_path,
    artifact_id: entry.classification.artifact_id,
    artifact_type: entry.classification.artifact_type,
    classification_status: entry.classification.classification_status,
    content_digest: entry.content_digest,
    ...overrides,
  };
}

describe('managed governance source discovery', () => {
  let discovery;
  let repository;
  let statusBefore;

  before(async () => {
    repository = createCommittedGovernanceFixture(REPOSITORY_ROOT);
    statusBefore = git(repository, ['status', '--porcelain=v1', '--untracked-files=all']);
    discovery = await new GitGovernanceSource({ repositoryRoot: repository }).discover();
  });

  after(() => fs.rmSync(repository, { recursive: true, force: true }));

  test('accounts for every allowlisted governance family in the current repository', () => {
    const types = new Set(discovery.entries.map((entry) => entry.classification.artifact_type));
    for (const required of ['constitution', 'adr', 'policy', 'standard', 'capability', 'hook', 'workflow', 'skill']) {
      assert.ok(types.has(required), `missing ${required}`);
    }
    const constitution = discovery.entries.find(
      (entry) => entry.source_path === '.enterprise/.specs/constitution/Enterprise-Constitution.md',
    );
    assert.equal(constitution?.classification.artifact_type, 'constitution');
    assert.ok(discovery.entries.every((entry) => !entry.source_path.startsWith('.agents/')));
    assert.ok(discovery.entries.every((entry) => !entry.source_path.includes('/.worktrees/')));
  });

  test('produces a byte-identical plan for the same tree and commit without writes', async () => {
    const secondDiscovery = await new GitGovernanceSource({ repositoryRoot: repository }).discover();
    const input = { organizationId: ORGANIZATION_ID, importerVersion: IMPORTER_VERSION };
    const firstPlan = buildImportPlan({ ...input, discovery });
    const secondPlan = buildImportPlan({ ...input, discovery: secondDiscovery });
    assert.equal(serializeImportPlan(firstPlan), serializeImportPlan(secondPlan));
    assert.equal(firstPlan.items.length, discovery.entries.length);
    assert.equal(git(repository, ['status', '--porcelain=v1', '--untracked-files=all']), statusBefore);
  });
});

describe('secure governance source reads', () => {
  let fixtureRoot;

  before(() => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-governance-source-'));
  });

  after(() => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  test('reads a regular UTF-8 file and normalizes line endings for its digest', async () => {
    const filename = path.join(fixtureRoot, 'regular.md');
    fs.writeFileSync(filename, '# Rule\r\nBody\r\n');
    const source = await secureReadRegularFile(fixtureRoot, filename, 'regular.md', 1024);
    assert.equal(source.rawContent, '# Rule\r\nBody\r\n');
    assert.equal(source.normalizedContent, '# Rule\nBody\n');
    assert.equal(source.contentDigest, digest('# Rule\nBody\n'));
  });

  test('rejects path escape before content is read', async () => {
    const outside = path.join(path.dirname(fixtureRoot), `${path.basename(fixtureRoot)}-outside.md`);
    fs.writeFileSync(outside, 'outside');
    try {
      await assert.rejects(
        secureReadRegularFile(fixtureRoot, outside, '../outside.md', 1024),
        (error) => error.code === 'MANAGED_GOVERNANCE_SOURCE_ESCAPE',
      );
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  test('rejects source directories reached through symbolic-link ancestors', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-governance-root-'));
    const symbolicParent = path.join(fixtureRoot, 'linked-root');
    fs.mkdirSync(path.join(outside, 'governance'));
    fs.symlinkSync(outside, symbolicParent);
    try {
      await assert.rejects(
        assertRealDirectory(fixtureRoot, path.join(symbolicParent, 'governance'), 'linked-root/governance'),
        (error) => error.code === 'MANAGED_GOVERNANCE_SOURCE_ESCAPE' || error.code === 'MANAGED_GOVERNANCE_SOURCE_LINK',
      );
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test('rejects symbolic links, hard links, special files, oversized data and invalid UTF-8', async () => {
    const target = path.join(fixtureRoot, 'target.md');
    const symbolic = path.join(fixtureRoot, 'symbolic.md');
    const hard = path.join(fixtureRoot, 'hard.md');
    const fifo = path.join(fixtureRoot, 'special.pipe');
    const oversized = path.join(fixtureRoot, 'oversized.md');
    const invalid = path.join(fixtureRoot, 'invalid.md');
    fs.writeFileSync(target, 'target');
    fs.symlinkSync(target, symbolic);
    fs.linkSync(target, hard);
    execFileSync('mkfifo', [fifo]);
    fs.writeFileSync(oversized, '12345');
    fs.writeFileSync(invalid, Buffer.from([0xc3, 0x28]));

    await assert.rejects(
      secureReadRegularFile(fixtureRoot, symbolic, 'symbolic.md', 1024),
      (error) => error.code === 'MANAGED_GOVERNANCE_SOURCE_LINK',
    );
    await assert.rejects(
      secureReadRegularFile(fixtureRoot, hard, 'hard.md', 1024),
      (error) => error.code === 'MANAGED_GOVERNANCE_SOURCE_LINK',
    );
    await assert.rejects(
      secureReadRegularFile(fixtureRoot, fifo, 'special.pipe', 1024),
      (error) => error.code === 'MANAGED_GOVERNANCE_SOURCE_SPECIAL_FILE',
    );
    await assert.rejects(
      secureReadRegularFile(fixtureRoot, oversized, 'oversized.md', 4),
      (error) => error.code === 'MANAGED_GOVERNANCE_SOURCE_TOO_LARGE',
    );
    await assert.rejects(
      secureReadRegularFile(fixtureRoot, invalid, 'invalid.md', 1024),
      (error) => error.code === 'MANAGED_GOVERNANCE_SOURCE_ENCODING',
    );
  });

  test('rejects dirty canonical Git roots', () => {
    const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-governance-git-'));
    try {
      git(repository, ['init', '--quiet']);
      git(repository, ['config', 'user.email', 'test@example.invalid']);
      git(repository, ['config', 'user.name', 'Test']);
      fs.mkdirSync(path.join(repository, 'governance'));
      fs.writeFileSync(path.join(repository, 'governance', 'policy.md'), '# Policy\n');
      git(repository, ['add', 'governance/policy.md']);
      git(repository, ['commit', '--quiet', '-m', 'test: add policy']);
      assert.doesNotThrow(() => assertGitSourcesClean(repository, ['governance']));
      fs.appendFileSync(path.join(repository, 'governance', 'policy.md'), 'changed\n');
      assert.throws(
        () => assertGitSourcesClean(repository, ['governance']),
        (error) => error.code === 'MANAGED_GOVERNANCE_GIT_DIRTY',
      );
    } finally {
      fs.rmSync(repository, { recursive: true, force: true });
    }
  });
});

describe('classification and pure import planning', () => {
  test('rejects discovery limits above the closed source profile', () => {
    assert.throws(
      () => new GitGovernanceSource({ repositoryRoot: REPOSITORY_ROOT, maximumFileBytes: 2 * 1024 * 1024 + 1 }),
      (error) => error.code === 'MANAGED_GOVERNANCE_SOURCE_LIMIT_INVALID',
    );
  });

  test('preserves ambiguous prose as unclassified metadata and never emits a rule', () => {
    const entry = discoveredEntry('unknown/ambiguous.md', '# Maybe\nDo something sometimes.\n', 'unknown');
    assert.equal(entry.classification.artifact_type, 'unclassified');
    assert.equal(entry.classification.classification_status, 'unclassified');
    assert.equal(entry.classification.structured_content.format, 'markdown');
    assert.equal(Object.hasOwn(entry.classification.structured_content, 'rule'), false);
  });

  test('preserves invalid structured content for review', () => {
    const entry = discoveredEntry('policies/duplicate.yaml', 'effect: allow\neffect: deny\n', 'policy');
    assert.equal(entry.classification.classification_status, 'partial');
    assert.equal(entry.classification.structured_content.parse_status, 'invalid');
    assert.equal(buildImportItems([entry])[0].action, 'review');
  });

  test('plans create, no-op, version, rename, review and deactivate deterministically', () => {
    const create = discoveredEntry('policies/create.md', '# Create\n');
    const unchanged = discoveredEntry('policies/unchanged.md', '# Unchanged\n');
    const changed = discoveredEntry('policies/changed.md', '# Changed now\n');
    const renamed = discoveredEntry('policies/renamed.md', '# Renamed\n');
    const review = discoveredEntry('unknown/review.md', '# Review\n', 'unknown');
    const existing = [
      existingEntry(unchanged),
      existingEntry(changed, { content_digest: digest('# Changed before\n') }),
      existingEntry(renamed, { source_path: 'policies/old-name.md' }),
      existingEntry(discoveredEntry('policies/removed.md', '# Removed\n')),
    ];
    const items = buildImportItems([review, renamed, changed, unchanged, create], existing);
    assert.deepEqual(Object.fromEntries(items.map((item) => [item.source_path, item.action])), {
      'policies/changed.md': 'version',
      'policies/create.md': 'create',
      'policies/removed.md': 'deactivate',
      'policies/renamed.md': 'rename',
      'policies/unchanged.md': 'noop',
      'unknown/review.md': 'review',
    });
    assert.equal(items.find((item) => item.action === 'rename').previous_source_path, 'policies/old-name.md');
  });

  test('does not consume an existing path that is present later in discovery as a rename', () => {
    const first = discoveredEntry('policies/a.md', '# Shared\n');
    const second = discoveredEntry('policies/z.md', '# Shared\n');
    const items = buildImportItems([first, second], [existingEntry(second)]);
    assert.equal(items.find((item) => item.source_path === 'policies/a.md').action, 'create');
    assert.equal(items.find((item) => item.source_path === 'policies/z.md').action, 'noop');
  });

  test('makes ambiguous renames review-only and preserves prior entries for deactivation review', () => {
    const current = discoveredEntry('policies/current.md', '# Shared\n');
    const priorA = existingEntry(current, { source_path: 'policies/a.md', artifact_id: 'policy:a' });
    const priorB = existingEntry(current, { source_path: 'policies/b.md', artifact_id: 'policy:b' });
    const items = buildImportItems([current], [priorB, priorA]);
    assert.equal(items.find((item) => item.source_path === 'policies/current.md').action, 'review');
    assert.deepEqual(
      items.filter((item) => item.action === 'deactivate').map((item) => item.source_path),
      ['policies/a.md', 'policies/b.md'],
    );
  });

  test('binds plan identity to repository, commit, importer and source profile', () => {
    const entry = discoveredEntry('policies/create.md', '# Create\n');
    const discovery = {
      repository_id: '7f9f9b79-638c-4138-9a29-8a2406ad9fb8',
      source_commit: 'a'.repeat(40),
      source_timestamp: '2026-09-01T00:00:00Z',
      source_profile: 'enterprise-hseos:v1',
      source_profile_digest: digestCanonical({ profile: 'enterprise-hseos:v1' }),
      entries: [entry],
    };
    const plan = buildImportPlan({
      discovery,
      organizationId: ORGANIZATION_ID,
      importerVersion: IMPORTER_VERSION,
    });
    assert.equal(plan.items[0].action, 'create');
    assert.equal(Object.isFrozen(plan), true);
    assert.equal(serializeImportPlan(plan), serializeImportPlan(plan));
    assert.notEqual(
      plan.batch_key,
      buildImportPlan({
        discovery,
        organizationId: ORGANIZATION_ID,
        importerVersion: '1.0.1',
      }).batch_key,
    );
  });
});
