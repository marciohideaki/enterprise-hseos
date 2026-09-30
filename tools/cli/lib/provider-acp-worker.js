'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { AcpRuntimeProvider } = require('../../../packages/runtime-providers/acp-runtime-provider');
const { ProcessAcpPeer } = require('../../../packages/runtime-providers/process-acp-peer');
const { CodexAcpPeer } = require('../../../packages/runtime-providers/codex-acp-peer');
const { validateRestrictedComposition } = require('../../../packages/runtime-providers/codex-acp-composition');
const { CONTRACT_SCHEMA_VERSION } = require('../../../packages/agent-runtime-contracts');
async function main() {
  let input = '';
  for await (const c of process.stdin) {
    input += c;
    if (Buffer.byteLength(input) > 131_072) throw new Error('input');
  }
  const request = JSON.parse(input);
  fs.writeFileSync(path.join(request.group, 'cgroup.procs'), String(process.pid));
  const composition = JSON.parse(fs.readFileSync(request.composition_path, 'utf8'));
  const verified = validateRestrictedComposition(composition);
  const verify = () => {
    const current = validateRestrictedComposition(JSON.parse(fs.readFileSync(request.composition_path, 'utf8')));
    if (
      current.evidence_ref !== verified.evidence_ref ||
      request.inspection.expires_at <= Date.now() ||
      request.inspection.account_sha256 !== request.account_sha256 ||
      request.inspection.authenticated !== true
    )
      throw new Error('ACP_IDENTITY_EXPIRED');
  };
  verify();
  const transport = new ProcessAcpPeer({
    executable: process.execPath,
    args: [composition.agent],
    cwd: composition.cwd,
    env: {
      HOME: composition.home,
      CODEX_HOME: composition.home,
      PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
      CODEX_PATH: path.resolve(__dirname, '../../../packages/runtime-providers/codex-acp-launcher.js'),
      HSEOS_ACP_COMPOSITION: request.composition_path,
      CODEX_CONFIG: JSON.stringify(verified.config),
      INITIAL_AGENT_MODE: 'read-only',
      NO_BROWSER: '1',
    },
  });
  const peer = new CodexAcpPeer({ peer: transport, model: composition.model, verify, account_sha256: request.account_sha256 });
  const providerId = 'runtime:codex-acp';
  const provider = new AcpRuntimeProvider({
    provider_id: providerId,
    peer,
    default_cwd: composition.cwd,
    effect_boundary_attestation: {
      effect_boundary: verified.effect_boundary,
      evidence_ref: verified.evidence_ref,
      lifecycle: verified.lifecycle,
    },
  });
  const base = { schema_version: CONTRACT_SCHEMA_VERSION, provider_id: providerId };
  const spec = {
    schema_version: CONTRACT_SCHEMA_VERSION,
    session_id: `session:${randomUUID()}`,
    agent_id: 'agent:campaign-acp',
    parent_session_id: null,
    authority_ref: 'authority://campaign/scoped',
    policy_ref: 'policy://campaign/instructions-only',
    execution: { mode: 'delegated', runtime_provider_id: providerId, profile: 'instructions-only' },
    limits: {
      max_turns: 1,
      max_tokens: request.max_tokens,
      max_duration_ms: request.timeout_ms,
      max_tool_calls: 0,
      max_children: 0,
      max_workflow_steps: 1,
    },
    metadata: { cwd: composition.cwd, purpose: 'ACP campaign' },
  };
  try {
    const session = request.resume_session_id
      ? await provider.resume({
          ...base,
          command: 'resume',
          session_id: spec.session_id,
          runtime_session_id: request.resume_session_id,
          spec,
          expected_sequence: 0,
        })
      : await provider.create({ ...base, command: 'create', spec });
    if (request.inspect_only) return { admitted: true, inference_dispatched: false };
    const identity = { ...base, session_id: spec.session_id, runtime_session_id: session.runtime_session_id };
    await provider.send({
      ...identity,
      command: 'send',
      turn_id: `turn:${randomUUID()}`,
      message: { role: 'user', content: request.prompt },
    });
    const hash = createHash('sha256');
    let completed = false,
      cancelled = false;
    for await (const event of provider.events({ ...identity, from_sequence: 0 })) {
      if (event.event_type === 'runtime.message.delta') {
        hash.update(event.payload.text);
        if (request.cancel_on_output && !cancelled) {
          cancelled = true;
          await provider.cancel({ ...identity, command: 'cancel', reason: 'requested', cascade: false });
        }
      }
      if (event.event_type === 'runtime.session.completed') completed = true;
      if (event.event_type === 'runtime.session.failed' && !cancelled) throw new Error(event.payload.error_code);
    }
    if (!completed && !cancelled) throw new Error('ACP_INCOMPLETE');
    return {
      completed,
      cancelled,
      usage: peer.usage,
      text_sha256: hash.digest('hex'),
      provider_session_id: session.runtime_session_id,
      effect_boundary_ref: verified.evidence_ref,
    };
  } finally {
    await provider.close();
  }
}
if (require.main === module)
  main().then(
    (result) => process.stdout.write(JSON.stringify({ result }) + '\n'),
    (error) => {
      process.stdout.write(JSON.stringify({ error: error.error_code || error.message || 'CONTROL_OUTCOME_UNCERTAIN' }) + '\n');
      process.exitCode = 1;
    },
  );
module.exports = { main };
