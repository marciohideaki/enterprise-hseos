'use strict';

const fs = require('node:fs');
const readline = require('node:readline');

const statePath = process.argv[2];
const mode = process.argv[3] || 'normal';
let initialized = false;
let activeTurn = null;

function state() {
  if (!fs.existsSync(statePath)) {
    return {
      created: 0,
      resumed: 0,
      interrupted: 0,
      turns: 0,
      thread_id: 'codex-thread-1',
      selected_environment_received: process.env.HSEOS_CODEX_TEST_VALUE !== undefined,
    };
  }
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

function save(value) {
  fs.writeFileSync(statePath, JSON.stringify(value));
}

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function result(id, value) {
  send({ id, result: value });
}

function notification(method, params) {
  send({ method, params });
}

readline.createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    initialized = true;
    return result(message.id, { userAgent: 'fake-codex', platformFamily: 'unix', platformOs: 'linux' });
  }
  if (message.method === 'initialized') return;
  if (!initialized) return send({ id: message.id, error: { code: -32000, message: 'Not initialized' } });
  if (message.method === 'account/read') return result(message.id, { account: { type: 'chatgpt', email: 'fixture@example.invalid' } });
  if (message.method === 'account/rateLimits/read') return result(message.id, { rateLimits: { limitId: 'codex', primary: { usedPercent: 20, resetsAt: Math.ceil(Date.now()/1000)+60 }, secondary: null, credits: { hasCredits: false, unlimited: false } } });
  const current = state();
  if (message.method === 'thread/start') {
    if (message.params.sandbox !== 'read-only') {
      return send({ id: message.id, error: { code: -32602, message: 'Expected the v2 read-only sandbox mode' } });
    }
    current.created += 1;
    save(current);
    return result(message.id, { thread: { id: current.thread_id } });
  }
  if (message.method === 'thread/resume') {
    current.resumed += 1;
    save(current);
    return result(message.id, { thread: { id: message.params.threadId, turns: [{ id: 'codex-turn-historical', status: 'completed' }] } });
  }
  if (message.method === 'turn/start') {
    if (message.params.sandboxPolicy?.type !== 'readOnly') {
      return send({ id: message.id, error: { code: -32602, message: 'Expected the v2 readOnly sandbox policy' } });
    }
    current.turns += 1;
    save(current);
    activeTurn = `codex-turn-${current.turns}`;
    if (mode === 'stale-usage' || mode === 'foreign-stale-usage') {
      notification('thread/tokenUsage/updated', { threadId: mode === 'foreign-stale-usage' ? 'foreign-thread' : message.params.threadId, turnId: 'codex-turn-historical', tokenUsage: { last: { inputTokens: 999, outputTokens: 999 } } });
    }
    result(message.id, { turn: { id: activeTurn, status: 'inProgress' } });
    const identity = { threadId: message.params.threadId, turnId: activeTurn };
    if (mode === 'exit') return process.exit(23);
    if (mode === 'effect') {
      notification('item/started', { ...identity, item: { type: 'commandExecution', id: 'item-1' } });
      return;
    }
    if (mode === 'unknown-effect') {
      notification('item/started', { ...identity, item: { type: 'futureEffectType', id: 'item-1' } });
      return;
    }
    notification('thread/tokenUsage/updated', { ...identity, tokenUsage: { last: { inputTokens: 5, outputTokens: 2 }, total: { inputTokens: 5, outputTokens: 2 } } });
    notification('item/agentMessage/delta', { ...identity, itemId: 'item-1', delta: 'fixture answer' });
    if (mode !== 'wait') notification('turn/completed', { threadId: identity.threadId, turn: { id: activeTurn, status: 'completed' } });
    return;
  }
  if (message.method === 'turn/interrupt') {
    current.interrupted += 1;
    save(current);
    result(message.id, {});
    notification('turn/completed', {
      threadId: message.params.threadId,
      turn: { id: message.params.turnId, status: 'interrupted' },
    });
  }
});
