'use strict';

/**
 * Scope tests for mcp-hseos-swarm: run_id containment (path traversal, absolute, symlink)
 * and project-relative runs directory (never the installed package).
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { execFileSync, spawn } = require('node:child_process');
const { MCP_LEGACY_PROTOCOL_VERSION } = require('../tools/lib/mcp-protocol');

const SERVER = path.join(__dirname, '..', 'tools', 'mcp-hseos-swarm', 'index.js');
const PACKAGE_RUNS = path.join(__dirname, '..', '.hseos', 'runs', 'dev-squad');

let pass = 0;
let fail = 0;

async function it(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (error) {
    console.log(`  ✗ ${name}\n    ${error.message}`);
    fail++;
  }
}

function waitForPort(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`timeout: ${output.slice(-500)}`)), 8000);
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-2000);
      const match = output.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolve(Number(match[1]));
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => reject(new Error(`server exited (${code}): ${output.slice(-500)}`)));
  });
}

// A child that already died (boot failure) never emits 'exit' again: waiting for it would hang the run and exit 0
// with no count line, so the exit is awaited only while the child is alive.
async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await exited;
}

function rpc(port, method, params = {}) {
  const normalized =
    method === 'initialize'
      ? { protocolVersion: MCP_LEGACY_PROTOCOL_VERSION, clientInfo: { name: 'swarm-scope-test', version: '1.0.0' }, ...params }
      : params;
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params: normalized });
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 4000,
      },
      (res) => {
        let chunks = '';
        res.setEncoding('utf8');
        res.on('data', (d) => (chunks += d));
        res.on('end', () => {
          try {
            const r = JSON.parse(chunks);
            if (r.error) return reject(Object.assign(new Error(`${method}: ${r.error.message}`), { rpcCode: r.error.code }));
            resolve(r.result);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function toolData(result) {
  const envelope = result.structuredContent || JSON.parse(result.content[0].text);
  if (!Object.hasOwn(envelope, 'ok')) return envelope;
  if (!envelope.ok) throw new Error(`${envelope.error.code}: ${envelope.error.message}`);
  return envelope.data.result;
}

const call = async (port, name, args) => toolData(await rpc(port, 'tools/call', { name, arguments: args }));

// The refusal must be the scope/tool refusal under test, never an unrelated one such as the legacy sunset
// (-32022, "Legacy MCP compatibility is unavailable"), which would let a denial test pass for the wrong reason.
const SCOPE_REFUSAL = /^tools\/call: (Invalid (run_id|source_task|target_task): |Symlink not allowed: |Not a regular, non-linked file: )/;
const LEGACY_SUNSET_RPC_CODE = -32_022;

async function expectRejected(port, name, args, expected = SCOPE_REFUSAL) {
  let data;
  try {
    data = await call(port, name, args);
  } catch (error) {
    if (error.rpcCode === LEGACY_SUNSET_RPC_CODE) throw new Error(`${name} was refused by the legacy sunset: ${error.message}`);
    if (!expected.test(error.message))
      throw new Error(`${name} refused ${JSON.stringify(args)} with an unexpected error: ${error.message}`);
    return;
  }
  throw new Error(`${name} accepted ${JSON.stringify(args)} and returned ${JSON.stringify(data).slice(0, 200)}`);
}

// ---------------------------------------------------------------------------
// W5-04: in-process run-scope hardening (cwd, nlink, O_NOFOLLOW) and ledger-recorded denials in governed mode.
// ---------------------------------------------------------------------------
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const runScope = require('../tools/mcp-hseos-swarm/lib/run-scope');

function scopeCode(fn) {
  try {
    fn();
  } catch (error) {
    return error.code;
  }
  return null;
}

async function runInProcessScopeTests() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-w5-04-scope-')));
  const originalCwd = process.cwd();
  try {
    const project = path.join(root, 'project');
    const outside = path.join(root, 'outside');
    const runs = path.join(project, '.hseos', 'runs', 'dev-squad');
    fs.mkdirSync(path.join(runs, 'r1'), { recursive: true });
    fs.mkdirSync(outside);
    process.chdir(project);

    await it('run-scope: the project root must be a real, non-root directory', async () => {
      assert.equal(runScope.projectRoot(), project);
      process.chdir('/');
      assert.equal(
        scopeCode(() => runScope.projectRoot()),
        runScope.SCOPE_DENIED,
      );
      assert.equal(
        scopeCode(() => runScope.resolveRunDir('r1')),
        runScope.SCOPE_DENIED,
      );
      process.chdir(project);
      const doomed = path.join(root, 'doomed');
      fs.mkdirSync(doomed);
      process.chdir(doomed);
      fs.rmdirSync(doomed);
      assert.equal(
        scopeCode(() => runScope.projectRoot()),
        runScope.SCOPE_DENIED,
      );
      process.chdir(project);
    });

    await it('run-scope: every refusal carries the stable scope-denied code', async () => {
      assert.equal(
        scopeCode(() => runScope.assertIdentifier('../x', 'run_id')),
        runScope.SCOPE_DENIED,
      );
      assert.equal(
        scopeCode(() => runScope.assertIdentifier(7, 'run_id')),
        runScope.SCOPE_DENIED,
      );
      assert.equal(runScope.assertIdentifier('ok-1', 'run_id'), 'ok-1');
      assert.equal(
        scopeCode(() => runScope.resolveRunDir('..')),
        runScope.SCOPE_DENIED,
      );
      fs.symlinkSync(outside, path.join(runs, 'escape'), 'dir');
      assert.equal(
        scopeCode(() => runScope.resolveRunDir('escape')),
        runScope.SCOPE_DENIED,
      );
      fs.symlinkSync(path.join(root, 'nowhere'), path.join(runs, 'dangling'));
      assert.equal(
        scopeCode(() => runScope.resolveRunDir('dangling')),
        runScope.SCOPE_DENIED,
      );
      assert.equal(runScope.resolveRunDir('r1'), path.join(runs, 'r1'));
    });

    await it('run-scope: a runs directory that resolves outside the project is refused', async () => {
      const hijacked = path.join(root, 'hijacked');
      fs.mkdirSync(path.join(outside, 'dev-squad', 'r9'), { recursive: true });
      fs.mkdirSync(hijacked);
      process.chdir(hijacked);
      fs.symlinkSync(outside, path.join(hijacked, '.hseos'));
      fs.mkdirSync(path.join(outside, 'runs', 'dev-squad', 'r9'), { recursive: true });
      assert.equal(
        scopeCode(() => runScope.resolveRunDir('r9')),
        runScope.SCOPE_DENIED,
      );
      process.chdir(project);
    });

    await it('run-scope: reads refuse hardlinks, symlinks and non-files, and return null when absent', async () => {
      const runDir = path.join(runs, 'r1');
      const plain = path.join(runDir, 'PLAN.md');
      fs.writeFileSync(plain, 'plan');
      assert.equal(runScope.readContained(runDir, plain), 'plan');
      assert.equal(runScope.readContained(runDir, path.join(runDir, 'ABSENT.md')), null);
      const secret = path.join(outside, 'secret.md');
      fs.writeFileSync(secret, 'TOP-SECRET');
      fs.linkSync(secret, path.join(runDir, 'HARD.md'));
      assert.equal(
        scopeCode(() => runScope.readContained(runDir, path.join(runDir, 'HARD.md'))),
        runScope.SCOPE_DENIED,
      );
      fs.symlinkSync(secret, path.join(runDir, 'SOFT.md'));
      assert.equal(
        scopeCode(() => runScope.readContained(runDir, path.join(runDir, 'SOFT.md'))),
        runScope.SCOPE_DENIED,
      );
      fs.mkdirSync(path.join(runDir, 'DIR.md'));
      assert.equal(
        scopeCode(() => runScope.readContained(runDir, path.join(runDir, 'DIR.md'))),
        runScope.SCOPE_DENIED,
      );
      assert.equal(
        scopeCode(() => runScope.assertFileInside(runDir, path.join(outside, 'secret.md'))),
        runScope.SCOPE_DENIED,
      );
    });

    await it('run-scope: writes never follow a symlink, never truncate through a hardlink, and replace content fully', async () => {
      const runDir = path.join(runs, 'r1');
      const target = path.join(runDir, 'OUT.md');
      runScope.writeContained(runDir, target, 'a much longer first content');
      runScope.writeContained(runDir, target, 'short');
      assert.equal(fs.readFileSync(target, 'utf8'), 'short');
      const victim = path.join(outside, 'victim.md');
      fs.writeFileSync(victim, 'VICTIM-CONTENT');
      fs.linkSync(victim, path.join(runDir, 'ALIAS.md'));
      assert.equal(
        scopeCode(() => runScope.writeContained(runDir, path.join(runDir, 'ALIAS.md'), 'overwrite')),
        runScope.SCOPE_DENIED,
      );
      assert.equal(fs.readFileSync(victim, 'utf8'), 'VICTIM-CONTENT', 'the aliased file must not be truncated or written');
      fs.symlinkSync(victim, path.join(runDir, 'LINK.md'));
      assert.equal(
        scopeCode(() => runScope.writeContained(runDir, path.join(runDir, 'LINK.md'), 'overwrite')),
        runScope.SCOPE_DENIED,
      );
      assert.equal(fs.readFileSync(victim, 'utf8'), 'VICTIM-CONTENT');
      assert.throws(() => runScope.writeContained(runDir, path.join(runDir, 'no-such-dir', 'X.md'), 'x'), { code: 'ENOENT' });
    });

    await it('run-scope: a symlink swapped in after the path check is not followed (O_NOFOLLOW), for reads and writes', async () => {
      const runDir = path.join(runs, 'r1');
      const secret = path.join(outside, 'race-secret.md');
      fs.writeFileSync(secret, 'RACE-SECRET');
      const swapToSymlink = (file) => {
        fs.rmSync(file, { force: true });
        fs.symlinkSync(secret, file);
      };
      const readTarget = path.join(runDir, 'RACE-READ.md');
      fs.writeFileSync(readTarget, 'harmless');
      runScope.hooks.afterCheck = swapToSymlink;
      try {
        assert.equal(
          scopeCode(() => runScope.readContained(runDir, readTarget)),
          runScope.SCOPE_DENIED,
        );
        const writeTarget = path.join(runDir, 'RACE-WRITE.md');
        assert.equal(
          scopeCode(() => runScope.writeContained(runDir, writeTarget, 'OVERWRITE')),
          runScope.SCOPE_DENIED,
        );
        assert.equal(fs.readFileSync(secret, 'utf8'), 'RACE-SECRET', 'the swapped target must not be written');
      } finally {
        runScope.hooks.afterCheck = null;
      }
    });

    await it('run-scope: a parent directory swapped for a symlink after the path check is detected from the opened descriptor', async () => {
      const raceRun = path.join(runs, 'r-race');
      fs.mkdirSync(raceRun);
      fs.writeFileSync(path.join(raceRun, 'PLAN.md'), 'inside');
      const stolen = path.join(outside, 'stolen-run');
      fs.mkdirSync(stolen);
      fs.writeFileSync(path.join(stolen, 'PLAN.md'), 'OUTSIDE-PARENT-SECRET');
      runScope.hooks.afterCheck = () => {
        fs.renameSync(raceRun, `${raceRun}.bak`);
        fs.symlinkSync(stolen, raceRun);
      };
      try {
        assert.equal(
          scopeCode(() => runScope.readContained(raceRun, path.join(raceRun, 'PLAN.md'))),
          runScope.SCOPE_DENIED,
        );
      } finally {
        runScope.hooks.afterCheck = null;
      }
      fs.rmSync(raceRun);
      fs.renameSync(`${raceRun}.bak`, raceRun);
      runScope.hooks.afterCheck = () => {
        if (fs.lstatSync(raceRun).isSymbolicLink()) return;
        fs.renameSync(raceRun, `${raceRun}.bak`);
        fs.symlinkSync(stolen, raceRun);
      };
      try {
        assert.equal(
          scopeCode(() => runScope.writeContained(raceRun, path.join(raceRun, 'PLAN.md'), 'X')),
          runScope.SCOPE_DENIED,
        );
        assert.equal(
          scopeCode(() => runScope.writeContained(raceRun, path.join(raceRun, 'NEW.md'), 'X')),
          runScope.SCOPE_DENIED,
        );
        assert.equal(fs.readFileSync(path.join(stolen, 'PLAN.md'), 'utf8'), 'OUTSIDE-PARENT-SECRET');
        assert.equal(fs.existsSync(path.join(stolen, 'NEW.md')), false, 'nothing may be created outside the base');
      } finally {
        runScope.hooks.afterCheck = null;
      }
    });

    await it('run-scope: the final component is opened with O_NOFOLLOW, so a symlink swapped in after the check is named as one and creates nothing', async () => {
      const runDir = path.join(runs, 'r1');
      const messageOf = (fn) => {
        try {
          fn();
        } catch (error) {
          return error.message;
        }
        return null;
      };
      const readSecret = path.join(outside, 'nofollow-read.md');
      fs.writeFileSync(readSecret, 'NOFOLLOW-SECRET');
      const readTarget = path.join(runDir, 'NOFOLLOW-READ.md');
      fs.writeFileSync(readTarget, 'harmless');
      // The target outside does not exist: opening through the link would create it.
      const dangling = path.join(outside, 'nofollow-created.md');
      const writeTarget = path.join(runDir, 'NOFOLLOW-WRITE.md');
      try {
        runScope.hooks.afterCheck = (file) => {
          fs.rmSync(file, { force: true });
          fs.symlinkSync(file === readTarget ? readSecret : dangling, file);
        };
        assert.match(
          messageOf(() => runScope.readContained(runDir, readTarget)),
          /^Symlink not allowed: NOFOLLOW-READ\.md/,
        );
        assert.match(
          messageOf(() => runScope.writeContained(runDir, writeTarget, 'X')),
          /^Symlink not allowed: NOFOLLOW-WRITE\.md/,
        );
        assert.equal(fs.existsSync(dangling), false, 'a write through a swapped link must not create anything outside the base');
      } finally {
        runScope.hooks.afterCheck = null;
      }
    });

    await it('run-scope: an ancestor swapped for a symlink after the path check is caught by the parent descriptor, before anything is created', async () => {
      const base2 = path.join(runs, 'r-anc');
      fs.mkdirSync(path.join(base2, 'sub'), { recursive: true });
      // The parent itself stays a real directory, so only the real location of its descriptor can reveal the swap.
      const stolen = path.join(outside, 'stolen-anc');
      fs.mkdirSync(path.join(stolen, 'sub'), { recursive: true });
      const file = path.join(base2, 'sub', 'NEW.md');
      let swapped = false;
      runScope.hooks.afterCheck = () => {
        if (swapped) return;
        swapped = true;
        fs.renameSync(base2, `${base2}.bak`);
        fs.symlinkSync(stolen, base2);
      };
      try {
        assert.equal(
          scopeCode(() => runScope.writeContained(base2, file, 'X')),
          runScope.SCOPE_DENIED,
        );
        assert.equal(fs.existsSync(path.join(stolen, 'sub', 'NEW.md')), false, 'nothing may be created outside the base');
      } finally {
        runScope.hooks.afterCheck = null;
      }
    });

    await it('run-scope: an ancestor swapped for a symlink during mkdir creates nothing outside the base and is a scope denial', async () => {
      // Deepest existing ancestor itself swapped: the O_NOFOLLOW open of the descriptor refuses it.
      const direct = path.join(runs, 'r-mk-direct');
      fs.mkdirSync(direct);
      const stolenDirect = path.join(outside, 'stolen-mk-direct');
      fs.mkdirSync(stolenDirect);
      // A higher ancestor swapped: the descriptor stays a real directory, only its real location reveals the swap.
      const higher = path.join(runs, 'r-mk-higher');
      fs.mkdirSync(path.join(higher, 'mid'), { recursive: true });
      const stolenHigher = path.join(outside, 'stolen-mk-higher');
      fs.mkdirSync(path.join(stolenHigher, 'mid'), { recursive: true });
      let swap = null;
      runScope.hooks.afterCheck = () => {
        const [target, loot] = swap;
        swap = null;
        fs.renameSync(target, `${target}.bak`);
        fs.symlinkSync(loot, target);
      };
      try {
        swap = [direct, stolenDirect];
        assert.equal(
          scopeCode(() => runScope.mkdirContained(runs, path.join(direct, 'a', 'b'))),
          runScope.SCOPE_DENIED,
        );
        assert.deepEqual(fs.readdirSync(stolenDirect), [], 'nothing may be created outside the base');
        swap = [higher, stolenHigher];
        assert.equal(
          scopeCode(() => runScope.mkdirContained(runs, path.join(higher, 'mid', 'a', 'b'))),
          runScope.SCOPE_DENIED,
        );
        assert.deepEqual(fs.readdirSync(path.join(stolenHigher, 'mid')), [], 'nothing may be created outside the base');
      } finally {
        runScope.hooks.afterCheck = null;
      }
      // Without a race the same call creates the missing components inside the base.
      const created = path.join(runs, 'r-mk-ok', 'x', 'y');
      runScope.mkdirContained(runs, created);
      runScope.mkdirContained(runs, created);
      assert.ok(fs.statSync(created).isDirectory());
    });

    await it('run-scope: a component swapped or moved out between two mkdir steps creates nothing outside the base', async () => {
      const arm = (fn) => {
        runScope.hooks.afterComponent = (component) => {
          if (path.basename(component) !== 'b') return;
          runScope.hooks.afterComponent = null;
          fn();
        };
      };
      try {
        // The directory held by the descriptor is moved out of the base: the next component must not be created in it.
        const moved = path.join(runs, 'r-mc-moved');
        fs.mkdirSync(moved);
        const exile = path.join(outside, 'exile-mc');
        fs.mkdirSync(exile);
        arm(() => fs.renameSync(path.join(moved, 'a'), path.join(exile, 'a')));
        assert.equal(
          scopeCode(() => runScope.mkdirContained(runs, path.join(moved, 'a', 'b', 'c'))),
          runScope.SCOPE_DENIED,
        );
        assert.deepEqual(fs.readdirSync(path.join(exile, 'a')), [], 'nothing may be created in the directory moved out of the base');
        // The path of the held directory is swapped for a link out: the next component is created through the descriptor.
        const linked = path.join(runs, 'r-mc-link');
        fs.mkdirSync(linked);
        const stolen = path.join(outside, 'stolen-mc');
        fs.mkdirSync(stolen);
        arm(() => {
          fs.renameSync(path.join(linked, 'a'), path.join(linked, 'a.bak'));
          fs.symlinkSync(stolen, path.join(linked, 'a'));
        });
        try {
          runScope.mkdirContained(runs, path.join(linked, 'a', 'b'));
        } catch (error) {
          assert.equal(error.code, runScope.SCOPE_DENIED);
        }
        assert.deepEqual(fs.readdirSync(stolen), [], 'a creation by path would have followed the link');
      } finally {
        runScope.hooks.afterComponent = null;
      }
    });

    await it('run-scope: an existing runs directory is the base, so swapping it for a link to another project directory is refused', async () => {
      const other = path.join(project, 'other-dir');
      fs.mkdirSync(path.join(other, 'r-n2'), { recursive: true });
      const runDir = path.join(runs, 'r-n2');
      fs.mkdirSync(runDir);
      assert.equal(runScope.runDirBase(), runs);
      // Swapped during the call: the descriptor of the existing run directory now lives under the other directory.
      runScope.hooks.afterCheck = () => {
        runScope.hooks.afterCheck = null;
        fs.renameSync(runs, `${runs}.bak`);
        fs.symlinkSync(other, runs);
      };
      try {
        assert.equal(
          scopeCode(() => runScope.mkdirContained(runScope.runDirBase(), path.join(runDir, 'x'))),
          runScope.SCOPE_DENIED,
        );
        assert.deepEqual(fs.readdirSync(path.join(other, 'r-n2')), [], 'nothing may be created in the other project directory');
        // Already swapped before the call: refused up front.
        assert.equal(
          scopeCode(() => runScope.runDirBase()),
          runScope.SCOPE_DENIED,
        );
      } finally {
        runScope.hooks.afterCheck = null;
        fs.rmSync(runs, { force: true });
        fs.renameSync(`${runs}.bak`, runs);
      }
    });

    await it('run-scope: a directory swapped for a symlink before the readdir is refused and the outside listing is not returned', async () => {
      const listed = path.join(runs, 'r-ls');
      fs.mkdirSync(listed);
      fs.writeFileSync(path.join(listed, 'INSIDE.md'), 'x');
      assert.deepEqual(runScope.readdirContained(runs, listed), ['INSIDE.md']);
      const stolen = path.join(outside, 'stolen-ls');
      fs.mkdirSync(stolen);
      fs.writeFileSync(path.join(stolen, 'OUTSIDE-SECRET.md'), 'x');
      runScope.hooks.afterCheck = () => {
        fs.renameSync(listed, `${listed}.bak`);
        fs.symlinkSync(stolen, listed);
      };
      let listing = null;
      try {
        assert.equal(
          scopeCode(() => {
            listing = runScope.readdirContained(runs, listed);
          }),
          runScope.SCOPE_DENIED,
        );
      } finally {
        runScope.hooks.afterCheck = null;
      }
      assert.equal(listing, null, 'the outside listing must not be returned');
      // A run directory that is already a symlink is refused up front as well.
      assert.equal(
        scopeCode(() => runScope.readdirContained(runs, listed)),
        runScope.SCOPE_DENIED,
      );
    });

    await it('run-scope: the file is opened relative to the validated parent descriptor, not by path, so a swap after the parent check lands nowhere', async () => {
      const racing = path.join(runs, 'r-fd');
      fs.mkdirSync(racing);
      const stolen = path.join(outside, 'stolen-fd');
      fs.mkdirSync(stolen);
      // Swap the parent directory for a symlink right after its real location was validated from the descriptor.
      const realRealpath = fs.realpathSync;
      let armed = true;
      fs.realpathSync = (...args) => {
        const result = realRealpath(...args);
        if (armed && typeof args[0] === 'string' && args[0].startsWith('/proc/self/fd/')) {
          armed = false;
          fs.renameSync(racing, `${racing}.bak`);
          fs.symlinkSync(stolen, racing);
        }
        return result;
      };
      try {
        runScope.writeContained(runs, path.join(racing, 'NEW.md'), 'X');
      } finally {
        fs.realpathSync = realRealpath;
      }
      assert.equal(armed, false, 'the swap ran between the parent check and the open');
      assert.equal(fs.existsSync(path.join(stolen, 'NEW.md')), false, 'the open followed the descriptor, not the swapped path');
      assert.equal(fs.readFileSync(path.join(`${racing}.bak`, 'NEW.md'), 'utf8'), 'X');
    });

    await it('run-scope: a FIFO in place of a file is rejected without blocking', async () => {
      const runDir = path.join(runs, 'r1');
      const fifo = path.join(runDir, 'PIPE.md');
      execFileSync('mkfifo', [fifo]);
      const started = Date.now();
      assert.equal(
        scopeCode(() => runScope.readContained(runDir, fifo)),
        runScope.SCOPE_DENIED,
      );
      assert.ok(Date.now() - started < 2000, 'the read must not wait for a writer');
      assert.equal(
        scopeCode(() => runScope.writeContained(runDir, fifo, 'x')),
        runScope.SCOPE_DENIED,
      );
    });

    await it('dispatch_wave: extracts the tasks of a wave, and reports missing plans, waves and indexes', async () => {
      const { handler } = require('../tools/mcp-hseos-swarm/tools/dispatch_wave.js')[0];
      const planDir = path.join(runs, 'plan-run');
      fs.mkdirSync(planDir);
      assert.match(handler(null, { run_id: 'plan-run' }).error, /PLAN\.md not found/);
      fs.writeFileSync(path.join(planDir, 'PLAN.md'), '# Plan\nnothing here\n');
      assert.equal(handler(null, { run_id: 'plan-run' }).note, 'no waves defined in PLAN.md');
      fs.writeFileSync(
        path.join(planDir, 'PLAN.md'),
        '# Plan\n## Wave 1: first\n- [ ] alpha task\n- [x] beta task\nnoise\n## Wave 2: second\n- [ ] gamma task\n',
      );
      const first = handler(null, { run_id: 'plan-run' });
      assert.deepEqual(first.tasks, ['alpha task', 'beta task']);
      assert.deepEqual(first.subagent_prompts, ['Task T1-1: alpha task', 'Task T1-2: beta task']);
      assert.deepEqual(first.worktree_paths, [path.join(project, '.worktrees', 'T1-1'), path.join(project, '.worktrees', 'T1-2')]);
      const second = handler(null, { run_id: 'plan-run', wave_index: 1 });
      assert.deepEqual(second.tasks, ['gamma task']);
      assert.equal(second.wave_index, 1);
      assert.match(handler(null, { run_id: 'plan-run', wave_index: 5 }).error, /Wave index 5 not found; plan has 2 wave\(s\)/);
      assert.equal(
        scopeCode(() => handler(null, { run_id: '../etc' })),
        runScope.SCOPE_DENIED,
      );
    });
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// Legacy compatibility ends at the sunset by the wall clock; the governed server starts inside the window,
// otherwise every legacy request is refused for the sunset and the denials under test never reach the ledger.
const LEGACY_WINDOW_CLOCK = path.join(__dirname, 'helpers', 'legacy-window-clock.cjs');

async function runGovernedDenialTests() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-w5-04-governed-')));
  const project = path.join(base, 'project');
  const database = path.join(base, 'state', 'project.db');
  fs.mkdirSync(path.join(project, '.hseos', 'runs', 'dev-squad'), { recursive: true });
  const child = spawn(process.execPath, ['-r', LEGACY_WINDOW_CLOCK, SERVER, '--port=0'], {
    cwd: project,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HSEOS_STATE_DB: database, NODE_ENV: 'test', HSEOS_GOVERNED_EXECUTION_FIXTURE: '1' },
  });
  try {
    const port = await waitForPort(child);
    await it('governed swarm: unknown tools and out-of-scope run ids are denied', async () => {
      await expectRejected(port, 'ghost_tool', {}, /^tools\/call: Unknown tool: ghost_tool$/);
      await expectRejected(port, 'get_run_state', { run_id: '../../etc' }, /^MCP_SCOPE_DENIED: /);
      await expectRejected(port, 'dispatch_wave', { run_id: '/etc' }, /^MCP_SCOPE_DENIED: /);
    });
  } finally {
    await stopChild(child);
  }
  await it('governed swarm: the denials are recorded in the ledger with stable codes', async () => {
    const db = new Database(database, { readonly: true });
    try {
      const rows = db
        .prepare(
          "SELECT event_type, payload_json, evidence_refs_json FROM execution_events WHERE aggregate_type = 'mcp_gateway' ORDER BY position",
        )
        .all();
      const codes = rows.map((row) => JSON.parse(row.payload_json).error.code);
      assert.ok(codes.includes('MCP_TOOL_UNKNOWN'), codes.join(','));
      assert.ok(codes.filter((code) => code === 'MCP_SCOPE_DENIED').length >= 2, codes.join(','));
      assert.ok(rows.every((row) => row.event_type === 'ExecutionFailed'));
      assert.ok(rows.some((row) => row.evidence_refs_json.includes('hseos://mcp/swarm/denied/ghost_tool')));
    } finally {
      db.close();
    }
  });
  fs.rmSync(base, { recursive: true, force: true });
}

(async () => {
  console.log('mcp-hseos-swarm scope test');

  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-swarm-scope-')));
  const project = path.join(base, 'project');
  const outside = path.join(base, 'outside');
  const runsDir = path.join(project, '.hseos', 'runs', 'dev-squad');
  fs.mkdirSync(runsDir, { recursive: true });
  fs.mkdirSync(path.join(outside, 'secret'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'STATUS.md'), 'TOP-SECRET-OUTSIDE\n');
  fs.writeFileSync(path.join(outside, 'WAVE-1.md'), 'TOP-SECRET-WAVE\n');
  fs.symlinkSync(outside, path.join(runsDir, 'linked'), 'dir');
  fs.mkdirSync(path.join(runsDir, 'project-run'));
  fs.writeFileSync(path.join(runsDir, 'project-run', 'STATUS.md'), '# STATUS\n\n**Phase:** EXECUTE\n');

  const child = spawn(process.execPath, [SERVER, '--port=0'], {
    cwd: project,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HSEOS_STATE_DB: path.join(base, 'project.db'), NODE_ENV: 'production' },
  });
  const created = [];

  try {
    const port = await waitForPort(child);
    const traversal = [
      '../../../../../outside',
      '../outside',
      '/etc',
      outside,
      'a/b',
      String.raw`a\b`,
      '..',
      '.',
      '',
      '.hidden',
      'linked',
      'x'.repeat(200),
    ];

    await it('get_run_state rejects traversal, absolute, nested and symlinked run_id', async () => {
      for (const run_id of traversal) await expectRejected(port, 'get_run_state', { run_id });
    });

    await it('plan_squad rejects traversal, absolute and symlinked run_id without writing', async () => {
      for (const run_id of ['../../../../outside/pwned', '../pwned', path.join(outside, 'pwned'), 'linked', 'linked/sub']) {
        await expectRejected(port, 'plan_squad', { batch_description: 'x', run_id });
      }
      for (const f of ['PLAN.md', 'pwned', path.join('pwned', 'PLAN.md')]) {
        if (fs.existsSync(path.join(outside, f)) || fs.existsSync(path.join(base, f))) throw new Error(`escaped write: ${f}`);
      }
      if (fs.existsSync(path.join(outside, 'PLAN.md')) || fs.existsSync(path.join(outside, 'STATUS.md.bak')))
        throw new Error('write via symlink');
      if (fs.readFileSync(path.join(outside, 'STATUS.md'), 'utf8') !== 'TOP-SECRET-OUTSIDE\n')
        throw new Error('outside STATUS.md modified');
    });

    await it('dispatch_wave and consolidate_handoff reject escaping identifiers', async () => {
      await expectRejected(port, 'dispatch_wave', { run_id: '../outside' });
      await expectRejected(port, 'dispatch_wave', { run_id: 'linked' });
      await expectRejected(port, 'consolidate_handoff', { run_id: '../outside', source_task: 't', target_task: 'u' });
      await expectRejected(port, 'consolidate_handoff', { run_id: 'project-run', source_task: '../../outside', target_task: 'u' });
      await expectRejected(port, 'consolidate_handoff', { run_id: 'project-run', source_task: 't', target_task: '../../escape' });
    });

    await it('list_runs sees project runs and hides symlinks leaving the runs dir', async () => {
      const result = await call(port, 'list_runs', {});
      const ids = result.runs.map((r) => r.id);
      if (!ids.includes('project-run')) throw new Error(`project run not listed: ${ids}`);
      if (ids.includes('linked')) throw new Error('symlinked run leaked into list');
    });

    await it('get_run_state reads a run living under the project, not the package', async () => {
      const result = await call(port, 'get_run_state', { run_id: 'project-run' });
      if (!result.status?.includes('EXECUTE')) throw new Error('project STATUS.md not read');
      if (!result.run_dir.startsWith(project)) throw new Error(`run_dir outside project: ${result.run_dir}`);
    });

    await it('plan_squad writes into the project and never into the package', async () => {
      const run_id = `scope-test-${process.pid}`;
      created.push(path.join(PACKAGE_RUNS, run_id));
      const result = await call(port, 'plan_squad', { batch_description: 'scope', run_id });
      if (!result.run_dir.startsWith(project)) throw new Error(`run_dir not in project: ${result.run_dir}`);
      if (!fs.existsSync(path.join(runsDir, run_id, 'PLAN.md'))) throw new Error('PLAN.md missing in project');
      if (fs.existsSync(path.join(PACKAGE_RUNS, run_id))) throw new Error('wrote into package runs dir');
      const generated = await call(port, 'plan_squad', { batch_description: 'auto id' });
      if (!generated.run_dir.startsWith(project)) throw new Error('auto-id run outside project');
    });

    await it('consolidate_handoff works for valid identifiers inside the project', async () => {
      fs.writeFileSync(path.join(runsDir, 'project-run', 'HANDOFF-t1.md'), 'hello\n');
      const result = await call(port, 'consolidate_handoff', { run_id: 'project-run', source_task: 't1', target_task: 't2' });
      if (!result.handoff_path.startsWith(runsDir)) throw new Error('handoff written outside runs dir');
    });

    const mkRun = (id) => {
      const dir = path.join(runsDir, id);
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    };

    await it('plan_squad refuses file symlinks (existing and dangling) on write', async () => {
      const dir = mkRun('sym-w');
      fs.writeFileSync(path.join(outside, 'orig-plan'), 'ORIG\n');
      fs.symlinkSync(path.join(outside, 'orig-plan'), path.join(dir, 'PLAN.md'));
      await expectRejected(port, 'plan_squad', { batch_description: 'x', run_id: 'sym-w' });
      if (fs.readFileSync(path.join(outside, 'orig-plan'), 'utf8') !== 'ORIG\n') throw new Error('PLAN.md symlink target overwritten');
      fs.rmSync(path.join(dir, 'PLAN.md'));
      fs.symlinkSync(path.join(outside, 'dangling-status'), path.join(dir, 'STATUS.md'));
      await expectRejected(port, 'plan_squad', { batch_description: 'x', run_id: 'sym-w' });
      if (fs.existsSync(path.join(outside, 'dangling-status'))) throw new Error('dangling STATUS.md symlink created its target');
    });

    await it('consolidate_handoff refuses file symlinks (existing and dangling) on write and read', async () => {
      const dir = mkRun('sym-h');
      fs.writeFileSync(path.join(dir, 'HANDOFF-s.md'), 'hello\n');
      fs.writeFileSync(path.join(outside, 'orig-out'), 'ORIG\n');
      const out = path.join(dir, 'handoff-s-to-u.md');
      fs.symlinkSync(path.join(outside, 'orig-out'), out);
      await expectRejected(port, 'consolidate_handoff', { run_id: 'sym-h', source_task: 's', target_task: 'u' });
      if (fs.readFileSync(path.join(outside, 'orig-out'), 'utf8') !== 'ORIG\n') throw new Error('handoff symlink target overwritten');
      fs.rmSync(out);
      fs.symlinkSync(path.join(outside, 'dangling-out'), out);
      await expectRejected(port, 'consolidate_handoff', { run_id: 'sym-h', source_task: 's', target_task: 'u' });
      if (fs.existsSync(path.join(outside, 'dangling-out'))) throw new Error('dangling handoff symlink created its target');
      fs.rmSync(out);
      fs.rmSync(path.join(dir, 'HANDOFF-s.md'));
      fs.symlinkSync(path.join(outside, 'STATUS.md'), path.join(dir, 'HANDOFF-s.md'));
      await expectRejected(port, 'consolidate_handoff', { run_id: 'sym-h', source_task: 's', target_task: 'u' });
    });

    await it('reads refuse file symlinks (existing and dangling)', async () => {
      const dir = mkRun('sym-r');
      for (const target of [path.join(outside, 'STATUS.md'), path.join(outside, 'missing')]) {
        for (const name of ['PLAN.md', 'STATUS.md', 'WAVE-1.md']) {
          fs.rmSync(path.join(dir, name), { force: true });
        }
        fs.writeFileSync(path.join(outside, 'phase'), '**Phase:** LEAKED\n');
        fs.symlinkSync(target, path.join(dir, 'PLAN.md'));
        fs.symlinkSync(target, path.join(dir, 'STATUS.md'));
        await expectRejected(port, 'dispatch_wave', { run_id: 'sym-r' });
        await expectRejected(port, 'get_run_state', { run_id: 'sym-r' });
        fs.rmSync(path.join(dir, 'STATUS.md'));
        fs.writeFileSync(path.join(dir, 'STATUS.md'), '**Phase:** OK\n');
        fs.symlinkSync(target, path.join(dir, 'WAVE-1.md'));
        await expectRejected(port, 'get_run_state', { run_id: 'sym-r' });
      }
      fs.rmSync(path.join(dir, 'STATUS.md'));
      fs.symlinkSync(path.join(outside, 'phase'), path.join(dir, 'STATUS.md'));
      const listed = (await call(port, 'list_runs', {})).runs.find((r) => r.id === 'sym-r');
      if (listed && listed.status_snippet.includes('LEAKED')) throw new Error('list_runs leaked symlinked STATUS.md');
    });

    await it('plan_squad refuses a FIFO standing in for PLAN.md and the refusal is a recorded denial', async () => {
      fs.mkdirSync(path.join(runsDir, 'fifo-run'));
      execFileSync('mkfifo', [path.join(runsDir, 'fifo-run', 'PLAN.md')]);
      await expectRejected(port, 'plan_squad', { batch_description: 'x', run_id: 'fifo-run' });
    });

    await it('plan_squad treats empty or missing run_id as auto-generated', async () => {
      for (const args of [{ batch_description: 'x' }, { batch_description: 'x', run_id: '' }]) {
        const result = await call(port, 'plan_squad', args);
        if (!result.run_id.endsWith('-squad')) throw new Error(`unexpected id ${result.run_id}`);
      }
    });
  } finally {
    await stopChild(child);
    await it('legacy swarm: out-of-scope refusals are durable in the telemetry store', async () => {
      const store = new (require('better-sqlite3'))(path.join(base, 'mcp-legacy-usage.db'), { readonly: true });
      try {
        const rows = store.prepare("SELECT tool, code, rpc_code FROM mcp_gateway_denials WHERE code = 'MCP_SCOPE_DENIED'").all();
        assert.ok(
          rows.some((row) => row.tool === 'plan_squad'),
          JSON.stringify(rows),
        );
        assert.ok(
          rows.some((row) => row.tool === 'get_run_state'),
          JSON.stringify(rows),
        );
        assert.ok(rows.every((row) => row.rpc_code === -32_000));
      } finally {
        store.close();
      }
    });
    for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(base, { recursive: true, force: true });
  }

  await runInProcessScopeTests();
  await runGovernedDenialTests();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((error) => {
  console.error('[test-mcp-hseos-swarm-scope] fatal:', error.message);
  process.exit(1);
});
