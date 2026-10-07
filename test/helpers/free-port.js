/**
 * Collision-free port allocation for tests that spawn the state-ui server.
 *
 * The server rejects port 0 and does not report its bound port, so the port is
 * acquired from the OS with a temporary listener and released before the spawn.
 * Another process can still take it in between, so spawnOnFreePort retries on a
 * fresh port when the child exits before it answers /health.
 */

const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function healthInstanceId(port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 1000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve(res.statusCode === 200 ? JSON.parse(body).instance_id : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('health timeout')));
  });
}

function isRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve) => {
    if (!isRunning(child)) return resolve(true);
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

// SIGTERM, then SIGKILL if the child has not actually exited.
async function stopChild(child, graceMs = 2000) {
  if (!isRunning(child)) return;
  child.kill('SIGTERM');
  if (await waitForExit(child, graceMs)) return;
  child.kill('SIGKILL');
  await waitForExit(child, graceMs);
}

// Resolves { port, child } once the child serves /health with `instanceId`.
// Early child exit => retry on a new port; spawn 'error' (e.g. ENOENT) => fail fast.
async function spawnOnFreePort(buildArgs, spawnOptions, instanceId, { attempts = 5, timeoutMs = 5000 } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    const port = await freePort();
    const child = spawn(process.execPath, buildArgs(port), spawnOptions);

    let fatal = null;
    let exited = false;
    let wake;
    const wakeUp = new Promise((resolve) => (wake = resolve));
    child.once('error', (error) => {
      fatal = error;
      wake();
    });
    child.once('exit', () => {
      exited = true;
      wake();
    });

    const healthy = (async () => {
      const deadline = Date.now() + timeoutMs;
      while (!exited && !fatal && Date.now() < deadline) {
        try {
          if ((await healthInstanceId(port)) === instanceId) return true;
        } catch {
          /* not listening yet */
        }
        await Promise.race([wakeUp, new Promise((resolve) => setTimeout(resolve, 100))]);
      }
      return false;
    })();

    if (await healthy) return { port, child };
    if (fatal) throw fatal;
    lastError = new Error(
      exited ? `server exited before becoming healthy (port ${port})` : `server not healthy within ${timeoutMs}ms (port ${port})`,
    );
    await stopChild(child);
  }
  throw lastError;
}

module.exports = { freePort, spawnOnFreePort, stopChild };
