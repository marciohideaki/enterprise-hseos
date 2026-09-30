'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { z, IdentifierSchema } = require('../../../packages/agent-runtime-contracts/common');
const { canonicalize } = require('../../../packages/managed-governance-contracts/canonical-json');
const { createIsolationPolicy } = require('../../../packages/agent-isolation-attestation');
const { executeIsolatedCommand } = require('../../../packages/agent-isolation-attestation/executor');
const { ExecutionPluginError, assertExecutionPluginAdmission } = require('../../lib/execution-plugin-manifest');

// This program is copied into the private snapshot and only runs in the executor.
const RUNNER = String.raw`
'use strict';
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
(async () => {
  const request = JSON.parse(fs.readFileSync('/workspace/request.json', 'utf8'));
  const module = await import(pathToFileURL(request.entrypoint).href);
  if (typeof module.default !== 'function') throw Error('PLUGIN_HANDLER_REQUIRED');
  const result = await module.default(Object.freeze({ method: request.method, input: request.input }));
  process.stdout.write(JSON.stringify({
    schema_version: 1, request_id: request.request_id, plugin_id: request.plugin_id,
    manifest_sha256: request.manifest_sha256, result,
  }));
})().catch(() => { process.exitCode = 1; });
`;
const requestSchema = z
  .object({
    request_id: z.string().uuid(),
    method: IdentifierSchema,
    input: z.json(),
  })
  .strict();
const responseSchema = z
  .object({
    schema_version: z.literal(1),
    request_id: z.string().uuid(),
    plugin_id: IdentifierSchema,
    manifest_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    result: z.json(),
  })
  .strict();

function reject(code) {
  throw new ExecutionPluginError(code);
}

function snapshotBundles(admission) {
  const bundles = new Map();
  const visit = (selected) => {
    const previous = bundles.get(selected.manifest.id);
    if (previous) {
      if (previous.manifest_sha256 !== selected.manifest_sha256) reject('PLUGIN_SELECTION_CONFLICT');
      return;
    }
    const bundle = assertExecutionPluginAdmission(selected);
    bundles.set(bundle.manifest.id, bundle);
    for (const dependency of selected.dependencies) visit(dependency);
  };
  // Validate the nominal capability before touching any caller-provided fields.
  assertExecutionPluginAdmission(admission);
  visit(admission);
  return bundles;
}

async function invoke({ admission, request, entrypoint, signal, deadline_at }) {
  const parsed = requestSchema.safeParse(request);
  if (!parsed.success) reject('PLUGIN_REQUEST_INVALID');
  let encoded;
  try {
    encoded = canonicalize(parsed.data);
  } catch {
    reject('PLUGIN_REQUEST_INVALID');
  }
  if (Buffer.byteLength(encoded) > 65_536) reject('PLUGIN_REQUEST_LIMIT');
  if (signal !== undefined && !(signal instanceof AbortSignal)) reject('PLUGIN_REQUEST_INVALID');
  if (signal?.aborted) reject('PLUGIN_CANCELLED');
  if (deadline_at !== undefined && (!Number.isSafeInteger(deadline_at) || deadline_at <= Date.now())) reject('PLUGIN_DEADLINE_EXPIRED');
  const bundles = snapshotBundles(admission);
  const manifest = admission.manifest;
  const selectedEntry = entrypoint || manifest.entrypoint;
  if (selectedEntry !== manifest.entrypoint && !manifest.conformance.includes(selectedEntry)) reject('PLUGIN_ENTRYPOINT_INVALID');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-plugin-execution-'));
  fs.chmodSync(directory, 0o700);
  let executionAttempted = false;
  try {
    const workspace = path.join(directory, 'workspace');
    fs.mkdirSync(workspace, { mode: 0o700 });
    for (const bundle of bundles.values()) {
      const root = path.join(workspace, 'plugins', bundle.manifest.id);
      for (const [name, bytes] of bundle.files) {
        const filename = path.join(root, name);
        fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
        fs.writeFileSync(filename, bytes, { flag: 'wx', mode: 0o400 });
      }
    }
    const envelope = {
      ...parsed.data,
      plugin_id: manifest.id,
      manifest_sha256: admission.manifest_sha256,
      entrypoint: `/workspace/plugins/${manifest.id}/${selectedEntry}`,
    };
    fs.writeFileSync(path.join(workspace, 'request.json'), canonicalize(envelope), { flag: 'wx', mode: 0o400 });
    fs.writeFileSync(path.join(workspace, 'runner.cjs'), RUNNER, { flag: 'wx', mode: 0o400 });
    const controlFile = path.join(directory, 'admission.json');
    fs.writeFileSync(controlFile, canonicalize({ plugin_id: manifest.id, manifest_sha256: admission.manifest_sha256 }), {
      flag: 'wx',
      mode: 0o400,
    });
    const policy = createIsolationPolicy({
      backend: 'bwrap',
      host_workspace: workspace,
      main_checkout: directory,
      protected_paths: [controlFile],
    });
    const timeout = Math.min(manifest.limits.timeout_ms, deadline_at === undefined ? manifest.limits.timeout_ms : deadline_at - Date.now());
    if (timeout <= 0) reject('PLUGIN_DEADLINE_EXPIRED');
    executionAttempted = true;
    const execution = await executeIsolatedCommand({
      policy,
      command: ['/usr/bin/node', '/workspace/runner.cjs'],
      timeout_ms: timeout,
      max_output_bytes: manifest.limits.max_output_bytes,
      signal,
      host_node: true,
    });
    if (!execution.descendants_terminated) reject('PLUGIN_TEARDOWN_UNCERTAIN');
    if (execution.status !== 'succeeded') {
      const codes = {
        cancelled: 'PLUGIN_CANCELLED',
        timed_out: 'PLUGIN_TIMEOUT',
        timeout: 'PLUGIN_TIMEOUT',
        output_limit: 'PLUGIN_OUTPUT_LIMIT',
      };
      reject(codes[execution.status] || 'PLUGIN_EXECUTION_FAILED');
    }
    let response;
    try {
      response = responseSchema.parse(JSON.parse(execution.stdout));
    } catch {
      reject('PLUGIN_RESPONSE_INVALID');
    }
    if (
      response.request_id !== parsed.data.request_id ||
      response.plugin_id !== manifest.id ||
      response.manifest_sha256 !== admission.manifest_sha256
    )
      reject('PLUGIN_RESPONSE_IDENTITY');
    return {
      ...response,
      isolation: {
        policy_digest: execution.policy_digest,
        descendants_terminated: true,
        workspace_access: execution.workspace_access,
        limits: execution.limits,
      },
    };
  } catch (error) {
    if (error instanceof ExecutionPluginError) throw error;
    if (executionAttempted || error.code === 'ENGINEERING_TEARDOWN_UNCERTAIN') reject('PLUGIN_TEARDOWN_UNCERTAIN');
    reject('PLUGIN_ISOLATION_FAILED');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function executeExecutionPlugin({ admission, request, signal, deadline_at }) {
  return invoke({ admission, request, signal, deadline_at });
}

/** Isolated plugin-supplied diagnostics; host port conformance remains separate. */
async function runExecutionPluginConformance({ admission, signal, deadline_at }) {
  assertExecutionPluginAdmission(admission);
  const diagnostics = [];
  const deadline = deadline_at ?? Date.now() + admission.manifest.limits.timeout_ms;
  for (const entrypoint of admission.manifest.conformance) {
    const result = await invoke({
      admission,
      entrypoint,
      signal,
      deadline_at: deadline,
      request: { request_id: randomUUID(), method: 'conformance', input: {} },
    });
    if (result.result?.passed !== true) reject('PLUGIN_CONFORMANCE_FAILED');
    diagnostics.push({ entrypoint, request_id: result.request_id, isolation: result.isolation });
  }
  return {
    plugin_id: admission.manifest.id,
    manifest_sha256: admission.manifest_sha256,
    kind: 'plugin-self-test',
    certified: false,
    diagnostics,
  };
}

module.exports = { executeExecutionPlugin, runExecutionPluginConformance };
