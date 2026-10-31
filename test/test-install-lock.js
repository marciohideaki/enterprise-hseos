'use strict';

// Concurrent `hseos install` in the same directory (M-8).
//
// Policy: the second install is REFUSED (exit 75, EX_TEMPFAIL) while the first
// holds `<dir>/.hseos-install.lock`. A lock left by a dead process is taken over.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawn, spawnSync } = require('node:child_process');
const yaml = require('yaml');

const CLI = path.join(__dirname, '..', 'tools', 'cli', 'hseos-cli.js');
const { Installer } = require('../tools/cli/installers/lib/core/installer');

const LOCK_NAME = '.hseos-install.lock';

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-lock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function run(dir) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, 'install', '--yes', '--tools', 'none', '--directory', dir], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: '' },
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('close', (status) => resolve({ status, output }));
  });
}

function deadPid() {
  const result = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  return Number(result.stdout);
}

test('two simultaneous installs in the same directory: one installs, the other is refused with exit 75', async (t) => {
  const dir = scratch(t);
  const first = run(dir);
  const deadline = Date.now() + 60_000;
  while (!fs.existsSync(path.join(dir, LOCK_NAME))) {
    assert.ok(Date.now() < deadline, 'first install never took the lock');
    await new Promise((r) => setTimeout(r, 5));
  }
  const second = await run(dir);
  const firstResult = await first;

  assert.equal(second.status, 75, second.output);
  assert.match(second.output, /another hseos install is already running/i);
  assert.equal(firstResult.status, 0, firstResult.output);
  const manifest = yaml.parse(fs.readFileSync(path.join(dir, '.hseos', '_config', 'manifest.yaml'), 'utf8'));
  assert.ok(manifest.installation.version, 'manifest must be valid after the race');
  assert.ok(!fs.existsSync(path.join(dir, LOCK_NAME)), 'lock must be released after success');
});

test('a single install leaves no lock behind and a second sequential install works', async (t) => {
  const dir = scratch(t);
  assert.equal((await run(dir)).status, 0);
  assert.ok(!fs.existsSync(path.join(dir, LOCK_NAME)));
  assert.equal((await run(dir)).status, 0);
  assert.ok(!fs.existsSync(path.join(dir, LOCK_NAME)));
});

test('a lock left by a dead process is taken over', async (t) => {
  const dir = scratch(t);
  fs.writeFileSync(path.join(dir, LOCK_NAME), JSON.stringify({ pid: deadPid(), startedAt: new Date().toISOString() }));
  const result = await run(dir);
  assert.equal(result.status, 0, result.output);
  assert.ok(!fs.existsSync(path.join(dir, LOCK_NAME)));
});

test('a lock held by a live process refuses with code EHSEOS_INSTALL_LOCKED naming the pid', async (t) => {
  const dir = scratch(t);
  fs.writeFileSync(path.join(dir, LOCK_NAME), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  await assert.rejects(
    new Installer()._withInstallLock(dir, async () => 'never'),
    (error) => error.code === 'EHSEOS_INSTALL_LOCKED' && error.message.includes(String(process.pid)),
  );
  assert.ok(fs.existsSync(path.join(dir, LOCK_NAME)), 'a refused install must not remove the holder lock');
});

test('the lock is released when the guarded work throws', async (t) => {
  const dir = scratch(t);
  await assert.rejects(
    new Installer()._withInstallLock(dir, async () => {
      assert.ok(fs.existsSync(path.join(dir, LOCK_NAME)), 'lock held while working');
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.ok(!fs.existsSync(path.join(dir, LOCK_NAME)), 'lock must be released after an error');
});

test('the lock is re-entrant within one installer (quickUpdate delegating to install)', async (t) => {
  const dir = scratch(t);
  const installer = new Installer();
  const result = await installer._withInstallLock(dir, () => installer._withInstallLock(dir, async () => 'inner'));
  assert.equal(result, 'inner');
  assert.ok(!fs.existsSync(path.join(dir, LOCK_NAME)));
});

test('the lock is released when the process is terminated by a signal', async (t) => {
  const dir = scratch(t);
  const script = `
    const { Installer } = require(${JSON.stringify(path.join(__dirname, '..', 'tools', 'cli', 'installers', 'lib', 'core', 'installer'))});
    new Installer()._withInstallLock(${JSON.stringify(dir)}, () => { console.log('held'); return new Promise(() => setInterval(() => {}, 1000)); });
  `;
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve) => child.stdout.once('data', resolve));
  assert.ok(fs.existsSync(path.join(dir, LOCK_NAME)));
  const closed = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
  child.kill('SIGTERM');
  await closed;
  assert.ok(!fs.existsSync(path.join(dir, LOCK_NAME)), 'SIGTERM must release the lock');
});

for (const signal of ['SIGINT', 'SIGHUP']) {
  test(`the lock is released when the process is terminated by ${signal}`, async (t) => {
    const dir = scratch(t);
    const script = `
      const { Installer } = require(${JSON.stringify(path.join(__dirname, '..', 'tools', 'cli', 'installers', 'lib', 'core', 'installer'))});
      new Installer()._withInstallLock(${JSON.stringify(dir)}, () => { console.log('held'); return new Promise(() => setInterval(() => {}, 1000)); });
    `;
    const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise((resolve) => child.stdout.once('data', resolve));
    const closed = new Promise((resolve) => child.on('close', (code, sig) => resolve(sig)));
    child.kill(signal);
    assert.equal(await closed, signal, 'the signal still terminates the process after the lock is released');
    assert.ok(!fs.existsSync(path.join(dir, LOCK_NAME)), `${signal} must release the lock`);
  });
}

test('a refusal tells the user how to remove a lock held by a recycled pid', async (t) => {
  const dir = scratch(t);
  fs.writeFileSync(path.join(dir, LOCK_NAME), JSON.stringify({ pid: process.pid }));
  await assert.rejects(
    new Installer()._withInstallLock(dir, async () => 'never'),
    (error) => error.code === 'EHSEOS_INSTALL_LOCKED' && error.message.includes(path.join(dir, LOCK_NAME)) && /remove/.test(error.message),
  );
});

// Several processes race to take over the same dead holder's lock. The critical section is a file created with 'wx':
// if two processes are ever inside at once, the second create fails and the child reports a violation.
test('racing takeovers of a dead holder lock never put two processes in the critical section', async (t) => {
  const worker = `
    const fs = require('node:fs');
    const path = require('node:path');
    const { Installer } = require(${JSON.stringify(path.join(__dirname, '..', 'tools', 'cli', 'installers', 'lib', 'core', 'installer'))});
    const dir = process.argv[1];
    const inside = path.join(dir, 'inside.flag');
    new Installer()._withInstallLock(dir, async () => {
      fs.writeFileSync(inside, String(process.pid), { flag: 'wx' });
      await new Promise((r) => setTimeout(r, 40));
      fs.unlinkSync(inside);
      console.log('ran');
    }).catch((e) => console.log(e.code === 'EHSEOS_INSTALL_LOCKED' ? 'refused' : 'violation:' + e.message));
  `;
  for (let round = 0; round < 12; round += 1) {
    const dir = scratch(t);
    fs.writeFileSync(path.join(dir, LOCK_NAME), JSON.stringify({ pid: deadPid(), startedAt: new Date().toISOString() }));
    const outputs = await Promise.all(
      Array.from(
        { length: 4 },
        () =>
          new Promise((resolve) => {
            const child = spawn(process.execPath, ['-e', worker, dir], { stdio: ['ignore', 'pipe', 'inherit'] });
            let out = '';
            child.stdout.on('data', (d) => (out += d));
            child.on('close', () => resolve(out.trim()));
          }),
      ),
    );
    assert.ok(!outputs.some((o) => o.startsWith('violation')), `round ${round}: ${outputs.join(' | ')}`);
    assert.ok(outputs.includes('ran'), `round ${round}: someone must have taken the lock over: ${outputs.join(' | ')}`);
    assert.ok(
      !fs.existsSync(path.join(dir, LOCK_NAME)) && !fs.existsSync(`${path.join(dir, LOCK_NAME)}.takeover`),
      `round ${round}: nothing left behind`,
    );
  }
});

test('release leaves a lock that another install took over after a manual removal', async (t) => {
  const dir = scratch(t);
  const other = JSON.stringify({ pid: process.pid + 1, startedAt: new Date().toISOString() });
  await new Installer()._withInstallLock(dir, async () => {
    fs.writeFileSync(path.join(dir, LOCK_NAME), other); // removed by hand and re-created by someone else
  });
  assert.equal(fs.readFileSync(path.join(dir, LOCK_NAME), 'utf8'), other, 'a lock that is not ours must survive our release');
});

test('a filesystem without hard links still gets a lock (link() fails with EPERM)', async (t) => {
  const dir = scratch(t);
  const fsExtra = require('fs-extra');
  const realLink = fsExtra.link;
  fsExtra.link = async () => {
    throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
  };
  try {
    const held = await new Installer()._withInstallLock(
      dir,
      async () => JSON.parse(fs.readFileSync(path.join(dir, LOCK_NAME), 'utf8')).pid,
    );
    assert.equal(held, process.pid);
    assert.ok(!fs.existsSync(path.join(dir, LOCK_NAME)), 'released after the work');
  } finally {
    fsExtra.link = realLink;
  }
});

// What kills a mutant that skips the liveness check is the 'no takeover mutex write' assertion; the time bound is only a
// sanity limit with room for a slow CI host.
test('a live holder is refused without touching the takeover mutex', async (t) => {
  const dir = scratch(t);
  const lock = path.join(dir, LOCK_NAME);
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  const fsExtra = require('fs-extra');
  const realWrite = fsExtra.writeFile;
  const mutexWrites = [];
  fsExtra.writeFile = (file, ...rest) => {
    if (String(file).endsWith('.takeover')) mutexWrites.push(String(file));
    return realWrite.call(fsExtra, file, ...rest);
  };
  const started = Date.now();
  try {
    await assert.rejects(
      new Installer()._withInstallLock(dir, async () => 'never'),
      (error) => error.code === 'EHSEOS_INSTALL_LOCKED',
    );
  } finally {
    fsExtra.writeFile = realWrite;
  }
  assert.deepEqual(mutexWrites, [], 'a live holder must not start a takeover');
  assert.ok(Date.now() - started < 1000, `refusal took ${Date.now() - started} ms; the refusal should not wait out the retry loop`);
});

for (const [label, content] of [
  ['empty', ''],
  ['half-written', '{"pid": 12'],
]) {
  test(`a ${label} lock file counts as held for 2 s, then is taken over`, async (t) => {
    const dir = scratch(t);
    const lock = path.join(dir, LOCK_NAME);
    fs.writeFileSync(lock, content);
    await assert.rejects(
      new Installer()._withInstallLock(dir, async () => 'never'),
      (error) => error.code === 'EHSEOS_INSTALL_LOCKED',
    );
    assert.equal(fs.readFileSync(lock, 'utf8'), content, 'a recent unreadable lock must not be removed');
    const old = new Date(Date.now() - 10_000);
    fs.utimesSync(lock, old, old);
    const result = await new Installer()._withInstallLock(dir, async () => 'ran');
    assert.equal(result, 'ran');
    assert.ok(!fs.existsSync(lock));
  });
}

test('a stale takeover mutex left by a crashed taker is cleared and leaves nothing behind', async (t) => {
  const dir = scratch(t);
  const lock = path.join(dir, LOCK_NAME);
  const mutex = `${lock}.takeover`;
  fs.writeFileSync(lock, JSON.stringify({ pid: deadPid() }));
  fs.writeFileSync(mutex, '1');
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(mutex, old, old);
  assert.equal(await new Installer()._withInstallLock(dir, async () => 'ran'), 'ran');
  assert.deepEqual(
    fs.readdirSync(dir).filter((name) => name.startsWith(LOCK_NAME)),
    [],
  );
});

test('a takeover mutex re-created by another taker while it is judged stale is not removed', async (t) => {
  const dir = scratch(t);
  const lock = path.join(dir, LOCK_NAME);
  const mutex = `${lock}.takeover`;
  fs.writeFileSync(lock, JSON.stringify({ pid: deadPid() }));
  fs.writeFileSync(mutex, 'stale');
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(mutex, old, old);
  const fsExtra = require('fs-extra');
  const realRename = fsExtra.rename;
  let swapped = false;
  fsExtra.rename = async (from, to) => {
    if (!swapped && from === mutex) {
      swapped = true;
      // Between the stale judgement and the removal, the stale holder is replaced by a live taker's fresh mutex.
      fs.unlinkSync(mutex);
      fs.writeFileSync(mutex, 'fresh-taker');
    }
    return realRename.call(fsExtra, from, to);
  };
  try {
    await assert.rejects(
      new Installer()._withInstallLock(dir, async () => 'must not run: the fresh taker owns the takeover'),
      (error) => error.code === 'EHSEOS_INSTALL_LOCKED',
    );
  } finally {
    fsExtra.rename = realRename;
  }
  assert.ok(swapped, 'the race must have been injected');
  // The moved fresh mutex is given back (link) and the taker yields: mutex restored, dead holder lock untouched.
  assert.equal(fs.readFileSync(mutex, 'utf8'), 'fresh-taker', 'the other taker mutex must survive');
  assert.ok(fs.existsSync(lock), 'a taker that yields must not remove the lock');
  assert.deepEqual(
    fs.readdirSync(dir).filter((name) => name.includes('.stale.')),
    [],
  );
});

function holdLock(dir) {
  fs.writeFileSync(path.join(dir, LOCK_NAME), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
}

function runUninstall(dir) {
  return spawnSync(process.execPath, [CLI, 'uninstall', '--yes', '--directory', dir], {
    encoding: 'utf8',
    env: { ...process.env, CI: '' },
  });
}

test('uninstall with a live holder is refused with exit 75 and removes nothing', async (t) => {
  const dir = scratch(t);
  assert.equal((await run(dir)).status, 0);
  holdLock(dir);
  const result = runUninstall(dir);
  assert.equal(result.status, 75, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /another hseos install is already running/i);
  assert.ok(fs.existsSync(path.join(dir, '.hseos')), 'a refused uninstall must not remove the runtime');
  assert.ok(fs.existsSync(path.join(dir, LOCK_NAME)), 'a refused uninstall must not remove the holder lock');
});

test('uninstall alone removes the runtime and leaves no lock behind', async (t) => {
  const dir = scratch(t);
  assert.equal((await run(dir)).status, 0);
  const result = runUninstall(dir);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(!fs.existsSync(path.join(dir, '.hseos')));
  assert.ok(!fs.existsSync(path.join(dir, LOCK_NAME)), 'lock must be released and removed');
  assert.deepEqual(
    fs.readdirSync(dir).filter((name) => name.startsWith(LOCK_NAME)),
    [],
  );
});

test('Installer.uninstall takes the lock', async (t) => {
  const dir = scratch(t);
  assert.equal((await run(dir)).status, 0);
  holdLock(dir);
  await assert.rejects(new Installer().uninstall(dir), (error) => error.code === 'EHSEOS_INSTALL_LOCKED');
  assert.ok(fs.existsSync(path.join(dir, '.hseos')));
});

// `hseos init` writes nothing itself: after the prompts it hands off to the install command, so the install lock is what
// guards it. These tests keep that true.
async function initWithStubs(dir, t) {
  const prompts = require('../tools/cli/lib/prompts');
  const init = require('../tools/cli/commands/init');
  const saved = {
    select: prompts.select,
    note: prompts.note,
    confirm: prompts.confirm,
    exit: process.exit,
    stdin: Object.getOwnPropertyDescriptor(process.stdin, 'isTTY'),
    stdout: Object.getOwnPropertyDescriptor(process.stdout, 'isTTY'),
    error: console.error,
  };
  t.after(() => {
    Object.assign(prompts, { select: saved.select, note: saved.note, confirm: saved.confirm });
    process.exit = saved.exit;
    console.error = saved.error;
    for (const [stream, key] of [
      [process.stdin, 'stdin'],
      [process.stdout, 'stdout'],
    ]) {
      if (saved[key]) Object.defineProperty(stream, 'isTTY', saved[key]);
      else delete stream.isTTY;
    }
  });
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  prompts.select = async (options) => (/HSEOS profile/.test(options.message) ? 'developer' : 'platform');
  prompts.note = async () => {};
  // The TTY flags only satisfy init's own interactive check; the install it hands off to must run non-interactively.
  prompts.confirm = async () => {
    for (const stream of [process.stdin, process.stdout]) Object.defineProperty(stream, 'isTTY', { value: false, configurable: true });
    return true;
  };
  const exits = [];
  process.exit = (code) => {
    exits.push(code);
    throw Object.assign(new Error(`exit ${code}`), { exitCode: code });
  };
  console.error = () => {};
  try {
    await init.action({ directory: dir });
  } catch (error) {
    if (error.exitCode === undefined) throw error;
  }
  return exits;
}

test('init with a live holder is refused with exit 75 before it installs', async (t) => {
  const dir = scratch(t);
  holdLock(dir);
  const install = require('../tools/cli/commands/install');
  const originalAction = install.action;
  let installed = false;
  install.action = async () => {
    installed = true;
  };
  t.after(() => (install.action = originalAction));
  const exits = await initWithStubs(dir, t);
  assert.equal(exits[0], 75, JSON.stringify(exits));
  assert.equal(installed, false, 'a refused init must not reach the install command');
  assert.ok(fs.existsSync(path.join(dir, LOCK_NAME)), 'a refused init must not remove the holder lock');
});

test('init that hands off to install does not block itself (re-entrancy) and leaves no lock', async (t) => {
  const dir = scratch(t);
  const install = require('../tools/cli/commands/install');
  const originalAction = install.action;
  const seen = {};
  install.action = async () => {
    seen.heldDuringInstall = JSON.parse(fs.readFileSync(path.join(dir, LOCK_NAME), 'utf8')).pid === process.pid;
    // what the installer does inside the install command: it must re-enter, not refuse
    seen.reentered = await new Installer()._withInstallLock(dir, async () => 'inner');
  };
  t.after(() => (install.action = originalAction));
  const exits = await initWithStubs(dir, t);
  assert.deepEqual(exits, []);
  assert.equal(seen.heldDuringInstall, true);
  assert.equal(seen.reentered, 'inner');
  assert.ok(!fs.existsSync(path.join(dir, LOCK_NAME)), 'the lock must be released when init finishes');
});

test('two installers in one process racing for the same directory: one is accepted, the other refused', async (t) => {
  const dir = scratch(t);
  let release;
  let entered;
  const acquired = new Promise((resolve) => (entered = resolve));
  const gate = new Promise((resolve) => (release = resolve));
  const first = new Installer()._withInstallLock(dir, async () => {
    entered();
    await gate;
    return 'first';
  });
  // the second installer only races once the first demonstrably holds the lock
  await acquired;
  const second = await new Installer()
    ._withInstallLock(dir, async () => 'second')
    .then(
      (value) => ({ status: 'fulfilled', value }),
      (error) => ({ status: 'rejected', reason: error }),
    );
  release();
  assert.equal(second.status, 'rejected');
  assert.equal(second.reason.code, 'EHSEOS_INSTALL_LOCKED');
  assert.equal(await first, 'first');
  assert.ok(!fs.existsSync(path.join(dir, LOCK_NAME)));
  assert.equal(await new Installer()._withInstallLock(dir, async () => 'third'), 'third');
  assert.ok(!fs.existsSync(path.join(dir, LOCK_NAME)));
});

test('a process that calls process.exit() while holding the lock leaves no lock behind', async (t) => {
  const dir = scratch(t);
  const script = `
    const { Installer } = require(${JSON.stringify(path.join(__dirname, '..', 'tools', 'cli', 'installers', 'lib', 'core', 'installer'))});
    new Installer()._withInstallLock(${JSON.stringify(dir)}, async () => { process.exit(3); });
  `;
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 3, result.stderr);
  assert.ok(!fs.existsSync(path.join(dir, LOCK_NAME)), 'the exit listener must release the lock');
});
