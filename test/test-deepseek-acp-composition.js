'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const yaml = require('yaml');

const { RuntimeProviderError, validateDeepSeekAcpComposition } = require('../packages/runtime-providers');

const ROOT = path.join(__dirname, '..');
const TEMPLATE = path.join(ROOT, '.agents', 'activation', 'provider-bindings', 'deepseek-acp-tool-free.example.yaml');

function mutated(update) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-deepseek-composition-'));
  const filename = path.join(directory, 'cordis.yml');
  const document = yaml.parse(fs.readFileSync(TEMPLATE, 'utf8'));
  update(document);
  fs.writeFileSync(filename, yaml.stringify(document), { encoding: 'utf8', mode: 0o600 });
  return { filename, cleanup: () => fs.rmSync(directory, { recursive: true }) };
}

test('composition validator rejects any extra plugin, including a model-facing tool', () => {
  const fixture = mutated((document) => document.push({ id: 'tool', name: '@deepseek-ai/dsh-tool-fs' }));
  try {
    assert.throws(
      () => validateDeepSeekAcpComposition(fixture.filename),
      (error) => error instanceof RuntimeProviderError && error.error_code === 'capability_unavailable',
    );
  } finally {
    fixture.cleanup();
  }
});

for (const field of ['workspaceContext', 'toolBash', 'toolJobs', 'goals']) {
  test(`composition validator rejects enabled ${field}`, () => {
    const fixture = mutated((document) => {
      document[1].config[field] = {};
    });
    try {
      assert.throws(
        () => validateDeepSeekAcpComposition(fixture.filename),
        (error) => error instanceof RuntimeProviderError && error.error_code === 'capability_unavailable',
      );
    } finally {
      fixture.cleanup();
    }
  });
}

test('composition validator rejects symlink aliases', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-deepseek-link-'));
  const alias = path.join(directory, 'cordis.yml');
  fs.symlinkSync(TEMPLATE, alias);
  try {
    assert.throws(() => validateDeepSeekAcpComposition(alias), /canonical regular file/);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('composition validator rejects hardlink aliases', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-deepseek-hardlink-'));
  const source = path.join(directory, 'source.yml');
  const alias = path.join(directory, 'cordis.yml');
  fs.copyFileSync(TEMPLATE, source);
  fs.linkSync(source, alias);
  try {
    assert.throws(() => validateDeepSeekAcpComposition(alias), /canonical regular file/);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});
