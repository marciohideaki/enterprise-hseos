'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
  ConservativeUtf8TokenCounter,
  ContextMediaError,
  ContextMediaStore,
  TokenCounterError,
  assertMediaWithinLimits,
  verifyMediaBytes,
} = require('../packages/agent-context');
const { CONTEXT_ASSEMBLY_CONTRACT_V2 } = require('../packages/agent-runtime-contracts');
const {
  assembler,
  assemblyInput,
  jpegBytes,
  mediaDescriptor,
  openStore,
  pngBytes,
  prepareSession,
  riff,
  providerManifest,
  session,
  sha256,
  webpBytes,
} = require('./fixtures/agent-context-harness');

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-ctx-media-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function stored(mediaStore, buffer, overrides = {}) {
  const descriptor = mediaDescriptor(buffer, overrides);
  mediaStore.put(buffer, descriptor);
  return descriptor;
}

function withAssembly(t, label, body, { manifest = providerManifest({ imageInput: true }) } = {}) {
  const { db, store } = openStore();
  t.after(() => db.close());
  const spec = session(`session:${label}`);
  const turn = prepareSession(store, spec);
  const mediaStore = new ContextMediaStore({ root: tempRoot(t) });
  return body({ store, spec, turn, mediaStore, manifest, build: (overrides) => assemblyInput(spec, turn, overrides) });
}

function appended(store, spec) {
  return store.readSession(spec.session_id).length;
}

test('media store round-trips PNG, JPEG and WebP and verifies magic, digest, size and dimensions', (t) => {
  const mediaStore = new ContextMediaStore({ root: tempRoot(t) });
  for (const [type, buffer] of [
    ['image/png', pngBytes(4, 3)],
    ['image/jpeg', jpegBytes()],
    ['image/webp', webpBytes()],
  ]) {
    const descriptor = mediaDescriptor(buffer, { media_type: type });
    const receipt = mediaStore.put(buffer, descriptor);
    assert.equal(receipt.artifact_ref, `artifact://sha256/${sha256(buffer)}`);
    assert.deepEqual(mediaStore.load(descriptor), buffer);
    assert.deepEqual(mediaStore.put(buffer, descriptor), receipt, 'storing the same content is idempotent');
  }
  assert.throws(() => verifyMediaBytes(pngBytes(4, 3), mediaDescriptor(pngBytes(4, 3), { width: 9 })), /dimensions/);
  assert.throws(() => verifyMediaBytes('text', mediaDescriptor(pngBytes(4, 3))), ContextMediaError);
  assert.throws(
    () => verifyMediaBytes(pngBytes(4, 3), mediaDescriptor(pngBytes(4, 3), { media_type: 'image/gif' })),
    (error) => error.code === 'AGENT_CONTEXT_MEDIA_INVALID',
  );
  assert.throws(
    () => new ContextMediaStore({ root: 'relative/path' }),
    (error) => error instanceof ContextMediaError,
  );
});

test('tampered, truncated, linked or foreign artifacts fail with a digest mismatch before use', (t) => {
  const root = tempRoot(t);
  const mediaStore = new ContextMediaStore({ root });
  const buffer = pngBytes(4, 3);
  const descriptor = stored(mediaStore, buffer);
  const file = path.join(root, 'context-media', descriptor.digest);
  const mismatch = (error) => error.code === 'AGENT_CONTEXT_MEDIA_DIGEST_MISMATCH';

  fs.writeFileSync(file, Buffer.concat([buffer.subarray(0, -1), Buffer.from([0])]));
  assert.throws(() => mediaStore.load(descriptor), mismatch, 'same size, different bytes');
  fs.writeFileSync(file, buffer.subarray(0, 20));
  assert.throws(() => mediaStore.load(descriptor), mismatch, 'truncated file');
  fs.rmSync(file);
  fs.mkdirSync(file);
  assert.throws(() => mediaStore.load(descriptor), mismatch, 'directory in place of the file');
  fs.rmdirSync(file);
  const outside = path.join(root, 'outside');
  fs.writeFileSync(outside, buffer);
  fs.symlinkSync(outside, file);
  assert.throws(() => mediaStore.load(descriptor), mismatch, 'symbolic link');
  fs.rmSync(file);
  fs.linkSync(outside, file);
  assert.throws(() => mediaStore.load(descriptor), mismatch, 'hard linked file');
  fs.rmSync(file);
  assert.throws(
    () => mediaStore.load(descriptor),
    (error) => error.code === 'AGENT_CONTEXT_MEDIA_UNAVAILABLE',
  );
  assert.throws(() => mediaStore.load({ ...descriptor, digest: 'not-a-digest' }), ContextMediaError);
  const wrongMagic = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40)]);
  assert.throws(() => mediaStore.put(wrongMagic, mediaDescriptor(wrongMagic)), mismatch);
  assert.throws(() => mediaStore.put('text', mediaDescriptor(buffer)), ContextMediaError);
});

test('a damaged artifact on a content address is repaired by storing the exact bytes again', (t) => {
  const root = tempRoot(t);
  const mediaStore = new ContextMediaStore({ root });
  const buffer = pngBytes(4, 3);
  const descriptor = stored(mediaStore, buffer);
  const file = path.join(root, 'context-media', descriptor.digest);
  fs.writeFileSync(file, Buffer.alloc(buffer.length, 1));
  stored(mediaStore, buffer);
  assert.deepEqual(mediaStore.load(descriptor), buffer);
  assert.deepEqual(
    fs.readdirSync(path.join(root, 'context-media')).filter((name) => name.startsWith('.tmp-')),
    [],
  );
});

test('byte ceilings are enforced per item, per count and per assembly', () => {
  const item = (bytes, ref = 'media://x') => mediaDescriptor(pngBytes(4, 3), { bytes, source_ref: ref });
  const tooLarge = (error) => error.code === 'AGENT_CONTEXT_MEDIA_TOO_LARGE';
  assertMediaWithinLimits([item(5_242_880)]);
  assert.throws(() => assertMediaWithinLimits([item(5_242_881)]), tooLarge);
  assert.throws(() => assertMediaWithinLimits(Array.from({ length: 9 }, (_, index) => item(10, `media://${index}`))), tooLarge);
  assert.throws(
    () => assertMediaWithinLimits(Array.from({ length: 4 }, (_, index) => item(5_242_880, `media://${index}`))),
    tooLarge,
    'four maximum items exceed the 16 MiB assembly ceiling',
  );
  const mediaStore = new ContextMediaStore({ root: os.tmpdir() });
  assert.throws(() => mediaStore.put(Buffer.alloc(5_242_881), mediaDescriptor(pngBytes(4, 3))), tooLarge);
});

test('counter v2 bounds image cost and is deterministic; a counter without count_media rejects media', () => {
  const counter = new ConservativeUtf8TokenCounter();
  assert.equal(counter.count_media({ media_type: 'image/png', width: 4, height: 3, bytes: 100 }), 85 + 1);
  assert.equal(counter.count_media({ media_type: 'image/png', width: 1024, height: 1024, bytes: 100 }), 85 + 4096);
  assert.equal(counter.count_media({ media_type: 'image/png', width: 1, height: 1, bytes: 750_000 }), 85 + 1000);
  assert.equal(counter.count('héllo'), 6, 'text counting is unchanged');
  assert.ok(TokenCounterError);
});

test('assembles media as digest-verified parts with bytes kept out of the durable event', (t) => {
  withAssembly(t, 'media-ok', ({ store, spec, build, mediaStore, manifest, turn }) => {
    const buffer = pngBytes(4, 3, 200);
    const required = stored(mediaStore, buffer, { source_ref: 'media://capture/required' });
    const optionalBuffer = jpegBytes({ filler: 64 });
    const optional = stored(mediaStore, optionalBuffer, { source_ref: 'media://capture/optional', media_type: 'image/jpeg', priority: 10 });
    const baselineStore = openStore();
    t.after(() => baselineStore.db.close());
    const baselineSpec = session('session:media-baseline');
    const baselineTurn = prepareSession(baselineStore.store, baselineSpec);
    const baseline = assembler(baselineStore.store, { manifest }).assembleAndRecord(assemblyInput(baselineSpec, baselineTurn));

    const input = build({
      media: [optional, required],
      current_turn: {
        source_ref: 'session-event://event:context-turn',
        message: turn,
        parts: [{ type: 'image', source_ref: required.source_ref }],
      },
    });
    const result = assembler(store, { manifest, mediaStore }).assembleAndRecord(input);
    const payload = result.event.payload;

    assert.equal(payload.assembly_contract, CONTEXT_ASSEMBLY_CONTRACT_V2);
    assert.deepEqual(
      result.request.parts.map((part) => [part.source_ref, part.type, part.bytes]),
      [
        ['media://capture/required', 'image', buffer.length],
        ['media://capture/optional', 'image', optionalBuffer.length],
      ],
    );
    assert.ok(payload.source_refs.includes('media://capture/required'));
    const record = payload.sources.find((entry) => entry.source_ref === 'media://capture/required');
    assert.deepEqual(
      [record.authority, record.origin, record.trust, record.media_type, record.artifact_ref],
      ['data', 'browser', 'untrusted', 'image/png', required.artifact_ref],
    );
    assert.equal(JSON.stringify(result.event).includes(buffer.toString('base64')), false, 'pixels never enter the event');
    assert.equal(JSON.stringify(result.event).includes(buffer.toString('latin1')), false);
    // cost: both images are accounted inside message_tokens, so the v1 accounting identity still balances
    const counter = new ConservativeUtf8TokenCounter();
    const expectedMedia = counter.count_media(required) + counter.count_media(optional);
    assert.equal(result.budget.message_tokens - baseline.budget.message_tokens, expectedMedia);
    assert.equal(result.budget.input_tokens, result.budget.message_tokens + result.budget.tool_tokens + result.budget.parameter_tokens);
    assert.equal(appended(store, spec), 3);
    assert.deepEqual(store.reconstructRequest(spec.session_id).source_refs, result.source_refs);
  });
});

test('optional media is omitted by priority under truncate_optional; required media stays', (t) => {
  withAssembly(t, 'media-budget', ({ store, build, mediaStore, manifest, turn }) => {
    const required = stored(mediaStore, pngBytes(4, 3, 10), { source_ref: 'media://required' });
    const high = stored(mediaStore, jpegBytes({ width: 100, height: 100, filler: 40 }), {
      source_ref: 'media://high',
      media_type: 'image/jpeg',
      width: 100,
      height: 100,
      priority: 90,
    });
    const huge = stored(mediaStore, webpBytes({ width: 8000, height: 8000, filler: 40 }), {
      source_ref: 'media://huge',
      media_type: 'image/webp',
      width: 8000,
      height: 8000,
      priority: 5,
    });
    const small = providerManifest({ imageInput: true, contextTokens: 4000 });
    const result = assembler(store, { manifest: small, mediaStore }).assembleAndRecord(
      build({
        overflow_policy: 'truncate_optional',
        media: [huge, high, required],
        current_turn: {
          source_ref: 'session-event://event:context-turn',
          message: turn,
          parts: [{ type: 'image', source_ref: 'media://required' }],
        },
      }),
    );
    assert.deepEqual(
      result.request.parts.map((part) => part.source_ref),
      ['media://high', 'media://required'],
    );
    assert.deepEqual(result.budget.omitted_source_refs, ['media://huge']);
    assert.ok(manifest.capabilities.includes('image_input'));
  });
});

test('a provider without image_input rejects media before any append', (t) => {
  withAssembly(
    t,
    'media-no-capability',
    ({ store, spec, build, mediaStore, manifest }) => {
      const descriptor = stored(mediaStore, pngBytes(4, 3));
      assert.throws(
        () => assembler(store, { manifest, mediaStore }).assembleAndRecord(build({ media: [descriptor] })),
        (error) => error.code === 'AGENT_CONTEXT_PROVIDER_LACKS_IMAGE_INPUT',
      );
      assert.equal(appended(store, spec), 2);
    },
    { manifest: providerManifest({ imageInput: false }) },
  );
});

test('a counter without count_media rejects media; so does a nondeterministic or failing one', (t) => {
  withAssembly(t, 'media-counter', ({ store, spec, build, mediaStore, manifest }) => {
    const descriptor = stored(mediaStore, pngBytes(4, 3));
    const textOnly = { counter_id: 'token-counter:text-only', count: (text) => Buffer.byteLength(text, 'utf8') };
    assert.throws(
      () => assembler(store, { manifest, mediaStore, counter: textOnly }).assembleAndRecord(build({ media: [descriptor] })),
      (error) => error.code === 'AGENT_CONTEXT_COUNTER_MEDIA_UNSUPPORTED',
    );
    let calls = 0;
    const flaky = { ...textOnly, count_media: () => ++calls };
    assert.throws(
      () => assembler(store, { manifest, mediaStore, counter: flaky }).assembleAndRecord(build({ media: [descriptor] })),
      (error) => error instanceof TokenCounterError,
    );
    const failing = {
      ...textOnly,
      count_media: () => {
        throw new Error('boom');
      },
    };
    assert.throws(
      () => assembler(store, { manifest, mediaStore, counter: failing }).assembleAndRecord(build({ media: [descriptor] })),
      (error) => error.code === 'AGENT_CONTEXT_COUNTER_FAILED',
    );
    assert.equal(appended(store, spec), 2);
  });
});

test('media needs a store, matching bytes and ceilings, and nothing is appended when any check fails', (t) => {
  withAssembly(t, 'media-checks', ({ store, spec, build, mediaStore, manifest, turn }) => {
    const buffer = pngBytes(4, 3);
    const descriptor = stored(mediaStore, buffer);
    assert.throws(
      () => assembler(store, { manifest }).assembleAndRecord(build({ media: [descriptor] })),
      (error) => error.code === 'AGENT_CONTEXT_MEDIA_STORE_REQUIRED',
    );
    assert.throws(
      () =>
        assembler(store, { manifest, mediaStore }).assembleAndRecord(
          build({ media: [{ ...descriptor, digest: sha256('other'), artifact_ref: `artifact://sha256/${sha256('other')}` }] }),
        ),
      (error) => error.code === 'AGENT_CONTEXT_MEDIA_UNAVAILABLE',
    );
    assert.throws(
      () =>
        assembler(store, { manifest, mediaStore }).assembleAndRecord(build({ media: [{ ...descriptor, bytes: descriptor.bytes + 1 }] })),
      (error) => error.code === 'AGENT_CONTEXT_MEDIA_DIGEST_MISMATCH',
    );
    assert.throws(
      () => assembler(store, { manifest, mediaStore }).assembleAndRecord(build({ media: [{ ...descriptor, bytes: 6_000_000 }] })),
      (error) => error.code === 'AGENT_CONTEXT_MEDIA_TOO_LARGE',
    );
    assert.throws(
      () => assembler(store, { manifest, mediaStore }).assembleAndRecord(build({ media: [{ ...descriptor, authority: 'directive' }] })),
      (error) => error.code === 'AGENT_CONTRACT_SCHEMA_INVALID',
    );
    assert.throws(
      () => assembler(store, { manifest, mediaStore }).assembleAndRecord(build({ media: [{ ...descriptor, trust: 'trusted' }] })),
      (error) => error.code === 'AGENT_CONTRACT_SCHEMA_INVALID',
    );
    assert.throws(
      () =>
        assembler(store, { manifest, mediaStore }).assembleAndRecord(
          build({
            current_turn: {
              source_ref: 'session-event://event:context-turn',
              message: turn,
              parts: [{ type: 'image', source_ref: 'media://absent' }],
            },
          }),
        ),
      (error) => error.code === 'AGENT_CONTRACT_SCHEMA_INVALID',
    );
    assert.equal(appended(store, spec), 2);
  });
});

test('correct digest and size with the wrong magic signature is refused for every media type', () => {
  const samples = { 'image/png': pngBytes(4, 3), 'image/jpeg': jpegBytes(), 'image/webp': webpBytes() };
  for (const [declared] of Object.entries(samples)) {
    for (const [actual, buffer] of Object.entries(samples)) {
      if (actual === declared) continue;
      assert.throws(
        () => verifyMediaBytes(buffer, mediaDescriptor(buffer, { media_type: declared })),
        (error) => error.code === 'AGENT_CONTEXT_MEDIA_DIGEST_MISMATCH' && /signature/.test(error.message),
        `${actual} bytes declared as ${declared}`,
      );
    }
  }
  assert.throws(
    () => verifyMediaBytes(Buffer.from('RIFFxxxxWAVEdata'), mediaDescriptor(Buffer.from('RIFFxxxxWAVEdata'), { media_type: 'image/webp' })),
    /signature/,
  );
});

test('count and total ceilings accept the exact limit and refuse one past it', () => {
  const item = (bytes, ref) => mediaDescriptor(pngBytes(4, 3), { bytes, source_ref: `media://${ref}` });
  const tooLarge = (error) => error.code === 'AGENT_CONTEXT_MEDIA_TOO_LARGE';
  assertMediaWithinLimits(Array.from({ length: 8 }, (_, index) => item(10, index)));
  assert.throws(() => assertMediaWithinLimits(Array.from({ length: 9 }, (_, index) => item(10, index))), tooLarge);
  const exact = [item(5_242_880, 'a'), item(5_242_880, 'b'), item(5_242_880, 'c'), item(1_048_576, 'd')];
  assertMediaWithinLimits(exact);
  assert.throws(() => assertMediaWithinLimits([...exact.slice(0, 3), item(1_048_577, 'd')]), tooLarge);
});

test('real dimensions are read from PNG, JPEG and WebP (VP8, VP8L, VP8X) and must equal the declaration', () => {
  const cases = [
    ['image/png', pngBytes(640, 480)],
    ['image/jpeg', jpegBytes({ width: 640, height: 480 })],
    ['image/jpeg', jpegBytes({ width: 640, height: 480, marker: 0xc2 })],
    ['image/webp', webpBytes({ width: 640, height: 480 })],
    ['image/webp', webpBytes({ width: 640, height: 480, kind: 'vp8l' })],
    ['image/webp', webpBytes({ width: 640, height: 480, kind: 'vp8x' })],
  ];
  for (const [type, buffer] of cases) {
    const exact = mediaDescriptor(buffer, { media_type: type, width: 640, height: 480 });
    assert.equal(verifyMediaBytes(buffer, exact), buffer);
    for (const wrong of [{ width: 641 }, { height: 479 }, { width: 1, height: 1 }]) {
      assert.throws(
        () => verifyMediaBytes(buffer, { ...exact, ...wrong }),
        (error) => error.code === 'AGENT_CONTEXT_MEDIA_DIGEST_MISMATCH' && /dimensions/.test(error.message),
        `${type} with ${JSON.stringify(wrong)}`,
      );
    }
  }
});

test('formats whose dimensions cannot be read are refused (fail closed)', () => {
  const unreadable = (type, buffer) => {
    const descriptor = mediaDescriptor(buffer, { media_type: type });
    assert.throws(
      () => verifyMediaBytes(buffer, descriptor),
      (error) => error.code === 'AGENT_CONTEXT_MEDIA_INVALID' && /cannot be read/.test(error.message),
    );
  };
  const png = pngBytes(4, 3);
  png.write('XXXX', 12, 'latin1');
  unreadable('image/png', png);

  const jpeg = jpegBytes();
  const noFrame = Buffer.concat([jpeg.subarray(0, 20), Buffer.from([0xff, 0xd9])]);
  unreadable('image/jpeg', noFrame);
  unreadable('image/jpeg', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3)]));
  unreadable('image/jpeg', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01]), Buffer.alloc(8)]));
  unreadable('image/jpeg', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08]), Buffer.alloc(8)]));
  unreadable('image/jpeg', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]), Buffer.alloc(2)]));
  unreadable('image/jpeg', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00])]));
  unreadable('image/jpeg', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xff, 0xff, 0xd9]), Buffer.alloc(8)]));
  unreadable('image/jpeg', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0x01, 0x01, 0x01, 0xff, 0xd9]), Buffer.alloc(4)]));

  unreadable('image/webp', riff('ALPH', Buffer.alloc(10), 8));
  unreadable('image/webp', webpBytes().subarray(0, 14));
  const badStart = webpBytes();
  badStart[23] = 0;
  unreadable('image/webp', badStart);
  const shortVp8 = riff('VP8 ', Buffer.alloc(2), 0);
  unreadable('image/webp', shortVp8);
  unreadable('image/webp', riff('VP8L', Buffer.from([0x00, 0, 0, 0, 0]), 4));
  unreadable('image/webp', riff('VP8L', Buffer.alloc(2), 0));
  unreadable('image/webp', riff('VP8X', Buffer.alloc(4), 0));
});
