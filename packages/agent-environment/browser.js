'use strict';

// Controller side of environment.browser.v1. The browser runs inside the P2 sandbox with mediated egress; what it
// returns is validated here and only then becomes untrusted data (media-source and context-source parts).
const fs = require('node:fs');
const path = require('node:path');
const contract = require('./browser-contract');

const { BROWSER_OUTPUT_SCHEMA, CONTRACT, OPS, canonical, parseInput, parseNavigationUrl, sha256, urlAuthority } = contract;

const SANDBOX_TOOLCHAIN = '/opt/hseos/toolchain';
const PIN_NAMES = ['playwright-core', 'chrome-headless-shell'];
const REQUIRED_ENTRIES = [
  'playwright-core/package/package.json',
  'chrome-headless-shell/chrome-headless-shell-linux64/chrome-headless-shell',
];
const HOST_FILES = ['browser-host.js', 'browser-contract.js'];
const GRACE_MS = 15_000;
const LIMITS = { pids_max: 256, memory_max_bytes: 2_147_483_648, shm_bytes: 268_435_456, nofile: 1024 };
const UNAVAILABLE = new Set(['ENV_BROWSER_UNAVAILABLE']);
// eslint-disable-next-line no-control-regex -- DOM text is untrusted: control characters never reach a context source.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;
const MEDIA_PRIORITY = 50;
const HOST_CODE = /^ENV_BROWSER_[A-Z_]{1,64}$/u;
const STEP_ERRORS = new Set(['ENV_BROWSER_TIMEOUT', 'ENV_BROWSER_STEP_FAILED', 'ENV_BROWSER_EGRESS_DENIED']);
const MAX_URL = 2048;
// One browser instance at a time per process: every service queues behind the same tail.
const NO_DROPS = Object.freeze({ allowed: 0, denied: 0 });
const queue = { tail: Promise.resolve() };

/** What the sandbox reports about each step is data: only a closed vocabulary and bounded values pass. */
function validSteps(steps) {
  return (
    Array.isArray(steps) &&
    steps.length > 0 &&
    steps.every(
      (step) =>
        step &&
        Number.isSafeInteger(step.index) &&
        OPS.includes(step.op) &&
        typeof step.ok === 'boolean' &&
        (step.status === undefined || step.status === null || Number.isSafeInteger(step.status)) &&
        (step.url === undefined || (typeof step.url === 'string' && step.url.length <= MAX_URL)) &&
        (step.error === undefined || STEP_ERRORS.has(step.error)),
    )
  );
}

/** Origin and path of the final URL (no query, no fragment) travel in the source reference of each part. */
function referenceUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`.slice(0, 700);
  } catch {
    return 'invalid-url';
  }
}

/** Install the host files next to the pins so the sandbox mounts one read-only directory. */
function prepareBrowserToolchain({ install, cacheDirectory, destination }) {
  let installed;
  try {
    installed = install({ cacheDirectory, destination, names: PIN_NAMES });
  } catch (error) {
    return Object.freeze({ status: 'blocked', code: error.code || 'ENV_TOOLCHAIN_BLOCKED', cause: error.message });
  }
  fs.mkdirSync(path.join(destination, 'host'), { recursive: true, mode: 0o700 });
  for (const name of HOST_FILES) fs.copyFileSync(path.join(__dirname, name), path.join(destination, 'host', name));
  return Object.freeze({ status: 'ready', root: destination, pins: installed.pins });
}

function pngSize(buffer) {
  if (buffer.length < 24 || buffer.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function createBrowserService({
  policy,
  toolchain,
  broker,
  execute,
  createChannel,
  sandboxFlags,
  mediaStore,
  containsCredential,
  ledger = () => {},
  now = () => new Date(),
}) {
  const record = (event) => ledger(Object.freeze({ contract: CONTRACT, at: now().toISOString(), ...event }));
  const egressOf = (events, dropped = NO_DROPS) => {
    const denied = events
      .filter((event) => event.decision === 'denied')
      .map(({ host, port, method, reason }) => ({ host: host ?? null, port: port ?? null, method, reason }));
    return Object.freeze({
      allow: broker.allow,
      requests: events.length + dropped.allowed + dropped.denied,
      denied: Object.freeze(denied),
      dropped: Object.freeze({ ...dropped }),
    });
  };
  const refuse = (code, cause, extra = {}) => {
    record({ type: 'environment.browser.refused', code, cause, ...extra });
    return Object.freeze({ contract: CONTRACT, status: 'refused', code, cause, ...extra });
  };
  const blocked = (code, cause) => {
    record({ type: 'environment.browser.blocked', code, cause });
    return Object.freeze({ contract: CONTRACT, status: 'blocked', code, cause });
  };

  async function readHostOutput(execution, channel) {
    const text = execution.stdout.trim();
    if (!text.startsWith('[')) return { host: JSON.parse(text), artifacts: [] };
    const artifacts = channel.verify(text);
    return { host: JSON.parse(artifacts[0].content.toString('utf8')), artifacts };
  }

  /** Screenshots and DOM text become data parts with URL, UTC time, digest and the transform that produced them. */
  function toParts(result, artifacts, viewport, retrievedAt) {
    const media = [];
    const context = [];
    const captures = [];
    for (const [index, capture] of result.captures.entries()) {
      if (typeof capture.url !== 'string' || capture.url.length > MAX_URL)
        throw Object.assign(new Error('capture has no usable URL'), { code: 'ENV_BROWSER_RESULT_INVALID' });
      const sourceRef = `environment.browser.${capture.kind}.${index}@${referenceUrl(capture.url)}`;
      const transformInput = sha256(canonical({ url: capture.url, viewport }));
      if (capture.kind === 'screenshot') {
        const artifact = artifacts.find((item) => item.name === capture.file);
        const size = artifact ? pngSize(artifact.content) : null;
        if (!size) throw Object.assign(new Error('screenshot is not a readable PNG'), { code: 'ENV_BROWSER_RESULT_INVALID' });
        const stored = mediaStore.put(artifact.content, {
          media_type: 'image/png',
          width: size.width,
          height: size.height,
          source_ref: sourceRef,
        });
        const transform = [{ id: 'browser-viewport', version: '1', input_digest: transformInput }];
        media.push({
          source_ref: sourceRef,
          media_type: 'image/png',
          digest: stored.digest,
          bytes: stored.bytes,
          width: size.width,
          height: size.height,
          origin: 'browser',
          authority: 'data',
          trust: 'untrusted',
          transform,
          priority: MEDIA_PRIORITY,
          artifact_ref: stored.artifact_ref,
        });
        captures.push({
          source_ref: sourceRef,
          kind: 'screenshot',
          url: capture.url,
          retrieved_at: retrievedAt,
          digest: stored.digest,
          transform,
        });
        continue;
      }
      const content = `${capture.title}\n\n${capture.text.text}\n\n--- accessibility tree ---\n${capture.accessibility.text}`.replaceAll(
        CONTROL,
        ' ',
      );
      if (containsCredential(content))
        throw Object.assign(new Error('page text holds a credential pattern'), { code: 'ENV_BROWSER_CREDENTIAL_DETECTED' });
      const digest = sha256(content);
      const truncated = capture.text.truncated || capture.accessibility.truncated;
      const transform = [{ id: 'browser-dom-text', version: '1', input_digest: sha256(canonical({ url: capture.url, truncated })) }];
      context.push({
        source_ref: sourceRef,
        classification: 'internal',
        content,
        authority: 'data',
        provenance: { origin: 'browser', source_ref: sourceRef, digest, retrieved_at: retrievedAt, trust: 'untrusted', transform },
      });
      captures.push({ source_ref: sourceRef, kind: 'dom', url: capture.url, retrieved_at: retrievedAt, digest, truncated, transform });
    }
    return { media, context, captures };
  }

  async function execution(request, inputDigest) {
    for (const step of request.steps.filter((item) => item.op === 'goto')) {
      const url = parseNavigationUrl(step.url);
      if (!broker.allow.includes(urlAuthority(url))) {
        const event = {
          decision: 'denied',
          method: 'GET',
          host: url.hostname.toLowerCase(),
          port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
          reason: 'host_not_allowed',
        };
        return refuse('ENV_BROWSER_EGRESS_DENIED', 'navigation target is not on the egress allowlist', {
          input_digest: inputDigest,
          egress: egressOf([event]),
        });
      }
    }
    // The renderer needs loopback sockets and the broker socket, which only P2 grants.
    if (policy.profile !== 'P2') return blocked('ENV_BROWSER_PROFILE_INSUFFICIENT', 'the browser needs the brokered network profile (P2)');
    if (toolchain.status !== 'ready') return blocked(toolchain.code, toolchain.cause);
    for (const entry of REQUIRED_ENTRIES) {
      if (!fs.existsSync(path.join(toolchain.root, entry))) return blocked('ENV_BROWSER_UNAVAILABLE', `${entry} is not installed`);
    }
    broker.drain();
    broker.dropped();
    const channel = createChannel();
    try {
      const timeoutMs = request.timeout_ms + GRACE_MS;
      const hostRequest = {
        steps: request.steps,
        viewport: request.viewport,
        timeout_ms: request.timeout_ms,
        toolchain: SANDBOX_TOOLCHAIN,
        flags: sandboxFlags(),
        scratch: '/tmp',
      };
      const run = await execute({
        policy,
        command: ['/usr/bin/node', `${SANDBOX_TOOLCHAIN}/host/browser-host.js`, JSON.stringify(hostRequest)],
        host_node: true,
        timeout_ms: timeoutMs,
        max_output_bytes: 65_536,
        limits: LIMITS,
        artifact_channel: channel,
        readonly_mounts: [{ source: toolchain.root, target: SANDBOX_TOOLCHAIN }],
      });
      const events = broker.drain();
      const egress = egressOf(events, broker.dropped());
      const drained = { descendants_terminated: run.descendants_terminated === true, pids_peak: run.pids_peak };
      // Zero surviving descendants is a requirement, not a report: anything else invalidates the call.
      if (run.descendants_terminated !== true)
        return refuse('ENV_BROWSER_DESCENDANTS_SURVIVED', 'the executor could not prove that no descendant survived', {
          input_digest: inputDigest,
          egress,
          execution: drained,
        });
      let output;
      try {
        output = await readHostOutput(run, channel);
      } catch {
        output = { host: null, artifacts: [] };
      }
      const { host, artifacts } = output;
      if (run.status !== 'succeeded' || !host?.ok) {
        const hostCode = typeof host?.code === 'string' && HOST_CODE.test(host.code) ? host.code : 'ENV_BROWSER_HOST_FAILURE';
        const code = host?.code
          ? hostCode
          : run.status === 'succeeded'
            ? 'ENV_BROWSER_OUTPUT_INVALID'
            : `ENV_BROWSER_${String(run.status).toUpperCase()}`;
        if (UNAVAILABLE.has(code)) return blocked(code, 'the browser could not run');
        return refuse(egress.denied.length > 0 ? 'ENV_BROWSER_EGRESS_DENIED' : code, 'browser call did not succeed', {
          input_digest: inputDigest,
          egress,
          execution: drained,
        });
      }
      const failed = validSteps(host.steps) ? host.steps.find((step) => step.ok === false) : undefined;
      if (!validSteps(host.steps) || !Array.isArray(host.captures)) {
        return refuse('ENV_BROWSER_RESULT_INVALID', 'browser result could not be validated', { input_digest: inputDigest });
      }
      if (failed) {
        const code =
          egress.denied.length > 0 || failed.error === 'ENV_BROWSER_EGRESS_DENIED'
            ? 'ENV_BROWSER_EGRESS_DENIED'
            : failed.error === 'ENV_BROWSER_TIMEOUT'
              ? 'ENV_BROWSER_TIMEOUT'
              : 'ENV_BROWSER_STEP_FAILED';
        return refuse(code, `step ${failed.index} (${failed.op}) failed`, { input_digest: inputDigest, egress, execution: drained });
      }
      const retrievedAt = now().toISOString();
      let parts;
      try {
        parts = toParts(host, artifacts, request.viewport, retrievedAt);
      } catch (error) {
        return error.code?.startsWith('ENV_BROWSER_')
          ? refuse(error.code, error.message, { input_digest: inputDigest, egress })
          : refuse('ENV_BROWSER_RESULT_INVALID', 'browser result could not be validated', { input_digest: inputDigest, egress });
      }
      const steps = host.steps.map(({ index, op, status, url }) => ({
        index,
        op,
        ...(status === undefined ? {} : { status }),
        url: url ?? null,
      }));
      const digest = sha256(canonical({ steps, captures: parts.captures.map((item) => item.digest) }));
      const output_ = Object.freeze({
        contract: CONTRACT,
        status: 'ok',
        steps,
        media: parts.media,
        context: parts.context,
        captures: parts.captures,
        egress,
        execution: Object.freeze({
          profile: run.profile,
          limits: run.limits,
          pids_peak: run.pids_peak,
          memory_peak_bytes: run.memory_peak_bytes,
          workspace_access: run.workspace_access,
          descendants_terminated: run.descendants_terminated,
        }),
      });
      if (!BROWSER_OUTPUT_SCHEMA.safeParse(output_).success)
        return refuse('ENV_BROWSER_OUTPUT_INVALID', 'output is not untrusted data with provenance', { input_digest: inputDigest, egress });
      record({
        type: 'environment.browser.completed',
        input_digest: inputDigest,
        output_digest: digest,
        steps: steps.length,
        denied: egress.denied.length,
        pids_peak: run.pids_peak,
      });
      return output_;
    } finally {
      channel.dispose();
    }
  }

  function run(input) {
    const parsed = parseInput(input);
    if (!parsed.success) return Promise.resolve(refuse(parsed.error.hseos_code, parsed.error.issues[0].message));
    const pending = queue.tail.then(() => execution(parsed.data, sha256(canonical(parsed.data))));
    queue.tail = pending.then(
      () => {},
      () => {},
    );
    return pending;
  }

  return Object.freeze({ run });
}

module.exports = { createBrowserService, prepareBrowserToolchain };
