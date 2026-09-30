'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createResourceGroup, removeDrainedGroup } = require('../../../packages/agent-isolation-attestation/executor');

/** Resource containment for trusted SDK clients; not a filesystem sandbox. */
async function runCampaignProcess({
  binary = process.execPath,
  args = [path.join(__dirname, 'provider-campaign-worker.js')],
  input,
  signal,
  timeout_ms,
  memory_max_bytes,
  pids_max,
}) {
  if (!(signal instanceof AbortSignal) || signal.aborted || !Number.isSafeInteger(timeout_ms) || timeout_ms < 1 || timeout_ms > 300_000)
    throw new Error('CONTROL_CAMPAIGN_PROCESS_INVALID');
  const group = createResourceGroup({ memory_max_bytes, pids_max });
  let child;
  let timer;
  let failure;
  const stop = () => {
    try {
      fs.writeFileSync(path.join(group, 'cgroup.kill'), '1');
    } catch {
      failure = true;
    }
    child?.kill('SIGKILL');
  };
  try {
    const encoded = JSON.stringify({ ...input, group });
    if (Buffer.byteLength(encoded) > 131_072) throw new Error('CONTROL_CAMPAIGN_PROCESS_INVALID');
    child = spawn(binary, args, { env: {}, stdio: ['pipe', 'pipe', 'ignore'], shell: false });
    child.stdin.on('error', () => {
      failure = true;
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (Buffer.byteLength(output) > 65_536) {
        failure = true;
        stop();
      }
    });
    const completion = new Promise((resolve, reject) => {
      child.once('error', () => {
        failure = true;
      });
      child.once('close', (code) => {
        try {
          const envelope = JSON.parse(output);
          if (failure || signal.aborted || code !== 0 || !envelope.result) throw new Error('uncertain');
          resolve(envelope.result);
        } catch {
          reject(new Error('CONTROL_OUTCOME_UNCERTAIN'));
        }
      });
    });
    signal.addEventListener('abort', stop, { once: true });
    timer = setTimeout(() => {
      failure = true;
      stop();
    }, timeout_ms);
    if (signal.aborted) stop();
    else child.stdin.end(encoded);
    return await completion;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
    await removeDrainedGroup(group);
  }
}
module.exports = { runCampaignProcess };
