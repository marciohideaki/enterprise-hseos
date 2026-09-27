'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { parseProviderControlManifest, inspectProviderControlManifest, ROUTES } = require('../tools/lib/provider-control-manifest');

const { manifest } = require('./helpers/provider-control');

test('official routes distinguish native accounts, API and local bindings without claiming certification', () => {
  for (const [vendor, routes] of Object.entries(ROUTES))
    for (const [route, description] of Object.entries(routes))
      for (const kind of description.kinds) {
        const value = manifest(vendor, route, kind);
        assert.ok(Object.isFrozen(parseProviderControlManifest(value).authentication));
        const report = inspectProviderControlManifest(value, value.binding_sha256);
        assert.equal(report.effective_authentication, 'not_observed');
        assert.equal(report.real_conformance, 'not_certified');
        assert.equal(report.operational, 'not_activated');
      }
});

test('route confusion, unknown quota, capability claims, secrets and unbounded reservations fail closed', () => {
  const changes = [
    (v) => {
      v.secret = randomUUID();
    },
    (v) => {
      v.authentication.credential.source_ref = 'literal-credential';
    },
    (v) => {
      v.authentication.mode = 'native_account';
    },
    (v) => {
      v.authentication.credential = null;
    },
    (v) => {
      v.billing.kind = 'subscription';
    },
    (v) => {
      v.billing.max_request_microusd = 0;
    },
    (v) => {
      v.limits.max_requests = Infinity;
    },
    (v) => {
      v.controls.quota = 'not_applicable';
    },
    (v) => {
      v.controls.authority = 'delegated_l0';
    },
    (v) => {
      v.controls.cancel = 'verified';
    },
    (v) => {
      v.vendor = 'claude';
      v.route = 'local';
    },
  ];
  for (const change of changes) {
    const value = manifest();
    change(value);
    assert.throws(() => parseProviderControlManifest(value), { code: 'CONTROL_PROVIDER_MANIFEST_INVALID' });
  }
  const subscription = manifest('claude', 'account', 'client');
  subscription.provider_kind = 'runtime';
  subscription.controls.authority = 'delegated_l0';
  assert.throws(() => parseProviderControlManifest(subscription), { code: 'CONTROL_PROVIDER_MANIFEST_INVALID' });
  const local = manifest('antigravity', 'local', 'client');
  local.billing.max_request_microusd = 1;
  assert.throws(() => parseProviderControlManifest(local), { code: 'CONTROL_PROVIDER_MANIFEST_INVALID' });
});

test('binding drift is rejected and declared control evidence does not certify a real journey', () => {
  const value = manifest();
  assert.throws(() => inspectProviderControlManifest(value, 'd'.repeat(64)), { code: 'CONTROL_PROVIDER_BINDING_DRIFT' });
  value.controls.cancel = 'verified';
  value.controls.evidence_sha256 = 'e'.repeat(64);
  assert.equal(inspectProviderControlManifest(value, value.binding_sha256).real_conformance, 'not_certified');
});
