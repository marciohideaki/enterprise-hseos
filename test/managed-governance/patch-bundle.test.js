'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { MemoryGovernanceRepository } = require('../../tools/managed-governance-control-plane/lib/infrastructure/memory/governance-repository');
const { generatePatchBundle } = require('../../tools/managed-governance-control-plane/lib/application/generate-patch-bundle');
const { buildUnifiedPatch, computeFileDiff, digestPatchText, writePatchBundle } = require('../../tools/managed-governance-control-plane/lib/infrastructure/git/patch-bundle-writer');

function tempDestination(label) {
  return path.join(os.tmpdir(), `hseos-patch-bundle-test-${label}-${crypto.randomBytes(6).toString('hex')}`);
}

async function baseRequest(overrides = {}) {
  const repository = new MemoryGovernanceRepository({ clock: () => new Date('2026-09-05T00:00:00.000Z') });
  const organizationId = `patch-bundle-${crypto.randomBytes(6).toString('hex')}`;
  const actor = { type: 'automation', id: 'patch-bundle-test' };
  await repository.ensureOrganization({
    organization_id: organizationId,
    idempotency_key: 'org-create',
    actor,
    organization: { slug: organizationId, display_name: 'Patch Bundle Test' },
  });
  const request = {
    organizationId,
    actor,
    publicationRequestRef: 'publication-request-1',
    sourceRepositoryId: crypto.randomUUID(),
    baseCommit: 'a'.repeat(40),
    generatedBy: 'patch-bundle-test',
    generatedAt: '2026-09-05T00:00:00Z',
    changes: [
      { path: 'docs/new-file.md', operation: 'create', after: '# New\nContent\n' },
      { path: 'docs/existing.md', operation: 'update', before: '# Existing\nOld line\n', after: '# Existing\nNew line\n' },
      { path: 'docs/removed.md', operation: 'delete', before: '# Removed\n' },
    ],
    ...overrides,
  };
  return { repository, request };
}

test('generatePatchBundle produces a byte-identical bundle_id, manifest_digest and patch for the same request', async () => {
  const { repository, request } = await baseRequest();
  const destinationA = tempDestination('a');
  const destinationB = tempDestination('b');
  try {
    const first = await generatePatchBundle({ ...request, destination: destinationA }, { repository });
    const second = await generatePatchBundle({ ...request, destination: destinationB }, { repository });
    assert.equal(first.bundle.patch_publication_bundle_id, second.bundle.patch_publication_bundle_id);
    assert.equal(first.bundle.manifest_digest, second.bundle.manifest_digest);
    assert.equal(first.patch, second.patch);
    assert.match(first.bundle.patch_publication_bundle_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  } finally {
    fs.rmSync(destinationA, { recursive: true, force: true });
    fs.rmSync(destinationB, { recursive: true, force: true });
  }
});

test('generatePatchBundle produces a different bundle_id for a substantively different request', async () => {
  const { repository, request } = await baseRequest();
  const destinationA = tempDestination('a');
  const destinationB = tempDestination('b');
  try {
    const first = await generatePatchBundle({ ...request, destination: destinationA }, { repository });
    const second = await generatePatchBundle(
      { ...request, changes: [{ path: 'docs/different.md', operation: 'create', after: '# Different\n' }], destination: destinationB },
      { repository },
    );
    assert.notEqual(first.bundle.patch_publication_bundle_id, second.bundle.patch_publication_bundle_id);
    assert.notEqual(first.bundle.manifest_digest, second.bundle.manifest_digest);
  } finally {
    fs.rmSync(destinationA, { recursive: true, force: true });
    fs.rmSync(destinationB, { recursive: true, force: true });
  }
});

test('every file operation is accounted for with the correct content digest, including deletions', async () => {
  const { repository, request } = await baseRequest();
  const destination = tempDestination('accounting');
  try {
    const result = await generatePatchBundle({ ...request, destination }, { repository });
    const byPath = new Map(result.bundle.file_operations.map((entry) => [entry.path, entry]));
    assert.equal(byPath.size, request.changes.length);
    assert.equal(byPath.get('docs/new-file.md').operation, 'create');
    assert.match(byPath.get('docs/new-file.md').content_digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(byPath.get('docs/existing.md').operation, 'update');
    assert.match(byPath.get('docs/existing.md').content_digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(byPath.get('docs/removed.md').operation, 'delete');
    assert.equal(byPath.get('docs/removed.md').content_digest, null);
  } finally {
    fs.rmSync(destination, { recursive: true, force: true });
  }
});

test('the generated patch is a real unified diff that git apply accepts', async () => {
  const { repository, request } = await baseRequest();
  const destination = tempDestination('apply');
  const workingCopy = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-patch-bundle-working-'));
  try {
    const result = await generatePatchBundle({ ...request, destination }, { repository });
    fs.mkdirSync(path.join(workingCopy, 'docs'));
    fs.writeFileSync(path.join(workingCopy, 'docs', 'existing.md'), '# Existing\nOld line\n');
    fs.writeFileSync(path.join(workingCopy, 'docs', 'removed.md'), '# Removed\n');
    execFileSync('git', ['apply', '--check', result.written.patch_path], { cwd: workingCopy, stdio: ['ignore', 'pipe', 'pipe'] });
    execFileSync('git', ['apply', result.written.patch_path], { cwd: workingCopy, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(fs.readFileSync(path.join(workingCopy, 'docs', 'new-file.md'), 'utf8'), '# New\nContent\n');
    assert.equal(fs.readFileSync(path.join(workingCopy, 'docs', 'existing.md'), 'utf8'), '# Existing\nNew line\n');
    assert.equal(fs.existsSync(path.join(workingCopy, 'docs', 'removed.md')), false);
  } finally {
    fs.rmSync(destination, { recursive: true, force: true });
    fs.rmSync(workingCopy, { recursive: true, force: true });
  }
});

test('generatePatchBundle never touches git state — no commit, push, merge or tag', async () => {
  const { repository, request } = await baseRequest();
  const destination = tempDestination('no-git-effects');
  try {
    await generatePatchBundle({ ...request, destination }, { repository });
    assert.equal(fs.existsSync(path.join(destination, '.git')), false);
    const files = fs.readdirSync(destination).sort();
    assert.deepEqual(files, ['APPLY.md', 'ROLLBACK.md', 'manifest.json', 'patch.diff']);
  } finally {
    fs.rmSync(destination, { recursive: true, force: true });
  }
});

test('a re-run to the same destination is refused before any write, and the bundle is durable via the repository', async () => {
  const { repository, request } = await baseRequest();
  const destination = tempDestination('reuse');
  try {
    const first = await generatePatchBundle({ ...request, destination }, { repository });
    await assert.rejects(
      generatePatchBundle({ ...request, destination }, { repository }),
      (error) => error.code === 'MANAGED_GOVERNANCE_PATCH_BUNDLE_EXISTS',
    );
    const fetched = await repository.getPatchPublicationBundle(request.organizationId, first.bundle.patch_publication_bundle_id);
    assert.deepEqual(fetched, first.bundle);
  } finally {
    fs.rmSync(destination, { recursive: true, force: true });
  }
});

test('unsafe destinations fail before any write: symlinked parent, missing parent, existing path', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-patch-bundle-unsafe-'));
  const manifest = { application_instructions: 'apply', rollback_instructions: 'revert' };
  try {
    const realParent = path.join(base, 'real');
    fs.mkdirSync(realParent);
    const linkedParent = path.join(base, 'linked');
    fs.symlinkSync(realParent, linkedParent);
    assert.throws(
      () => writePatchBundle({ destination: path.join(linkedParent, 'bundle'), manifest, patchText: '' }),
      (error) => error.code === 'MANAGED_GOVERNANCE_PATCH_BUNDLE_UNSAFE',
    );
    assert.equal(fs.readdirSync(realParent).length, 0, 'a rejected write must leave no trace');

    assert.throws(
      () => writePatchBundle({ destination: path.join(base, 'does-not-exist', 'bundle'), manifest, patchText: '' }),
      (error) => error.code === 'MANAGED_GOVERNANCE_PATCH_BUNDLE_UNSAFE',
    );

    const existing = path.join(base, 'already-here');
    fs.mkdirSync(existing);
    assert.throws(
      () => writePatchBundle({ destination: existing, manifest, patchText: '' }),
      (error) => error.code === 'MANAGED_GOVERNANCE_PATCH_BUNDLE_EXISTS',
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('generatePatchBundle rejects path traversal, absolute paths and duplicate paths', async () => {
  const { repository, request } = await baseRequest();
  // assertRelativePath (generate-patch-bundle.js) rejects traversal/absolute/space paths before
  // a manifest is ever built; a NUL byte instead survives that check (it targets whitespace, not
  // control characters) and is caught one layer down by RelativePathSchema's own NUL guard.
  for (const badPath of ['../outside.md', '/absolute.md', 'docs/../../escape.md', 'docs//double-slash.md', 'docs/has space.md']) {
    await assert.rejects(
      generatePatchBundle(
        { ...request, changes: [{ path: badPath, operation: 'create', after: 'x' }], destination: tempDestination('bad-path') },
        { repository },
      ),
      (error) => error.code === 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID',
      badPath,
    );
  }
  await assert.rejects(
    generatePatchBundle(
      { ...request, changes: [{ path: `docs/has\0nul.md`, operation: 'create', after: 'x' }], destination: tempDestination('bad-path-nul') },
      { repository },
    ),
    (error) => error.code === 'MANAGED_GOVERNANCE_CONTRACT_INVALID',
  );
  await assert.rejects(
    generatePatchBundle(
      {
        ...request,
        changes: [
          { path: 'docs/dup.md', operation: 'create', after: 'a' },
          { path: 'docs/dup.md', operation: 'delete', before: 'b' },
        ],
        destination: tempDestination('dup-path'),
      },
      { repository },
    ),
    (error) => error.code === 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID',
  );
});

test('generatePatchBundle rejects operations whose before/after content contradicts the operation', async () => {
  const { repository, request } = await baseRequest();
  const cases = [
    { path: 'docs/x.md', operation: 'create', before: 'unexpected', after: 'x' },
    { path: 'docs/x.md', operation: 'delete', before: 'x', after: 'unexpected' },
    { path: 'docs/x.md', operation: 'update', before: 'same', after: 'same' },
  ];
  for (const change of cases) {
    await assert.rejects(
      generatePatchBundle({ ...request, changes: [change], destination: tempDestination('bad-op') }, { repository }),
      (error) => error.code === 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID',
    );
  }
});

test('computeFileDiff and buildUnifiedPatch are pure helpers usable outside the full bundle flow', () => {
  assert.equal(computeFileDiff('a.md', 'same\n', 'same\n'), '');
  const diff = computeFileDiff('a.md', null, 'new\n');
  assert.match(diff, /^diff --git a\/a\.md b\/a\.md/);
  const combined = buildUnifiedPatch([
    { path: 'a.md', before: null, after: 'new\n' },
    { path: 'b.md', before: 'same\n', after: 'same\n' },
  ]);
  assert.equal((combined.match(/^diff --git/gm) || []).length, 1, 'unchanged files must not appear in the combined patch');
  assert.match(digestPatchText(combined), /^sha256:[a-f0-9]{64}$/);
});
