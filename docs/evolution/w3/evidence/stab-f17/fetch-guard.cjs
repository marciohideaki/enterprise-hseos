'use strict';
// F17 local preload (derived from the C9 guard): counts, caps and (in mock mode) answers the provider requests of an engineering run. Never prints a credential.
// env: C9_MODE=mock|real, C9_DIR (log/counter dir), C9_MAX_REQUESTS (hard cap across the whole campaign), C9_CRASH_ON_FETCH (N: SIGKILL this process just before its Nth provider request)
const fs = require('node:fs'),
  path = require('node:path'),
  { createHash } = require('node:crypto');
const dir = process.env.C9_DIR,
  mode = process.env.C9_MODE,
  max = Number(process.env.C9_MAX_REQUESTS || 12);
const crashOn = Number(process.env.C9_CRASH_ON_FETCH || 0);
const counter = path.join(dir, 'request-count.txt'),
  log = path.join(dir, 'provider-requests.jsonl');
const real = globalThis.fetch;
let local = 0;
const sha = (v) => createHash('sha256').update(v).digest('hex');
// F17 local campaign: the ONLY reachable origin is the declared local backend (F17_ORIGIN, e.g. http://127.0.0.1:PORT); anything else is not a provider request.
const ORIGIN = process.env.F17_ORIGIN || 'http://127.0.0.1:0';
const isProvider = (u) => String(u).startsWith(`${ORIGIN}/`) || /^https:\/\/mock\.invalid\//.test(String(u));
const sse = (frames) =>
  new Response(frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('') + 'data: [DONE]\n\n', {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
function mock(body) {
  const msgs = body.messages;
  const usage = { choices: [], usage: { prompt_tokens: 900, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 0 } } };
  const call = (name, args) =>
    sse([
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id:
                    'call_' +
                    sha(JSON.stringify(args))
                      .slice(0, 8)
                      .replaceAll(/[a-f]/g, (c) => c.toUpperCase()),
                  type: 'function',
                  function: { name, arguments: JSON.stringify(args) },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
      usage,
    ]);
  const text = (t) => sse([{ choices: [{ index: 0, delta: { content: t }, finish_reason: 'stop' }] }, usage]);
  const toolNames = (body.tools || []).map((t) => t.function.name);
  const find = (frag) => toolNames.find((n) => n.endsWith(frag));
  const results = msgs.filter((m) => m.role === 'tool');
  if (results.length === 0)
    return call(find('write'), { path: 'add.js', expected_sha256: null, content: 'module.exports = (a, b) => a + b;\n' });
  if (results.length === 1) return call(find('command'), { id: 'check' });
  return text('done');
}
globalThis.fetch = async (url, init) => {
  if (!isProvider(url)) return real(url, init);
  const body = JSON.parse(init.body);
  if (crashOn && local + 1 === crashOn) {
    fs.writeFileSync(
      path.join(dir, 'crash-record.json'),
      JSON.stringify({
        pid: process.pid,
        cmdline: fs.readFileSync('/proc/self/cmdline', 'utf8').split('\0').slice(0, 6),
        at_request_in_process: local + 1,
        killed_before_sending: true,
      }),
    );
    process.kill(process.pid, 'SIGKILL');
  }
  if (process.env.C9_DEADLINE_MS && Date.now() > Number(process.env.C9_DEADLINE_MS))
    throw Object.assign(new Error('C9_DEADLINE_EXPIRED'), { code: 'C9_DEADLINE_EXPIRED' });
  let total = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0;
  if (total >= max) throw Object.assign(new Error('C9_REQUEST_CAP_REACHED'), { code: 'C9_REQUEST_CAP_REACHED' });
  fs.writeFileSync(counter, String(total + 1));
  local += 1;
  const entry = {
    n: total + 1,
    t: new Date().toISOString(),
    mode,
    url: String(url),
    model: body.model,
    messages: body.messages.length,
    roles: body.messages.map((m) => m.role),
    last_tool_msg: mode === 'mock' ? (body.messages.findLast((m) => m.role === 'tool')?.content || '').slice(0, 300) : undefined,
    tool_names: (body.tools || []).map((t) => t.function.name),
    wire_names_valid: (body.tools || []).map((t) => t.function.name).every((n) => /^[A-Za-z0-9_-]{1,64}$/.test(n)),
    max_tokens: body.max_tokens,
    body_sha256: sha(init.body),
    body_bytes: init.body.length,
  };
  if (mode === 'mock') {
    const r = mock(body);
    entry.status = 200;
    fs.appendFileSync(log, JSON.stringify(entry) + '\n');
    return r;
  }
  const r = await real(url, init);
  entry.status = r.status;
  try {
    fs.appendFileSync(path.join(dir, 'raw-sse.txt'), `--- request ${entry.n} status ${r.status}\n` + (await r.clone().text()) + '\n', {
      mode: 0o600,
    });
  } catch (error) {
    entry.raw_capture_error = String(error.message).slice(0, 160);
  }
  try {
    const clone = r.clone();
    const txt = await clone.text();
    const u = [...txt.matchAll(/"usage":(\{[^}]*(?:\{[^}]*\}[^}]*)*\})/g)].map((m) => m[1]).findLast((x) => !x.startsWith('null'));
    entry.usage = u ? JSON.parse(u) : null;
    entry.finish = [...txt.matchAll(/"finish_reason":"([a-z_]+)"/g)].map((m) => m[1]).at(-1) || null;
    const mm = txt.match(/"model":"([^"]+)"/);
    entry.responding_model = mm ? mm[1] : null;
  } catch {
    entry.usage = 'unreadable';
  }
  fs.appendFileSync(log, JSON.stringify(entry) + '\n');
  return r;
};
