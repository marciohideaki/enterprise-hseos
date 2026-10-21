'use strict';

// Controller side of environment.computer.v1. One session at a time: a private Xvfb and a GUI target run as one
// long-lived job in the P1 sandbox; each action is a separate call, and every action except a screenshot needs a
// single-use approval bound to that exact action. What the sandbox reports is validated here and only then becomes
// untrusted display data (media-source parts with provenance).
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const contract = require('./computer-contract');

const { CONTRACT, COMPUTER_OUTPUT_SCHEMA, LIMITS, canonical, parseAction, parseStart, sha256 } = contract;

const HOST_FILES = ['computer-host.js', 'computer-contract.js'];
const REQUIRED_BINARIES = ['/usr/bin/Xvfb', '/usr/bin/xwd', '/usr/bin/xdotool'];
const SANDBOX_HOST = '/workspace/computer-host.js';
const PROFILES = new Set(['P1', 'P2']);
const START_WAIT_MS = 20_000;
const ACTION_WAIT_MS = 25_000;
const STOP_WAIT_MS = 5000;
const GRACE_MS = 2000;
const MAX_LINE_BYTES = 131_072;
const MEDIA_PRIORITY = 50;
const HOST_CODE = /^ENV_COMPUTER_[A-Z_]{1,64}$/u;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;
const HEX64 = /^[0-9a-f]{64}$/u;

/** Install the host files into the workspace the sandbox mounts, after the input injector pin is proved. */
function prepareComputerToolchain({ verifySystemPin, cacheDirectory, destination, binaries = REQUIRED_BINARIES }) {
  let pin;
  try {
    pin = verifySystemPin({ cacheDirectory, name: 'xdotool' });
  } catch (error) {
    return Object.freeze({ status: 'blocked', code: error.code || 'ENV_TOOLCHAIN_BLOCKED', cause: error.message });
  }
  for (const binary of binaries) {
    try {
      fs.accessSync(binary, fs.constants.X_OK);
    } catch {
      return Object.freeze({ status: 'blocked', code: 'ENV_COMPUTER_UNAVAILABLE', cause: `${binary} is not installed` });
    }
  }
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const name of HOST_FILES) fs.copyFileSync(path.join(__dirname, name), path.join(destination, name));
  return Object.freeze({ status: 'ready', root: destination, pin });
}

function pngSize(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_MAGIC) || buffer.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** Lines arrive in broker frames of arbitrary size; one JSON event per line, bounded. */
function createEventChannel() {
  const queue = [];
  let waiter = null;
  let buffer = '';
  let closed = false;
  const deliver = (event) => {
    if (waiter) {
      const { resolve, timer } = waiter;
      waiter = null;
      clearTimeout(timer);
      resolve(event);
    } else queue.push(event);
  };
  return {
    feed(text) {
      buffer += text;
      if (buffer.length > MAX_LINE_BYTES) {
        buffer = '';
        deliver({ event: 'error', code: 'ENV_COMPUTER_OUTPUT_INVALID' });
        return;
      }
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        try {
          deliver(JSON.parse(line));
        } catch {
          deliver({ event: 'error', code: 'ENV_COMPUTER_OUTPUT_INVALID' });
        }
      }
    },
    close() {
      closed = true;
      if (waiter) deliver({ event: 'closed' });
    },
    next(timeoutMs) {
      if (queue.length > 0) return Promise.resolve(queue.shift());
      if (closed) return Promise.resolve({ event: 'closed' });
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiter = null;
          resolve({ event: 'timeout' });
        }, timeoutMs);
        waiter = { resolve, timer };
      });
    },
  };
}

function createComputerService({
  policy,
  toolchain,
  approvals,
  mediaStore,
  startTerminal,
  containsCredential = () => false,
  denyDisplays = [],
  ledger = () => {},
  now = () => new Date(),
  schedule = setTimeout,
  unschedule = clearTimeout,
  newId = randomUUID,
  waits = { start: START_WAIT_MS, action: ACTION_WAIT_MS, stop: STOP_WAIT_MS },
}) {
  // The one slot: reserved synchronously by start() before anything is awaited, and released only after the session it
  // holds has been drained. Every timer and callback works on the session object it was created for, never on the slot.
  let slot = null;
  let uncertain = false;
  const record = (event) => ledger(Object.freeze({ contract: CONTRACT, at: now().toISOString(), ...event }));
  const refuse = (code, cause, extra = {}) => {
    record({ type: 'environment.computer.refused', code, cause, ...extra });
    return Object.freeze({ contract: CONTRACT, status: 'refused', code, cause, ...extra });
  };
  const blocked = (code, cause) => {
    record({ type: 'environment.computer.blocked', code, cause });
    return Object.freeze({ contract: CONTRACT, status: 'blocked', code, cause });
  };

  /** Close one session and prove that nothing survives it. Idempotent per session; the first reason wins. */
  function close(current, reason) {
    if (current.closing) return current.closing;
    current.phase = 'closing';
    unschedule(current.timer);
    current.closing = (async () => {
      let descendants = false;
      try {
        // The stop request lets the host kill Xvfb and the target itself; the broker's cgroup kill is the proof.
        current.terminal.command('input', { data: Buffer.from(`${JSON.stringify({ op: 'stop' })}\n`).toString('base64') }).catch(() => {});
        let deadline;
        const finished = await Promise.race([
          current.terminal.completion,
          new Promise((resolve) => {
            deadline = schedule(() => resolve(null), waits.stop);
          }),
        ]);
        unschedule(deadline);
        descendants = finished?.descendants_terminated === true;
        if (finished === null) {
          const killed = await current.terminal.terminate();
          descendants = killed?.descendants_terminated === true;
        }
      } catch {
        descendants = false;
      }
      current.events.close();
      if (!descendants) uncertain = true;
      record({
        type: reason === 'expired' ? 'environment.computer.session_expired' : 'environment.computer.session_closed',
        session_id: current.id,
        reason,
        actions: current.seq,
        descendants_terminated: descendants,
      });
      // Only now is the slot free: a new session never overlaps the drain of the old one.
      if (slot === current) slot = null;
      return { reason, descendants_terminated: descendants };
    })();
    return current.closing;
  }

  async function launch(current, request) {
    const { events } = current;
    const hostRequest = { ...request, deny_displays: denyDisplays };
    let terminal;
    try {
      terminal = startTerminal({
        policy,
        command: ['/usr/bin/node', SANDBOX_HOST, JSON.stringify(hostRequest)],
        host_node: true,
        mode: 'job',
        timeout_ms: request.timeout_ms + GRACE_MS,
        max_output_bytes: LIMITS.max_output_bytes,
        onOutput: (frame) => events.feed(Buffer.from(frame.data, 'base64').toString('utf8')),
      });
    } catch (error) {
      return refuse('ENV_COMPUTER_LAUNCH_FAILED', error.message);
    }
    const abandon = async (code, cause, isBlocked) => {
      events.close();
      try {
        await terminal.terminate();
      } catch {
        uncertain = true;
      }
      return isBlocked ? blocked(code, cause) : refuse(code, cause);
    };
    try {
      await terminal.ready;
    } catch (error) {
      return abandon('ENV_COMPUTER_LAUNCH_FAILED', error.message, false);
    }
    const first = await events.next(waits.start);
    if (first.event !== 'ready') {
      const code = typeof first.code === 'string' && HOST_CODE.test(first.code) ? first.code : 'ENV_COMPUTER_UNAVAILABLE';
      return abandon(code, 'the display session could not start', code === 'ENV_COMPUTER_UNAVAILABLE');
    }
    if (!Array.isArray(first.sockets) || first.sockets.length > 0) {
      return abandon('ENV_COMPUTER_DISPLAY_ISOLATION_BROKEN', 'the sandbox exposes a filesystem X socket', false);
    }
    const expiresAt = new Date(now().getTime() + request.timeout_ms);
    Object.assign(current, {
      terminal,
      display: request.display,
      expiresAtMs: expiresAt.getTime(),
      timer: schedule(() => {
        close(current, 'expired');
      }, request.timeout_ms),
    });
    current.timer.unref?.();
    current.phase = 'open';
    // A session that ends on its own (broker timeout, crash) must not stay "active".
    terminal.completion.then(
      () => {
        if (current.phase === 'open') close(current, 'terminated');
      },
      () => {
        if (current.phase === 'open') {
          uncertain = true;
          close(current, 'terminated');
        }
      },
    );
    record({
      type: 'environment.computer.session_opened',
      session_id: current.id,
      display: request.display,
      target: request.target.command,
    });
    return Object.freeze({
      contract: CONTRACT,
      status: 'started',
      session_id: current.id,
      display: request.display,
      expires_at: expiresAt.toISOString(),
      isolation: Object.freeze({ profile: policy.profile, operator_display_denied: denyDisplays.length, x_sockets: first.sockets.length }),
    });
  }

  async function start(input) {
    const parsed = parseStart(input);
    if (!parsed.success) return refuse(parsed.error.hseos_code, parsed.error.issues[0].message);
    if (uncertain) return refuse('ENV_COMPUTER_SESSION_UNCERTAIN', 'a previous session could not be proved drained');
    if (slot) return refuse('ENV_COMPUTER_SESSION_ACTIVE', 'only one computer-use session runs at a time');
    if (!PROFILES.has(policy.profile)) return blocked('ENV_COMPUTER_PROFILE_INSUFFICIENT', 'the display server needs local sockets (P1)');
    if (toolchain.status !== 'ready') return blocked(toolchain.code, toolchain.cause);
    // Reserved before the first await: a concurrent start() sees the slot taken and never launches a second display.
    const current = {
      id: newId(),
      phase: 'starting',
      events: createEventChannel(),
      seq: 0,
      shots: 0,
      lastShot: null,
      busy: false,
      closing: null,
    };
    slot = current;
    try {
      return await launch(current, parsed.data);
    } finally {
      if (current.phase === 'starting' && slot === current) slot = null;
    }
  }

  function openSession(sessionId) {
    if (!slot || slot.id !== sessionId || slot.phase !== 'open')
      return { error: refuse('ENV_COMPUTER_SESSION_CLOSED', 'there is no such open session') };
    if (now().getTime() >= slot.expiresAtMs) {
      close(slot, 'expired');
      return { error: refuse('ENV_COMPUTER_SESSION_EXPIRED', 'the session expired') };
    }
    return { session: slot };
  }

  function binding(current, parsed) {
    return {
      session_id: current.id,
      seq: current.seq + 1,
      action: parsed.action,
      args: parsed.args,
      screenshot_digest: current.lastShot?.digest,
    };
  }

  /** Ask for the approval of one action. The approver must have seen the screenshot whose digest is bound here. */
  function requestApproval(sessionId, actionInput, options = {}) {
    const found = openSession(sessionId);
    if (found.error) return found.error;
    const { session: current } = found;
    const parsed = parseAction(actionInput, current.display);
    if (!parsed.success) return refuse(parsed.error.hseos_code, parsed.error.issues[0].message);
    if (parsed.data.action === 'screenshot')
      return refuse('ENV_COMPUTER_APPROVAL_NOT_NEEDED', 'a screenshot is read-only and needs no approval');
    if (!current.lastShot) return refuse('ENV_COMPUTER_SCREENSHOT_REQUIRED', 'take a screenshot before asking to act on the display');
    if (parsed.data.action === 'type' && containsCredential(parsed.data.args.text)) {
      return refuse('ENV_COMPUTER_CREDENTIAL_DETECTED', 'the text to type holds a credential pattern');
    }
    const bound = binding(current, parsed.data);
    const granted = approvals.request(bound, options);
    // The approver is shown the step and the screenshot digest the grant is bound to.
    return granted.status === 'refused'
      ? refuse(granted.code, 'approval request was refused')
      : Object.freeze({ ...granted, seq: bound.seq, screenshot_digest: bound.screenshot_digest });
  }

  function parseEvent(event, seq, action) {
    if (event.event === 'timeout') return { code: 'ENV_COMPUTER_TIMEOUT' };
    if (event.event !== 'result' || event.seq !== seq) return { code: 'ENV_COMPUTER_OUTPUT_INVALID' };
    if (event.ok !== true)
      return { code: typeof event.code === 'string' && HOST_CODE.test(event.code) ? event.code : 'ENV_COMPUTER_ACTION_FAILED' };
    if (action !== 'screenshot') return { ok: true };
    const { png_base64: encoded } = event;
    if (typeof encoded !== 'string' || !BASE64.test(encoded)) return { code: 'ENV_COMPUTER_OUTPUT_INVALID' };
    const png = Buffer.from(encoded, 'base64');
    return { ok: true, png };
  }

  function toScreenshot(current, seq, png, claim, retrievedAt) {
    const size = pngSize(png);
    const digest = sha256(png);
    // The host's claim is checked against bytes the controller hashed itself.
    const honest =
      size &&
      size.width === current.display.width &&
      size.height === current.display.height &&
      png.length <= LIMITS.max_screenshot_bytes &&
      png.length === claim.bytes &&
      HEX64.test(claim.sha256 ?? '') &&
      claim.sha256 === digest;
    if (!honest) return null;
    const sourceRef = `environment.computer.screenshot.${current.id}.${seq}`;
    const stored = mediaStore.put(png, { media_type: 'image/png', width: size.width, height: size.height, source_ref: sourceRef });
    const transform = [
      { id: 'computer-display', version: '1', input_digest: sha256(canonical({ session_id: current.id, seq, display: current.display })) },
    ];
    return {
      media: {
        source_ref: sourceRef,
        media_type: 'image/png',
        digest: stored.digest,
        bytes: stored.bytes,
        width: size.width,
        height: size.height,
        origin: 'display',
        authority: 'data',
        trust: 'untrusted',
        transform,
        priority: MEDIA_PRIORITY,
        artifact_ref: stored.artifact_ref,
      },
      capture: {
        source_ref: sourceRef,
        kind: 'screenshot',
        session_id: current.id,
        seq,
        retrieved_at: retrievedAt,
        digest: stored.digest,
        transform,
      },
    };
  }

  async function perform(current, parsed) {
    if (current.busy) return refuse('ENV_COMPUTER_SESSION_BUSY', 'an action is still in flight');
    if (current.seq >= LIMITS.max_actions) return refuse('ENV_COMPUTER_ACTION_QUOTA', 'the session action quota is spent');
    if (parsed.action === 'screenshot' && current.shots >= LIMITS.max_screenshots) {
      return refuse('ENV_COMPUTER_SCREENSHOT_QUOTA', 'the session screenshot quota is spent');
    }
    current.busy = true;
    current.seq += 1;
    const seq = current.seq;
    try {
      const line = `${JSON.stringify({ seq, action: parsed.action, args: parsed.args })}\n`;
      await current.terminal.command('input', { data: Buffer.from(line).toString('base64') });
      const event = await current.events.next(waits.action);
      const outcome = parseEvent(event, seq, parsed.action);
      if (!outcome.ok) return refuse(outcome.code, `${parsed.action} did not succeed`, { session_id: current.id, seq });
      const base = { contract: CONTRACT, status: 'ok', session_id: current.id, seq, action: parsed.action };
      if (parsed.action !== 'screenshot') {
        record({ type: 'environment.computer.action_executed', session_id: current.id, seq, action: parsed.action });
        return Object.freeze({ ...base, target_alive: event.target_alive === true });
      }
      const shot = toScreenshot(current, seq, outcome.png, event, now().toISOString());
      if (!shot) return refuse('ENV_COMPUTER_RESULT_INVALID', 'screenshot could not be validated', { session_id: current.id, seq });
      const output = Object.freeze({ ...base, media: [shot.media], captures: [shot.capture] });
      if (!COMPUTER_OUTPUT_SCHEMA.safeParse(output).success) {
        return refuse('ENV_COMPUTER_OUTPUT_INVALID', 'output is not untrusted display data', { session_id: current.id, seq });
      }
      current.lastShot = { digest: shot.media.digest, seq };
      current.shots += 1;
      record({ type: 'environment.computer.screenshot', session_id: current.id, seq, digest: shot.media.digest });
      return output;
    } catch (error) {
      return refuse('ENV_COMPUTER_ACTION_FAILED', error.message, { session_id: current.id, seq });
    } finally {
      current.busy = false;
    }
  }

  function screenshot(sessionId) {
    const found = openSession(sessionId);
    return found.error ? Promise.resolve(found.error) : perform(found.session, { action: 'screenshot', args: {} });
  }

  /** Execute one approved action. The approval is spent before anything reaches the display, even if the action then fails. */
  async function act(sessionId, actionInput, { approval_id: approvalId } = {}) {
    const found = openSession(sessionId);
    if (found.error) return found.error;
    const { session: current } = found;
    const parsed = parseAction(actionInput, current.display);
    if (!parsed.success) return refuse(parsed.error.hseos_code, parsed.error.issues[0].message);
    if (parsed.data.action === 'screenshot') return perform(current, parsed.data);
    if (typeof approvalId !== 'string') return refuse('ENV_COMPUTER_APPROVAL_REQUIRED', `${parsed.data.action} needs an approval`);
    if (!current.lastShot) return refuse('ENV_COMPUTER_SCREENSHOT_REQUIRED', 'take a screenshot before acting on the display');
    const spent = approvals.consume(approvalId, binding(current, parsed.data));
    if (spent.status !== 'consumed') return refuse(spent.code, 'the approval does not cover this action', { session_id: current.id });
    return perform(current, parsed.data);
  }

  async function stop(sessionId) {
    if (!slot || slot.id !== sessionId || slot.phase !== 'open')
      return refuse('ENV_COMPUTER_SESSION_CLOSED', 'there is no such open session');
    const closed = await close(slot, 'stopped');
    return Object.freeze({
      contract: CONTRACT,
      status: closed.descendants_terminated ? 'stopped' : 'uncertain',
      session_id: sessionId,
      ...closed,
    });
  }

  return Object.freeze({
    start,
    screenshot,
    requestApproval,
    act,
    stop,
    state: () => Object.freeze({ active: slot !== null, uncertain }),
  });
}

module.exports = { createComputerService, createEventChannel, prepareComputerToolchain };
