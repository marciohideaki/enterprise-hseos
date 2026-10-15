'use strict';

// Runs inside the P2 sandbox: one browser instance, one fresh context per call. The controller (browser.js) treats
// everything printed or written to /artifacts here as untrusted. playwright-core is loaded from the pinned toolchain
// only when a call actually runs, never at require time.
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { LIMITS } = require('./browser-contract');

const BROKER_SOCKET = '/run/broker.sock';
// Header the egress broker puts on its refusals (tools/cli/lib/environment-egress-broker.js).
const DENIED_HEADER = 'x-hseos-egress';
const EXECUTABLE = 'chrome-headless-shell/chrome-headless-shell-linux64/chrome-headless-shell';
const INLINE_LIMIT_BYTES = 48_000;
const MAX_RELAY_CONNECTIONS = 128;
const MIN_STEP_MS = 200;
const DEADLINE_MARGIN_MS = 300;

class BrowserHostError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'BrowserHostError';
    this.code = code;
  }
}

/** Loopback TCP port that forwards byte for byte to the broker's Unix socket (the browser's only way out). */
function startRelay(brokerSocket) {
  const server = net.createServer((client) => {
    const upstream = net.connect(brokerSocket);
    const close = () => {
      client.destroy();
      upstream.destroy();
    };
    client.once('error', close);
    upstream.once('error', close);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  server.maxConnections = MAX_RELAY_CONNECTIONS;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const clip = (text) => (text.length > LIMITS.max_dom_chars ? `${text.slice(0, LIMITS.max_dom_chars)}...[truncated]` : text);
const flagged = (text) => ({ text: clip(text), truncated: text.length > LIMITS.max_dom_chars, original_length: text.length });

/** A fresh context per call, with nothing carried in and nothing granted. */
function contextOptions(viewport) {
  return { viewport, acceptDownloads: false, serviceWorkers: 'block', permissions: [] };
}

function stepFailure(error) {
  if (error?.code === 'ENV_BROWSER_EGRESS_DENIED') return error.code;
  return error?.name === 'TimeoutError' || /Timeout \d+ms exceeded/u.test(String(error?.message))
    ? 'ENV_BROWSER_TIMEOUT'
    : 'ENV_BROWSER_STEP_FAILED';
}

async function runStep(page, step, context) {
  switch (step.op) {
    case 'goto': {
      const response = await page.goto(step.url, { waitUntil: 'load' });
      if (response?.headers()[DENIED_HEADER] === 'denied')
        throw new BrowserHostError('the egress broker refused the navigation', 'ENV_BROWSER_EGRESS_DENIED');
      return { status: response ? response.status() : null };
    }
    case 'click': {
      await page.locator(step.selector).first().click();
      return {};
    }
    case 'type': {
      await page.locator(step.selector).first().fill(step.text);
      return {};
    }
    case 'press': {
      await page.keyboard.press(step.key);
      return {};
    }
    case 'wait_for': {
      if (step.selector === undefined) await page.waitForLoadState(step.load_state);
      else await page.locator(step.selector).first().waitFor({ state: 'visible' });
      return {};
    }
    case 'screenshot': {
      const bytes = await page.screenshot({ type: 'png', animations: 'disabled' });
      const file = `shot-${context.captures.length}.png`;
      fs.writeFileSync(path.join(context.artifacts, file), bytes);
      context.files.push({
        path: `/artifacts/${file}`,
        media_type: 'image/png',
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
      context.captures.push({ kind: 'screenshot', file, url: page.url() });
      return {};
    }
    default: {
      const body = page.locator('body');
      context.captures.push({
        kind: 'dom',
        url: page.url(),
        title: await page.title(),
        // eslint-disable-next-line unicorn/prefer-dom-node-text-content -- Playwright locator method, not a DOM node.
        text: flagged(await body.innerText()),
        accessibility: flagged(await body.ariaSnapshot()),
      });
      return {};
    }
  }
}

async function runBrowser({
  steps,
  viewport,
  timeout_ms: timeoutMs,
  toolchain,
  flags,
  scratch = os.tmpdir(),
  broker_socket: brokerSocket = BROKER_SOCKET,
  artifacts,
}) {
  const startedAt = Date.now();
  const relay = await startRelay(brokerSocket);
  let browser;
  const deadline = setTimeout(() => browser?.close().catch(() => {}), timeoutMs);
  try {
    // The sandbox has no home directory or passwd entry: playwright-core reads HOME while it loads.
    process.env.HOME ||= scratch;
    process.env.TMPDIR ||= scratch;
    // Loaded only now, from the pinned toolchain; the package has no dependencies of its own.
    const { chromium } = require(path.join(toolchain, 'playwright-core/package'));
    try {
      browser = await chromium.launch({
        executablePath: path.join(toolchain, EXECUTABLE),
        args: [...flags, '--disable-gpu'],
        chromiumSandbox: true,
        proxy: { server: `http://127.0.0.1:${relay.address().port}` },
        env: { PATH: '/usr/bin:/bin', HOME: scratch, TMPDIR: scratch },
        timeout: timeoutMs,
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false,
      });
    } catch {
      throw new BrowserHostError('the browser could not be launched', 'ENV_BROWSER_UNAVAILABLE');
    }
    const session = await browser.newContext(contextOptions(viewport));
    const page = await session.newPage();
    const context = { artifacts, files: [], captures: [] };
    const results = [];
    for (const [index, step] of steps.entries()) {
      // The call's budget is shared: each step gets what is left, a little short of the hard deadline.
      page.setDefaultTimeout(Math.max(MIN_STEP_MS, timeoutMs - (Date.now() - startedAt) - DEADLINE_MARGIN_MS));
      try {
        results.push({ index, op: step.op, ok: true, ...(await runStep(page, step, context)), url: page.url() });
      } catch (error) {
        results.push({
          index,
          op: step.op,
          ok: false,
          error: stepFailure(error),
        });
        break;
      }
    }
    await session.close().catch(() => {});
    return { steps: results, captures: context.captures, files: context.files };
  } finally {
    clearTimeout(deadline);
    await browser?.close().catch(() => {});
    relay.close();
  }
}

/** Print the result; the structured part always goes through /artifacts so the stdout budget is never the limit. */
function emit(result, write, artifacts) {
  const { files, ...structured } = result;
  const bytes = Buffer.from(JSON.stringify(structured));
  if (!artifacts) {
    write(JSON.stringify(structured));
    return;
  }
  fs.writeFileSync(path.join(artifacts, 'result.json'), bytes);
  const manifest = [
    {
      path: '/artifacts/result.json',
      media_type: 'application/json',
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
    ...files,
  ];
  const text = JSON.stringify(manifest);
  if (text.length > INLINE_LIMIT_BYTES) throw new BrowserHostError('artifact manifest is too large', 'ENV_BROWSER_RESULT_TOO_LARGE');
  write(text);
}

async function main(argv, write, artifacts) {
  try {
    emit({ ok: true, ...(await runBrowser({ ...JSON.parse(argv[0]), artifacts })) }, write, artifacts);
    return 0;
  } catch (error) {
    write(JSON.stringify({ ok: false, code: error.code || 'ENV_BROWSER_HOST_FAILURE' }));
    return 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2), (line) => process.stdout.write(line), fs.existsSync('/artifacts') ? '/artifacts' : null).then((code) =>
    process.exit(code),
  );
}

module.exports = { BrowserHostError, contextOptions, emit, main, runBrowser, startRelay };
