'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { ClaudeCliDriver } = require('../../../packages/runtime-providers/claude-cli-driver');
const { accountDigest, sameAccountDigest } = require('./campaign-evidence-store');

const IDENTITY = 'CONTROL_PROVIDER_IDENTITY_UNVERIFIED';
const QUOTA = 'CONTROL_PROVIDER_QUOTA_UNAVAILABLE';
const OUTPUT_LIMIT = 'CONTROL_PROVIDER_OUTPUT_LIMIT';
const refusalByCode = { identity_unverified: IDENTITY, quota_unavailable: QUOTA };

/** Verifies the logged-in subscription identity without ever reading a credential file. */
async function observeAccount(driver, expectedVersion, state) {
  let report;
  try {
    report = await driver.inspectAccount();
  } catch {
    return { refusal: IDENTITY };
  }
  const { identity } = report;
  if (
    report.version !== `${expectedVersion} (Claude Code)` ||
    report.logged_in !== true ||
    report.api_provider !== 'firstParty' ||
    !ClaudeCliDriver.isAccountAuthMethod(identity.authMethod) ||
    ![identity.email, identity.orgId, identity.subscriptionType].every((value) => typeof value === 'string' && value.length > 0)
  )
    return { refusal: IDENTITY };
  return { version: expectedVersion, auth_method: identity.authMethod, account_digest: accountDigest(state, identity) };
}

async function main(input) {
  const config = JSON.parse(input);
  const started = Date.now();
  fs.writeFileSync(`${config.group}/cgroup.procs`, String(process.pid));
  if (!['inspect', 'run'].includes(config.operation)) throw new Error('invalid operation');
  const driver = new ClaudeCliDriver({ executable: config.binding.executable, cwd: config.binding.cwd, env: config.environment });
  const account = await observeAccount(driver, config.expected_version, config.state);
  if (account.refusal) return account;
  if (config.operation === 'inspect') return account;
  if (!sameAccountDigest(account.account_digest, config.expected_account_digest)) return { refusal: IDENTITY };
  // A fresh empty directory per run keeps project-level instructions out of reach.
  const cwd = fs.mkdtempSync(path.join(config.binding.cwd, 'run-'));
  const runner = new ClaudeCliDriver({ executable: config.binding.executable, cwd, env: config.environment });
  let usage;
  let sessionDirectory;
  let bytes = 0;
  const hash = createHash('sha256');
  const chunks = [];
  let retained = 0;
  try {
    const result = await runner.run({
      prompt: config.prompt,
      model: config.model,
      session_id: randomUUID(),
      persist: config.persist === true,
      ...(config.resume_session_id ? { resume: config.resume_session_id } : {}),
      timeout_ms: Math.max(1000, config.timeout_ms - (Date.now() - started)),
      expected_version: config.expected_version,
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
    // The client applies CLAUDE_CODE_MAX_OUTPUT_TOKENS to the whole answer, reasoning included: its overrun is a known budget
    // stop, reported with its own stable code instead of an uncertain outcome.
    if (result.stop_reason === 'budget_exceeded' && result.limit === 'output_tokens')
      return {
        refusal: OUTPUT_LIMIT,
        diagnostic: { limit: 'output_tokens', client_limit_tokens: Number(config.environment.CLAUDE_CODE_MAX_OUTPUT_TOKENS) || null },
      };
    if (result.stop_reason !== 'completed' || !usage)
      throw new Error(
        `uncertain result: stop_reason=${JSON.stringify(result.stop_reason)} usage=${usage === undefined ? 'absent' : 'present'}`,
      );
    let pidsPeak = null;
    try {
      pidsPeak = Number(fs.readFileSync(`${config.group}/pids.peak`, 'utf8').trim());
    } catch {
      // pids.peak needs a recent kernel; calibration evidence is optional.
    }
    // Persisted transcripts hold the prompt and answer on local disk; they stay only where resume was enabled.
    const configDirectory = config.environment.CLAUDE_CONFIG_DIR || path.join(config.environment.HOME, '.claude');
    sessionDirectory = path.join(configDirectory, 'projects', fs.realpathSync(cwd).replaceAll(/[^a-zA-Z0-9]/g, '-'));
    return {
      usage,
      init: result.init,
      ...(config.persist === true ? { sensitive_session_dir: sessionDirectory } : {}),
      text_sha256: hash.digest('hex'),
      ...(retained === null ? { text_too_large: true } : { text: chunks.join('') }),
      provider_session_id: result.session_id,
      rate_limit_warnings: result.rate_limit_warnings,
      pids_peak: Number.isSafeInteger(pidsPeak) ? pidsPeak : null,
    };
  } catch (error) {
    if (refusalByCode[error?.error_code]) return { refusal: refusalByCode[error.error_code] };
    throw error;
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    if (config.persist !== true) {
      const configDirectory = config.environment.CLAUDE_CONFIG_DIR || path.join(config.environment.HOME, '.claude');
      // Derived from the unique per-run directory name, so no other session can be removed.
      fs.rmSync(path.join(configDirectory, 'projects', cwd.replaceAll(/[^a-zA-Z0-9]/g, '-')), { recursive: true, force: true });
    }
  }
}

if (require.main === module) {
  (async () => {
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (Buffer.byteLength(input) > 131_072) throw new Error('input limit');
    }
    return main(input);
  })().then(
    (result) => {
      process.stdout.write(JSON.stringify({ result }) + '\n');
    },
    (error) => {
      // The parent redacts and bounds this; it holds the real cause instead of a bare uncertain marker.
      const diagnostic = { name: String(error?.name), code: error?.error_code ?? error?.code ?? null, message: String(error?.message) };
      process.stdout.write(JSON.stringify({ error: 'CONTROL_OUTCOME_UNCERTAIN', diagnostic }) + '\n');
      process.exitCode = 1;
    },
  );
}
module.exports = { main, observeAccount };
