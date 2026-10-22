// K7: entradas hostis de um cliente stdio contra o servidor MODERNO (banco ativado) e contra o legado (banco v4).
// uso: node hostile-inputs.mjs <worktree> <scratch> <saida.json>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const [repo, scratch, out] = process.argv.slice(2).map((p) => path.resolve(p));
const require = createRequire(path.join(repo, 'package.json'));
const lib = require('./tools/mcp-project-state/lib/operational-state-db.js');
fs.rmSync(scratch, { recursive: true, force: true });
fs.mkdirSync(path.join(scratch, 'adr'), { recursive: true });
fs.writeFileSync(path.join(scratch, 'adr', 'ADR-0048-fixture.md'), '# ADR-0048 (fixture)\n\n## Status\n\nAccepted - 2026-10-22\n');
const dbs = { modern: path.join(scratch, 'm', 'project.db'), legacy: path.join(scratch, 'l', 'project.db') };
for (const db of Object.values(dbs)) fs.mkdirSync(path.dirname(db), { recursive: true });
lib.openOperationalStateDatabase(dbs.modern).close();
lib.openOperationalStateDatabase(dbs.legacy).close();
await lib.activateExecutionLedger(dbs.modern, {
  adr: 'ADR-0048',
  backupDir: path.join(scratch, 'bk'),
  internal: { decisionsDirectory: path.join(scratch, 'adr') },
});

const modernMeta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'hostile', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': {},
};
const list = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: modernMeta } });
const inputs = {
  null: 'null',
  number: '1',
  string: '"x"',
  array_empty: '[]',
  boolean: 'true',
  object_empty: '{}',
  object_no_jsonrpc: '{"id":1,"method":"tools/list"}',
  batch_with_null: '[null]',
  batch_valid_and_null: `[${list},null]`,
  batch_of_requests: `[${list}]`,
  id_null_object: '{"jsonrpc":"2.0","id":null,"method":"tools/list"}',
  method_not_string: '{"jsonrpc":"2.0","id":1,"method":5}',
  params_null: '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":null}',
  params_array: '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":[]}',
  meta_null: '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":null}}',
  call_args_null: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'list_workflows', arguments: null, _meta: modernMeta },
  }),
  call_name_null: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: null, _meta: modernMeta } }),
  truncated_json: '{"jsonrpc":"2.0","id":1,"meth',
  invalid_json: '{not json}',
  huge_line_2MiB: `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"pad":"${'a'.repeat(2 * 1024 * 1024)}"}}`,
  huge_line_20MiB: `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"pad":"${'a'.repeat(20 * 1024 * 1024)}"}}`,
  deep_nesting: `${'['.repeat(100_000)}${']'.repeat(100_000)}`,
};
const server = path.join(repo, 'tools', 'mcp-hseos-governance', 'index.js');
function run(mode, payload) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [server], {
      env: { PATH: process.env.PATH, HSEOS_STATE_DB: dbs[mode], TMPDIR: process.env.TMPDIR },
      cwd: path.dirname(dbs[mode]),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let exited = null;
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.stdin.on('error', () => {});
    child.on('close', (code, sig) => {
      exited = { code, sig };
    });
    setTimeout(() => child.stdin.write(`${payload}\n`), 1500);
    setTimeout(() => child.stdin.write(`${list}\n`), 3500); // sonda de vida: o servidor ainda responde depois da entrada hostil?
    setTimeout(() => {
      const alive = exited === null;
      child.kill('SIGKILL');
      resolve({
        alive_after: alive,
        exit: exited,
        replies: stdout
          .split('\n')
          .filter(Boolean)
          .map((l) => l.slice(0, 140)),
        crash_line: (stderr.match(/(TypeError|RangeError|Error)[^\n]*/) || [''])[0].slice(0, 160),
        at: (stderr.match(/\n\s+at [^\n]*/) || [''])[0].trim().replaceAll(repo, '<worktree>').slice(0, 160),
      });
    }, 6000);
  });
}
const result = {};
for (const [name, payload] of Object.entries(inputs)) {
  result[name] = { modern: await run('modern', payload), legacy: await run('legacy', payload) };
  const m = result[name].modern;
  const l = result[name].legacy;
  console.log(
    `${name.padEnd(24)} modern: ${m.alive_after ? 'vivo' : 'MORREU'} ${m.crash_line}  | legado: ${l.alive_after ? 'vivo' : 'MORREU'}`,
  );
}
fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
