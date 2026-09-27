'use strict';
// Opt-in offline probe using the pinned binaries. Receives a composition path through the campaign supervisor.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { ProcessAcpPeer } = require('../../packages/runtime-providers/process-acp-peer');
const { validateRestrictedComposition, startupArgs } = require('../../packages/runtime-providers/codex-acp-composition');
async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const request = JSON.parse(input);
  fs.writeFileSync(path.join(request.group, 'cgroup.procs'), String(process.pid));
  const composition = JSON.parse(fs.readFileSync(request.composition_path));
  const { config } = validateRestrictedComposition(composition);
  const scratch = fs.mkdtempSync('/build/tmp/hseos-acp-tools-');
  const names = ['exec_command', 'apply_patch', 'collaboration.spawn_agent', 'view_image'];
  const report = { offered_tools: [], rejected_calls: [], witness_created: false, provider_calls: 0 };
  let requests = 0;
  let failure;
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      let body = Buffer.concat(chunks);
      // eslint-disable-next-line n/no-unsupported-features/node-builtins -- This opt-in native probe runs on Node 24.15; ordinary tests never execute it.
      if (req.headers['content-encoding'] === 'zstd') body = require('node:zlib').zstdDecompressSync(body);
      const data = JSON.parse(body);
      const offered = [
        ...(data.tools || []),
        ...(data.input || []).filter((i) => i.type === 'additional_tools').flatMap((i) => i.tools || []),
      ];
      report.offered_tools.push(offered.length);
      if (offered.length > 0) throw new Error('MODEL_TOOLS_EXPOSED');
      for (const item of data.input || [])
        if (
          ['function_call_output', 'custom_tool_call_output'].includes(item.type) &&
          item.call_id.startsWith('probe_') &&
          !report.rejected_calls.some((c) => c.id === item.call_id)
        )
          report.rejected_calls.push({ id: item.call_id, output: item.output });
      const name = names[requests++];
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (name)
        res.write(
          'event: response.output_item.done\ndata: ' +
            JSON.stringify({
              type: 'response.output_item.done',
              output_index: 0,
              item: {
                type: name === 'apply_patch' ? 'custom_tool_call' : 'function_call',
                id: 'fc_' + requests,
                call_id: 'probe_' + requests,
                name,
                ...(name === 'apply_patch'
                  ? { input: `*** Begin Patch\n*** Add File: ${scratch}/EFFECT\n+forbidden\n*** End Patch` }
                  : {
                      arguments: JSON.stringify({
                        cmd: 'touch ' + scratch + '/EFFECT',
                        path: scratch + '/EFFECT',
                        task_name: 'denied',
                        message: 'denied',
                      }),
                    }),
              },
            }) +
            '\n\n',
        );
      res.end(
        'event: response.completed\ndata: ' +
          JSON.stringify({
            type: 'response.completed',
            response: {
              id: 'response_' + requests,
              status: 'completed',
              output: [],
              usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            },
          }) +
          '\n\n',
      );
    } catch {
      failure = 'OFFLINE_PROBE_FAILED';
      res.writeHead(400);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  // Only the transport and authentication change: loopback gateway, empty home, no credential.
  const offline = {
    ...config,
    model_provider: 'probe',
    model_providers: {
      probe: {
        name: 'probe',
        base_url: `http://127.0.0.1:${server.address().port}/v1`,
        wire_api: 'responses',
        requires_openai_auth: false,
      },
    },
  };
  delete offline.forced_login_method;
  fs.writeFileSync(
    scratch + '/launch',
    `#!${process.execPath}\nconst c=require('node:child_process').spawn(${JSON.stringify(composition.binary)},${JSON.stringify(startupArgs(offline))},{stdio:'inherit'});c.on('exit',code=>process.exit(code??1));process.on('SIGTERM',()=>c.kill());\n`,
    { mode: 0o700 },
  );
  const peer = new ProcessAcpPeer({
    executable: process.execPath,
    args: [composition.agent],
    cwd: scratch,
    env: {
      HOME: scratch,
      CODEX_HOME: scratch,
      PATH: '/usr/bin:/bin',
      CODEX_PATH: scratch + '/launch',
      CODEX_CONFIG: JSON.stringify(offline),
      INITIAL_AGENT_MODE: 'read-only',
      NO_BROWSER: '1',
    },
  });
  peer.subscribe({
    notification() {},
    request() {
      throw new Error('HOST_REQUEST_DENIED');
    },
  });
  try {
    await peer.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    });
    const session = await peer.request('session/new', { cwd: scratch, mcpServers: [] });
    await peer.request('session/prompt', { sessionId: session.sessionId, prompt: [{ type: 'text', text: 'Offline protocol probe.' }] });
    report.witness_created = fs.existsSync(scratch + '/EFFECT');
    if (
      failure ||
      report.witness_created ||
      report.rejected_calls.length !== names.length ||
      report.rejected_calls.some((c) => !c.output.includes('unsupported'))
    )
      throw new Error('OFFLINE_PROBE_FAILED');
    return report;
  } finally {
    await peer.close();
    server.close();
  }
}
main().then(
  (result) => console.log(JSON.stringify({ result })),
  () => {
    console.log(JSON.stringify({ error: 'OFFLINE_PROBE_FAILED' }));
    process.exitCode = 1;
  },
);
