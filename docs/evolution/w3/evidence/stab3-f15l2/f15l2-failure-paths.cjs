'use strict';
// Failure-path rehearsal of the F15 L2 script. The cases that need a real code path run the script in real mode with F15L2_TEST_MODE=1 against
// a local HTTP server on 127.0.0.1 (the guard then refuses api.openai.com); the signal cases use the fake model. No test reaches the
// internet and nothing is spent.
// usage: node f15l2-failure-paths.cjs <repo-root> <out.json>      (exit 0 only when every case behaved as expected)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const HERE = __dirname;
const lib = require('./f15l2-lib.cjs');
const { startServer } = require('./f15l2-test-server.cjs');

const TMP = process.env.TMPDIR || os.tmpdir();
const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);

function run(script, args, { env = {}, root } = {}) {
  const result = spawnSync(process.execPath, [script, root, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Starts the script, waits for `until()`, sends the signal, resolves with the exit code and what is left behind. */
/** Containers named f15l2-* that are still around. Real Podman by default; the CI test injects a stub because Podman cannot run there. */
const realListContainers = () =>
  spawnSync('podman', ['ps', '-a', '--format', '{{.Names}}'], { encoding: 'utf8' })
    .stdout.split('\n')
    .filter((name) => name.startsWith('f15l2-'));

function signalCase({ script, root, work, signal, until, tmp, listContainers }) {
  return new Promise((resolve) => {
    const out = path.join(work, 'out');
    fs.mkdirSync(out, { recursive: true });
    fs.mkdirSync(tmp, { recursive: true });
    const child = spawn(process.execPath, [script, root, 'fixture', out, '--runs', '1'], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR, TMPDIR: tmp },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let sent = false;
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr = `${stderr}${chunk}`.slice(-300)));
    const poll = setInterval(() => {
      if (!sent && until(out)) {
        sent = true;
        child.kill(signal);
      }
    }, 40);
    const guard = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.on('close', (code, closeSignal) => {
      clearInterval(poll);
      clearTimeout(guard);
      const containers = listContainers();
      resolve({ code, closeSignal, sent, stderr_tail: stderr, left_in_tmpdir: fs.readdirSync(tmp), containers_left: containers });
    });
  });
}

/** Async run (the local test server lives in this process and has to answer while the script runs). */
function runAsync(script, args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: { PATH: process.env.PATH, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.resume();
    const guard = setTimeout(() => child.kill('SIGKILL'), 150_000);
    child.on('close', (status) => {
      clearTimeout(guard);
      resolve({ status, stdout });
    });
  });
}

async function runCases({ root, work, only = null, scriptDir = HERE, listContainers = realListContainers }) {
  const SCRIPT = path.join(scriptDir, 'f15l2.cjs');
  const want = (key) => !only || only.includes(key);
  fs.mkdirSync(work, { recursive: true });
  const cases = [];
  const add = (name, ok, details) => cases.push({ case: name, ok, details });
  const confirmation = JSON.parse(run(SCRIPT, ['--fingerprint', root], { root: '' }).stdout || '{}').campaign_sha256;
  const baseEnv = { HOME: process.env.HOME, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR, TMPDIR: TMP };
  // Real code path (key, confirmation, price, real fetch), but TEST MODE: the only reachable destination is the local server.
  const testReal = async (name, behavior, extra, { price = ['--price-in', '2.5', '--price-out', '10'] } = {}) => {
    const server = await startServer(behavior);
    try {
      const out = path.join(work, name);
      const result = await runAsync(SCRIPT, [root, 'real', out, '--runs', '1', ...price, '--base-url', server.url, ...extra], {
        ...baseEnv,
        F15L2_TEST_MODE: '1',
        F15L2_API_KEY: 'fake-not-a-secret',
        F15L2_REAL_CONFIRMED: confirmation,
      });
      return {
        ...result,
        out,
        received: server.received(),
        summary: readJson(path.join(out, 'summary.json')),
        stop: readJson(path.join(out, 'STOP.json')),
        spend: readJson(path.join(out, 'spend.json')),
      };
    } finally {
      await server.close();
    }
  };

  if (want('price')) {
    // 1. price absent, zero, negative, NaN, incomplete, different from the plan: abort before the first call, nothing reaches the server.
    const prices = [
      [],
      ['--price-in', '0', '--price-out', '10'],
      ['--price-in', '2.5', '--price-out', '-1'],
      ['--price-in', 'abc', '--price-out', '10'],
      ['--price-in', '2.5'],
      ['--price-in', '3', '--price-out', '10'],
    ];
    const results = [];
    for (const [index, flags] of prices.entries()) {
      const result = await testReal(`price-${index}`, 'sse', [], { price: flags });
      results.push({
        flags: flags.join(' ') || '(none)',
        exit: result.status,
        why: /"why":"([^":]+)/.exec(result.stdout)?.[1] ?? null,
        ran_nothing: !fs.existsSync(path.join(result.out, 'runs')),
        server_requests: result.received,
      });
    }
    add(
      'price-invalid-or-absent-aborts-before-the-first-call',
      results.every(
        (item, index) =>
          item.exit === 3 &&
          item.ran_nothing &&
          item.server_requests === 0 &&
          item.why === (index < 5 ? 'price-invalid' : 'price-differs-from-the-plan'),
      ),
      results,
    );
  }
  if (want('non-sse')) {
    // 2. response that is not SSE: the campaign stops at the first one
    const result = await testReal('non-sse', 'non-sse', []);
    add(
      'non-sse-response-stops-the-campaign',
      result.status === 4 &&
        result.summary?.stopped_because === 'response-not-sse' &&
        result.stop?.reason === 'response-not-sse' &&
        result.received === 1,
      { exit: result.status, stopped_because: result.summary?.stopped_because, server_requests: result.received, spend: result.spend },
    );
  }
  if (want('no-usage')) {
    // 3. SSE without readable usage
    const result = await testReal('no-usage', 'no-usage', []);
    add(
      'unreadable-usage-stops-the-campaign',
      result.status === 4 && result.summary?.stopped_because === 'usage-unreadable' && result.received === 1,
      { exit: result.status, stopped_because: result.summary?.stopped_because, server_requests: result.received, spend: result.spend },
    );
  }
  if (want('timeout')) {
    // 4. CLI timeout: the first call is the REFERENCE run, so the pessimistic cost uses the reference window (40.000), not 20.000
    const result = await testReal('timeout', 'hang', ['--cli-timeout-ms', '4000']);
    const referenceWindow = lib.pessimisticUsd({ windowTokens: 40_000, maxTokens: 4096, price: { in: 2.5, out: 10 } });
    add(
      'cli-timeout-stops-the-campaign-and-books-the-pessimistic-cost-of-the-window-in-use',
      result.status === 4 && result.summary?.stopped_because === 'cli-timeout' && result.spend?.spent_usd >= referenceWindow,
      {
        exit: result.status,
        stopped_because: result.summary?.stopped_because,
        spent_usd: result.spend?.spent_usd,
        reference_window_pessimistic_usd: referenceWindow,
      },
    );
  }
  if (want('per-request')) {
    // 5. per-request cap: the worst case of the first request already passes the limit, so nothing is sent (the server sees 0 requests)
    const result = await testReal('per-request-cap', 'sse', ['--cap-usd', '0.001']);
    add(
      'per-request-cap-refuses-before-sending',
      result.status === 4 && result.summary?.stopped_because === 'budget-pre-call' && result.received === 0,
      {
        exit: result.status,
        stopped_because: result.summary?.stopped_because,
        server_requests: result.received,
      },
    );
    const verdict = result.summary?.series?.t2800?.verdict;
    add(
      'a-stop-before-5-runs-without-decisive-failures-is-INCOMPLETE',
      verdict === 'INCOMPLETE' && result.summary?.overall_verdict === 'INCOMPLETE',
      { verdict },
    );
  }
  if (want('test-mode')) {
    // 6. test mode cannot reach api.openai.com, and outside the test mode the test variable is ignored (the guard refuses 127.0.0.1)
    const server = await startServer('sse');
    try {
      const probe = (extraEnv, url) => {
        const dir = fs.mkdtempSync(path.join(TMP, 'f15l2-tm-'));
        try {
          const script = `fetch(${JSON.stringify(url)}, { method: 'POST', body: JSON.stringify({ messages: [] }) }).then(() => { console.log('ALLOWED'); }, (error) => { console.log(error.code); });`;
          const result = spawnSync(process.execPath, ['--require', path.join(scriptDir, 'f15l2-guard.cjs'), '-e', script], {
            encoding: 'utf8',
            env: {
              PATH: process.env.PATH,
              F15L2_MODE: 'real',
              F15L2_DIR: dir,
              F15L2_PLAN_SHA256: 'a'.repeat(64),
              // A WRONG confirmation on purpose: even a regressed guard could not send anything, and the refusal reason tells the two apart.
              F15L2_REAL_CONFIRMED: 'b'.repeat(64),
              ...extraEnv,
            },
          });
          const refusals = fs.existsSync(path.join(dir, 'refusals.jsonl')) ? fs.readFileSync(path.join(dir, 'refusals.jsonl'), 'utf8') : '';
          return { out: result.stdout.trim(), counted: fs.existsSync(path.join(dir, 'request-count.txt')), refusals };
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      };
      const testEnv = { F15L2_TEST_MODE: '1', F15L2_TEST_BASE_URL: server.url };
      const toOpenai = probe(testEnv, 'https://api.openai.com/v1/chat/completions');
      const ignored = probe({ F15L2_TEST_BASE_URL: server.url }, server.url);
      add(
        'test-mode-cannot-reach-api-openai-com-and-is-ignored-outside-the-test-mode',
        toOpenai.out === 'F15L2_REAL_DESTINATION_REFUSED' &&
          /real-mode-allows-only-the-declared-origin/.test(toOpenai.refusals) &&
          !toOpenai.counted &&
          ignored.out === 'F15L2_REAL_DESTINATION_REFUSED' &&
          /real-mode-allows-only-the-declared-origin/.test(ignored.refusals) &&
          server.received() === 0,
        { to_openai_in_test_mode: toOpenai, local_url_without_test_mode: ignored, server_requests: server.received() },
      );
    } finally {
      await server.close();
    }
  }
  if (want('sigterm')) {
    // 6. signals: exit code, scratch, bundle, states and containers all removed
    const sigterm = await signalCase({
      script: SCRIPT,
      listContainers,
      root,
      work: path.join(work, 'sigterm'),
      signal: 'SIGTERM',
      tmp: path.join(work, 'st'),
      until: (out) => fs.existsSync(path.join(out, 'runs/t2800-1/reference/request-count.txt')),
    });
    add(
      'sigterm-removes-everything-and-exits-143',
      sigterm.code === 143 && sigterm.left_in_tmpdir.length === 0 && sigterm.containers_left.length === 0,
      sigterm,
    );
  }
  if (want('sigint')) {
    // A /proc scan is cheap enough to poll every 40 ms: the container lives for about a second.
    const podmanPhase = () =>
      fs.readdirSync('/proc').some((entry) => {
        if (!/^\d+$/.test(entry)) return false;
        try {
          return fs.readFileSync(`/proc/${entry}/cmdline`, 'utf8').includes('\0f15l2-t2800-1-');
        } catch (error) {
          if (error.code === 'ENOENT' || error.code === 'ESRCH' || error.code === 'EACCES') return false;
          throw error;
        }
      });
    const sigint = await signalCase({
      script: SCRIPT,
      listContainers,
      root,
      work: path.join(work, 'sigint'),
      signal: 'SIGINT',
      tmp: path.join(work, 'it'),
      until: () => podmanPhase(),
    });
    add(
      'sigint-during-the-podman-phase-removes-the-container-and-exits-130',
      sigint.code === 130 && sigint.left_in_tmpdir.length === 0 && sigint.containers_left.length === 0,
      sigint,
    );
  }
  return cases;
}

if (require.main === module) {
  const [root, outFile] = process.argv.slice(2);
  if (!root || !outFile) throw new Error('usage: node f15l2-failure-paths.cjs <repo-root> <out.json>');
  const work = fs.mkdtempSync(path.join(TMP, 'f15l2-failure-'));
  runCases({ root, work })
    .then((cases) => {
      fs.writeFileSync(outFile, `${JSON.stringify({ ok: cases.every((item) => item.ok), cases }, null, 2)}\n`);
      process.exitCode = cases.every((item) => item.ok) ? 0 : 1;
    })
    .catch((error) => {
      process.stderr.write(`${String(error.message).slice(0, 300)}\n`);
      process.exitCode = 1;
    })
    .finally(() => fs.rmSync(work, { recursive: true, force: true }));
}

module.exports = { runCases };
