'use strict';

/* eslint-disable n/no-unsupported-features/node-builtins -- fetch is available throughout the supported Node 20 line */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createManagedGovernanceServer } = require('../../tools/managed-governance-control-plane/server');

const PUBLIC = path.join(__dirname, '..', '..', 'tools', 'managed-governance-control-plane', 'public');

async function withServer(run) {
  const server = createManagedGovernanceServer({ services: { health: async () => ({ live: true, ready: false }) } });
  const address = await server.listen();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await server.close();
  }
}

test('console routes serve exact local assets with strict browser policy', async () => {
  await withServer(async (baseUrl) => {
    for (const route of ['/', '/app.js', '/styles.css', '/ui-schemas.json']) {
      const response = await fetch(`${baseUrl}${route}`);
      assert.equal(response.status, 200, route);
      assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
      assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.ok((await response.text()).length > 0);
    }
    const favicon = await fetch(`${baseUrl}/favicon.ico`);
    assert.equal(favicon.status, 204);
  });
});

test('versioned UI schema covers every supported authoring type with bounded fields', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'ui-schemas.json'), 'utf8'));
  assert.equal(schema.schema_version, 1);
  assert.deepEqual(Object.keys(schema.authoring_types).sort(), ['contract', 'rule', 'stack', 'standard']);
  for (const definition of Object.values(schema.authoring_types)) {
    assert.ok(definition.fields.length > 0);
    for (const field of definition.fields) {
      assert.ok(field.name && field.label && field.type);
      if (['text', 'textarea'].includes(field.type)) assert.ok(field.max_length > 0);
    }
  }
});

test('DOM smoke has landmarks, labels, keyboard focus, errors and reduced-motion support', () => {
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(PUBLIC, 'styles.css'), 'utf8');
  assert.match(html, /<header class="masthead">/);
  assert.match(html, /<nav aria-label=/);
  assert.match(html, /<main id="workspace">/);
  assert.match(html, /role="alert" tabindex="-1"/);
  assert.match(html, /for="access-token"/);
  assert.match(html, /class="skip-link"/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test('console consumes only HTTP routes and contains no database or direct Git mutation path', () => {
  const script = fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
  assert.match(script, /\/api\/v1\/policy\/evaluate/);
  assert.match(script, /\/api\/v1\/drafts/);
  assert.doesNotMatch(script, /postgres|database[_-]url|child_process|git push|\.git\//i);
  assert.doesNotMatch(fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'), /managed-enforced/);
});

test('console shows the same readiness report exposed to CLI and MCP, and never claims it authorizes enforcement', () => {
  const script = fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  assert.match(script, /\/api\/v1\/readiness/);
  assert.match(html, /id="readiness-window"/);
  assert.match(html, /id="readiness-status"/);
  assert.match(html, /non-authorizing/i);
});

test('console echoes the CSRF token back only on state-changing requests, never on reads', () => {
  const script = fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
  assert.match(script, /x-hseos-csrf-token/i);
  assert.match(script, /STATE_CHANGING_METHODS/);
  assert.doesNotMatch(script, /localStorage|document\.cookie/i);
});
