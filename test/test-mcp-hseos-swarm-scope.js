'use strict';

/**
 * Scope tests for mcp-hseos-swarm: run_id containment (path traversal, absolute, symlink)
 * and project-relative runs directory (never the installed package).
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
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
            if (r.error) return reject(new Error(`${method}: ${r.error.message}`));
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

async function expectRejected(port, name, args) {
  let data;
  try {
    data = await call(port, name, args);
  } catch {
    return;
  }
  throw new Error(`${name} accepted ${JSON.stringify(args)} and returned ${JSON.stringify(data).slice(0, 200)}`);
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

    await it('plan_squad treats empty or missing run_id as auto-generated', async () => {
      for (const args of [{ batch_description: 'x' }, { batch_description: 'x', run_id: '' }]) {
        const result = await call(port, 'plan_squad', args);
        if (!result.run_id.endsWith('-squad')) throw new Error(`unexpected id ${result.run_id}`);
      }
    });
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 200));
    for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(base, { recursive: true, force: true });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((error) => {
  console.error('[test-mcp-hseos-swarm-scope] fatal:', error.message);
  process.exit(1);
});
