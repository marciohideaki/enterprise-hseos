'use strict';
const fs = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const { CodexAppServerDriver } = require('../../../packages/runtime-providers/codex-app-server-driver');
const { ClaudeAgentSdkDriver } = require('../../../packages/runtime-providers/claude-agent-sdk-driver');

async function main() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 131_072) throw new Error('input limit');
  }
  const config = JSON.parse(input);
  fs.writeFileSync(`${config.group}/cgroup.procs`, String(process.pid));
  if (!['codex', 'claude'].includes(config.vendor) || !['inspect', 'run'].includes(config.operation)) throw new Error('invalid operation');
  // SDK session discovery reads the process home as well as the query environment.
  for (const key of ['HOME', 'PATH', 'CODEX_HOME']) {
    if (config.environment[key] !== undefined) process.env[key] = config.environment[key];
  }
  const Driver = config.vendor === 'codex' ? CodexAppServerDriver : ClaudeAgentSdkDriver;
  const driver = new Driver({ ...config.binding, env: config.environment });
  try {
    if (config.operation === 'inspect') {
      if (config.vendor !== 'codex') throw new Error('unsupported inspection');
      const version = require('node:child_process')
        .execFileSync(config.binding.executable, ['--version'], {
          env: config.environment,
          timeout: 3000,
          maxBuffer: 4096,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        })
        .trim();
      return { ...(await driver.inspectAccount()), version };
    }
    let usage;
    let bytes = 0;
    const chunks = [];
    let retained = 0;
    const hash = createHash('sha256');
    const session = config.resume_session_id
      ? { runtime_session_id: config.resume_session_id }
      : await driver.create({
          cwd: config.binding.cwd,
          effect_boundary: 'instructions_only',
          ...(config.vendor === 'codex' ? { model: config.model } : {}),
        });
    if (config.resume_session_id)
      await driver.resume({
        runtime_session_id: config.resume_session_id,
        expected_sequence: 1,
        effect_boundary: 'instructions_only',
        ...(config.vendor === 'claude' ? { require_existing: true } : {}),
      });
    const result = await driver.send({
      runtime_session_id: session.runtime_session_id,
      turn_id: randomUUID(),
      instruction: config.prompt,
      effect_boundary: 'instructions_only',
      ...(config.vendor === 'claude' ? { max_budget_usd: config.budget_microusd / 1_000_000 } : {}),
      ...(config.vendor === 'claude' ? { model: config.model } : {}),
      on_usage: (value) => {
        usage = value;
      },
      on_event: (event) => {
        if (event.type !== 'message.delta') throw new Error('effect attempted');
        bytes += Buffer.byteLength(event.text);
        if (bytes > 1_048_576) throw new Error('output limit');
        hash.update(event.text);
        // Retention is capped far below the stream limit; an oversized answer is hashed but not returned.
        if (retained !== null) {
          retained += Buffer.byteLength(event.text);
          if (retained > 65_536) retained = null;
          else chunks.push(event.text);
        }
      },
    });
    if (result.stop_reason !== 'completed' || !usage) throw new Error('uncertain result');
    return {
      usage,
      text_sha256: hash.digest('hex'),
      ...(retained === null ? { text_too_large: true } : { text: chunks.join('') }),
      provider_session_id: session.runtime_session_id,
    };
  } finally {
    await driver.close();
  }
}
if (require.main === module) {
  main().then(
    (result) => {
      process.stdout.write(JSON.stringify({ result }) + '\n');
    },
    () => {
      process.stdout.write(JSON.stringify({ error: 'CONTROL_OUTCOME_UNCERTAIN' }) + '\n');
      process.exitCode = 1;
    },
  );
}
