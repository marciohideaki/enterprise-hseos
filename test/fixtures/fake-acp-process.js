'use strict';

const readline = require('node:readline');

const mode = process.argv[2] || 'normal';
let sessionId = null;
let permissionPromptId = null;

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value });
}

readline.createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.id === 'permission-1' && !message.method) {
    if (message.result?.outcome?.outcome !== 'cancelled') process.exit(31);
    result(permissionPromptId, { stopReason: 'cancelled' });
    return;
  }
  if (message.method === 'initialize') {
    if (mode === 'unknown-response') return result(999, {});
    return result(message.id, {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: false,
        ...(mode === 'unattested' ? {} : { _meta: { hseos: { effectBoundary: 'instructions_only' } } }),
      },
      authMethods: [],
      agentInfo: { name: 'deepseek-harness-fixture', version: '0.0.1' },
    });
  }
  if (message.method === 'session/new') {
    sessionId = 'deepseek-acp-session-1';
    return result(message.id, { sessionId });
  }
  if (message.method === 'session/prompt') {
    if (mode === 'permission') {
      permissionPromptId = message.id;
      send({
        jsonrpc: '2.0',
        id: 'permission-1',
        method: 'session/request_permission',
        params: {
          sessionId,
          toolCall: { toolCallId: 'tool-1', title: 'unsafe effect', kind: 'execute', status: 'pending' },
          options: [{ optionId: 'reject-1', name: 'Reject', kind: 'reject_once' }],
        },
      });
      return;
    }
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'deepseek fixture answer' } },
      },
    });
    return result(message.id, { stopReason: 'end_turn' });
  }
  if (message.method === 'session/cancel') return;
  result(message.id, {});
});
