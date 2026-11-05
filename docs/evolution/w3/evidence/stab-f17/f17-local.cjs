'use strict';
// F17 local campaign: one engineering task run through the openai-compatible binding pointed at the LOCAL Ollama (shared infra, k3s),
// observing the effective backend and model from the wire. usage (repository root):
//   F17_ORIGIN=http://127.0.0.1:PORT C9_MODE=real C9_DIR=<out> C9_MAX_REQUESTS=N node f17-local.cjs <model> <out-dir>
// The caller starts the port-forward and records the pod; this script never opens a network path of its own.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = process.cwd();
const [MODEL, OUT] = process.argv.slice(2);
const ORIGIN = process.env.F17_ORIGIN;
if (!MODEL || !OUT || !ORIGIN) throw new Error('usage: F17_ORIGIN=... node f17-local.cjs <model> <out-dir>');
const { createEngineeringExample } = require(path.join(root, 'tools/examples/engineering-task'));
fs.mkdirSync(OUT, { recursive: true, mode: 0o700 });
const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'f17-work-'));
const binding = `schema_version: "1.0"
binding_id: provider-binding:openai-compatible-example
profile_id: agent-openai-compatible-candidate
adapter: openai-compatible-sse
provider:
  provider_id: model:openai-compatible
  provider_version: 1.0.0
  base_url: ${ORIGIN}/v1
  model: ${MODEL}
  capabilities:
    - text_generation
    - streaming
    - tool_calls
    - usage
    - cancellation
  limits:
    context_tokens: ${process.env.F17_CONTEXT_TOKENS || 8192}
    max_output_tokens: 1024
    max_parallel_requests: 1
  secret_refs:
    - name: api-key
      source_ref: env://HSEOS_MODEL_PROVIDER_API_KEY
transport:
  max_attempts: 1
  retry_delay_ms: 250
activation:
  operational: false
  authorized: false
`;
const example = structuredClone(createEngineeringExample('addition'));
example.contract.limits = { ...example.contract.limits, max_tokens: 60_000, max_duration_ms: 600_000, max_tool_calls: 6 };
fs.writeFileSync(path.join(scratch, 'task.json'), JSON.stringify(example.contract));
fs.writeFileSync(path.join(scratch, 'binding.yaml'), binding);
fs.writeFileSync(path.join(OUT, 'binding.yaml'), binding, { mode: 0o600 });
const result = spawnSync(
  process.execPath,
  [
    '--require',
    path.join(__dirname, 'fetch-guard.cjs'),
    path.join(root, 'tools/cli/hseos-cli.js'),
    'agent',
    'run',
    '--task-contract',
    path.join(scratch, 'task.json'),
    '--binding',
    path.join(scratch, 'binding.yaml'),
    '--json',
  ],
  {
    encoding: 'utf8',
    timeout: 900_000,
    env: {
      PATH: process.env.PATH,
      HOME: path.join(scratch, 'home'),
      TMPDIR: process.env.TMPDIR || os.tmpdir(),
      HSEOS_MODEL_PROVIDER_API_KEY: 'local-backend-ignores-the-key',
      C9_MODE: process.env.C9_MODE,
      C9_DIR: OUT,
      C9_MAX_REQUESTS: process.env.C9_MAX_REQUESTS || '12',
      C9_DEADLINE_MS: String(Date.now() + 15 * 60_000),
      F17_ORIGIN: ORIGIN,
    },
  },
);
let json = null;
try {
  json = JSON.parse((result.stdout || '').trim().split('\n').at(-1));
} catch {
  json = null;
}
const report = {
  model: MODEL,
  origin: ORIGIN,
  status: result.status,
  signal: result.signal,
  result: json,
  stderr: (result.stderr || '').slice(0, 600),
};
fs.writeFileSync(path.join(OUT, 'outcome.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
if (json?.state) {
  fs.mkdirSync(path.join(OUT, 'states'), { recursive: true });
  spawnSync('cp', ['-a', json.state, path.join(OUT, 'states', 'run')]);
}
fs.rmSync(scratch, { recursive: true, force: true });
process.stdout.write(
  `${JSON.stringify({ model: MODEL, status: result.status, task_result: json?.task_result ?? null, reason: json?.reason ?? null })}\n`,
);
