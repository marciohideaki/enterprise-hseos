// Orphan detection for the suite supervisor (ci-test-shards.mjs).
//
// A test that leaves a descendant process alive after it finished is leaking it: the process outlives the test, keeps
// ports, files and memory, and used to be hidden because nothing looked. Every command the supervisor runs gets a
// unique token in its environment. Environment is inherited by every descendant, including double-forked and setsid
// ones that reparent to init, so a /proc scan for the token finds exactly the processes this command started and
// nothing else. Matching is by that token, never by process name.
//
// After the command ends, survivors are killed (only those PIDs) and the command FAILS, naming the command and each
// orphan's PID and command line. Intentional long-lived services are not tolerated by default: they must be listed,
// with a reason, in suite-orphan-allowlist.json (keyed by the exact segment command). The list ships empty; do not use
// it to hide a leak, fix the test.
//
// Limits: Linux only (/proc); a test that launches children with a scrubbed environment (`env: {}`, `env -i`) drops
// the token and escapes detection, unless it passes `orphanTokenEnv()` (agent-isolation-attestation/profiles.js), which
// carries this one variable and nothing else; a process owned by another user cannot be inspected.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOKEN_VAR = 'HSEOS_SUITE_ORPHAN_TOKEN';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SETTLE_MS = 1500;
const POLL_MS = 50;

export function loadAllowlist(file = path.join(HERE, 'suite-orphan-allowlist.json')) {
  const entries = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [command, reason] of Object.entries(entries)) {
    if (typeof reason !== 'string' || reason.trim() === '') throw new Error(`Allowlist entry needs a reason: ${command}`);
  }
  return entries;
}

function readFileSafe(file) {
  try {
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}

// Live (non-zombie) processes whose environment carries the token, excluding this process.
export function findTagged(token, procRoot = '/proc') {
  const entry = `${TOKEN_VAR}=${token}`;
  const found = [];
  for (const name of fs.readdirSync(procRoot)) {
    if (!/^\d+$/.test(name) || Number(name) === process.pid) continue;
    const environ = readFileSafe(path.join(procRoot, name, 'environ'));
    if (!environ || !environ.toString().split('\0').includes(entry)) continue;
    const stat = readFileSafe(path.join(procRoot, name, 'stat'));
    const state = stat ? stat.toString().slice(stat.toString().lastIndexOf(')') + 2, stat.toString().lastIndexOf(')') + 3) : '?';
    if (state === 'Z' || state === 'X') continue;
    const cmdline = (readFileSafe(path.join(procRoot, name, 'cmdline')) ?? Buffer.alloc(0)).toString().split('\0').join(' ').trim();
    found.push({ pid: Number(name), command: cmdline || '(unknown)' });
  }
  return found;
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Waits for slow-but-normal exits, then reports whoever is still alive.
export function settleOrphans(token, { settleMs = SETTLE_MS, procRoot } = {}) {
  const deadline = Date.now() + settleMs;
  let alive = findTagged(token, procRoot);
  while (alive.length > 0 && Date.now() < deadline) {
    sleepMs(POLL_MS);
    alive = findTagged(token, procRoot);
  }
  return alive;
}

// This process and everything above it (the shell, the runner, the user's session) must never be signalled, whatever
// a scan returned: a wrong match here would take the whole session down.
function protectedPids() {
  const protectedSet = new Set([0, 1, process.pid]);
  let pid = process.ppid;
  for (let depth = 0; pid > 1 && depth < 64 && !protectedSet.has(pid); depth += 1) {
    protectedSet.add(pid);
    const stat = readFileSafe(`/proc/${pid}/stat`)?.toString();
    if (!stat) break;
    pid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
  }
  return protectedSet;
}

export function reapOrphans(orphans) {
  const protectedSet = protectedPids();
  for (const { pid } of orphans) {
    if (!Number.isInteger(pid) || pid <= 1 || protectedSet.has(pid)) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}

// Runs one shell command under the supervisor. Returns { status, orphans, allowed }: orphans were killed, and a
// command that exited 0 but leaked is reported with orphans.length > 0 so the caller fails it.
export function runGuarded(command, { cwd, allowlist = {}, settleMs, procRoot, pathPrepend } = {}) {
  const token = crypto.randomBytes(12).toString('hex');
  const child = spawnSync('bash', ['-c', command], {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...(pathPrepend ? { PATH: `${pathPrepend}${path.delimiter}${process.env.PATH}` } : {}),
      [TOKEN_VAR]: token,
    },
  });
  const survivors = settleOrphans(token, { settleMs, procRoot });
  reapOrphans(survivors);
  const allowed = Object.hasOwn(allowlist, command);
  return { status: child.status, orphans: allowed ? [] : survivors, allowed: allowed ? survivors : [] };
}

export function describeOrphans(command, orphans) {
  return [
    `ORPHAN PROCESSES left alive by: ${command}`,
    ...orphans.map(({ pid, command: cmd }) => `  pid ${pid}: ${cmd}`),
    '  they were killed by the supervisor and the command is reported as FAILED',
  ].join('\n');
}

// A step like `npm run test:x` expands to the chain in package.json. Splitting that chain on ` && ` lets a leak be
// pinned to the file that caused it. Only plain `&&` chains are split; anything with other shell syntax stays whole.
export function segmentsOf(item, scripts) {
  const match = /^npm run ([\w:.-]+)$/.exec(item);
  const name = match?.[1];
  const body = name ? scripts[name] : undefined;
  if (!body || /[|;()<>`$'"\\]|\|\||(?<!&)&(?!&)/.test(body)) return [item];
  // npm runs pre<name>/post<name> around the script; splitting would drop them.
  if (scripts[`pre${name}`] !== undefined || scripts[`post${name}`] !== undefined) return [item];
  const parts = body.split(' && ').map((part) => part.trim());
  // Chained `cd`, `export` or VAR=value prefixes carry state to later parts; keep those whole.
  if (parts.some((part) => part === '' || part.startsWith('npm run ') || /^(cd|export|set|source|\.)\b/.test(part) || /^\w+=/.test(part))) {
    return [item];
  }
  return parts;
}

// The runner does not capture the c8 output, so it cannot tell a chain stopped by a failing segment from a coverage
// threshold failure on a complete chain. The note is therefore conditional on the chain having stopped.
export const KERNEL_COVERAGE_NOTE =
  'note: if the chain stopped at a failing segment, the coverage of files exercised only by segments that did not run appears as 0% and does not indicate missing tests; a threshold failure with a complete chain is not explained by this note';

// Says which segments of a failed item ran, which one failed and which never started (`&&` stops at the first failure).
// Message only: it does not change any exit status or threshold. `test:kernel-coverage` runs the whole kernel chain
// inside one c8 process, so its mass 0% reads like a coverage defect when it is really the segments after the failure.
export function describeSegments(item, segments, failedIndex, scripts = {}) {
  const lines = [`SEGMENTS of ${item}:`];
  for (const [index, segment] of segments.entries()) {
    const label = index < failedIndex ? 'ran    ' : index === failedIndex ? 'FAILED ' : 'not run';
    lines.push(`  ${label} ${segment}`);
  }
  const wrapped = /\bnpm run ([\w:.-]+)$/.exec(segments[failedIndex] ?? '')?.[1];
  const inner = wrapped && segments.length === 1 && scripts[wrapped] ? scripts[wrapped].split(' && ').map((part) => part.trim()) : [];
  if (inner.length > 1) {
    lines.push(`  inside it, \`npm run ${wrapped}\` runs these in order and stops at the first failing one (named in the log above):`);
    for (const segment of inner) lines.push(`    ${segment}`);
  }
  if (item === 'npm run test:kernel-coverage') lines.push(`  ${KERNEL_COVERAGE_NOTE}`);
  return lines;
}
