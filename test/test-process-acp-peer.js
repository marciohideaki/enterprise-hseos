'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

const { CONTRACT_SCHEMA_VERSION } = require('../packages/agent-runtime-contracts');
const { DeepSeekHarnessRuntimeProvider, ProcessAcpPeer, RuntimeProviderError } = require('../packages/runtime-providers');
const fixtures = require('./fixtures/agent-runtime-contracts');

const ROOT = path.join(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'fake-acp-process.js');
const PROVIDER_ID = 'runtime:deepseek-harness';

function peer(mode = 'normal') {
  return new ProcessAcpPeer({
    executable: process.execPath,
    args: [FIXTURE, mode],
    cwd: ROOT,
    env: { PATH: process.env.PATH },
  });
}

function spec() {
  return {
    ...structuredClone(fixtures.delegatedSession),
    session_id: 'session:deepseek-process',
    execution: { mode: 'delegated', runtime_provider_id: PROVIDER_ID, profile: 'instructions-only' },
    metadata: { cwd: ROOT, purpose: 'DeepSeek ACP process conformance' },
  };
}

function runtime(acpPeer) {
  let tick = 0;
  return new DeepSeekHarnessRuntimeProvider({
    provider_id: PROVIDER_ID,
    peer: acpPeer,
    default_cwd: ROOT,
    clock: () => new Date(Date.parse('2026-08-24T02:00:00Z') + tick++ * 1000).toISOString(),
  });
}

test('process ACP peer drives one bounded DeepSeek-compatible session over JSON-RPC stdio', async () => {
  const acpPeer = peer();
  const provider = runtime(acpPeer);
  try {
    const created = await provider.create({
      schema_version: CONTRACT_SCHEMA_VERSION,
      command: 'create',
      provider_id: PROVIDER_ID,
      spec: spec(),
    });
    assert.equal(created.runtime_session_id, 'deepseek-acp-session-1');
    const send = await provider.send({
      schema_version: CONTRACT_SCHEMA_VERSION,
      command: 'send',
      provider_id: PROVIDER_ID,
      runtime_session_id: created.runtime_session_id,
      session_id: spec().session_id,
      turn_id: 'turn:deepseek-process',
      message: { role: 'user', content: 'answer without effects' },
    });
    assert.equal(send.accepted, true);
    const events = [];
    for await (const event of provider.events({
      schema_version: CONTRACT_SCHEMA_VERSION,
      provider_id: PROVIDER_ID,
      runtime_session_id: created.runtime_session_id,
      session_id: spec().session_id,
      from_sequence: 0,
    }))
      events.push(event);
    assert.deepEqual(
      events.map((event) => event.event_type),
      ['runtime.session.started', 'runtime.message.delta', 'runtime.session.completed'],
    );
    assert.equal(events[1].payload.text, 'deepseek fixture answer');
  } finally {
    await provider.close();
  }
});

test('stock-like DeepSeek ACP initialization without HSEOS effect attestation fails closed', async () => {
  const acpPeer = peer('unattested');
  const provider = runtime(acpPeer);
  try {
    await assert.rejects(
      provider.create({
        schema_version: CONTRACT_SCHEMA_VERSION,
        command: 'create',
        provider_id: PROVIDER_ID,
        spec: spec(),
      }),
      (error) => error instanceof RuntimeProviderError && error.error_code === 'policy_denied',
    );
  } finally {
    await provider.close();
  }
});

test('DeepSeek ACP process binding rejects cross-process resume when loadSession is absent', async () => {
  const firstPeer = peer();
  const first = runtime(firstPeer);
  const created = await first.create({
    schema_version: CONTRACT_SCHEMA_VERSION,
    command: 'create',
    provider_id: PROVIDER_ID,
    spec: spec(),
  });
  await first.close();

  const secondPeer = peer();
  const second = runtime(secondPeer);
  try {
    await assert.rejects(
      second.resume({
        schema_version: CONTRACT_SCHEMA_VERSION,
        command: 'resume',
        provider_id: PROVIDER_ID,
        runtime_session_id: created.runtime_session_id,
        session_id: spec().session_id,
        expected_sequence: 1,
        spec: spec(),
      }),
      (error) => error instanceof RuntimeProviderError && error.error_code === 'capability_unavailable',
    );
  } finally {
    await second.close();
  }
});

test('process ACP peer answers permission requests while the provider denies the effect', async () => {
  const acpPeer = peer('permission');
  const provider = runtime(acpPeer);
  try {
    const created = await provider.create({
      schema_version: CONTRACT_SCHEMA_VERSION,
      command: 'create',
      provider_id: PROVIDER_ID,
      spec: spec(),
    });
    await provider.send({
      schema_version: CONTRACT_SCHEMA_VERSION,
      command: 'send',
      provider_id: PROVIDER_ID,
      runtime_session_id: created.runtime_session_id,
      session_id: spec().session_id,
      turn_id: 'turn:permission',
      message: { role: 'user', content: 'attempt effect' },
    });
    const events = [];
    for await (const event of provider.events({
      schema_version: CONTRACT_SCHEMA_VERSION,
      provider_id: PROVIDER_ID,
      runtime_session_id: created.runtime_session_id,
      session_id: spec().session_id,
      from_sequence: 0,
    }))
      events.push(event);
    assert.equal(events.at(-1).event_type, 'runtime.session.failed');
    assert.equal(events.at(-1).payload.error_code, 'policy_denied');
  } finally {
    await provider.close();
  }
});

test('process ACP peer closes on an unknown JSON-RPC response id', async () => {
  const acpPeer = peer('unknown-response');
  const provider = runtime(acpPeer);
  try {
    await assert.rejects(
      provider.create({
        schema_version: CONTRACT_SCHEMA_VERSION,
        command: 'create',
        provider_id: PROVIDER_ID,
        spec: spec(),
      }),
      (error) => error instanceof RuntimeProviderError && error.error_code === 'protocol_error',
    );
  } finally {
    await provider.close();
  }
});
