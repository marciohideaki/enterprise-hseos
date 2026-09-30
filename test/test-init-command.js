'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const prompts = require('../tools/cli/lib/prompts');
const init = require('../tools/cli/commands/init');
const install = require('../tools/cli/commands/install');

test('init refuses non-interactive execution before reading or writing a project', async () => {
  await assert.rejects(init.action({ directory: '/missing-project' }), /requires an interactive terminal/);
});

test('init shows a plan and leaves the project untouched when installation is declined', async () => {
  const original = {
    stdinTTY: Object.getOwnPropertyDescriptor(process.stdin, 'isTTY'),
    stdoutTTY: Object.getOwnPropertyDescriptor(process.stdout, 'isTTY'),
    select: prompts.select,
    note: prompts.note,
    confirm: prompts.confirm,
    info: prompts.log.info,
  };
  let summary;
  try {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    prompts.select = async () => 'developer';
    prompts.note = async (message) => {
      summary = message;
    };
    prompts.confirm = async () => false;
    prompts.log.info = async () => {};
    await init.action({ directory: process.cwd() });
    assert.match(summary, /Profile: Developer/);
    assert.match(summary, /Optional prerequisites:/);
    assert.match(summary, /Adapters: claude-code, codex/);
  } finally {
    if (original.stdinTTY) Object.defineProperty(process.stdin, 'isTTY', original.stdinTTY);
    else delete process.stdin.isTTY;
    if (original.stdoutTTY) Object.defineProperty(process.stdout, 'isTTY', original.stdoutTTY);
    else delete process.stdout.isTTY;
    prompts.select = original.select;
    prompts.note = original.note;
    prompts.confirm = original.confirm;
    prompts.log.info = original.info;
  }
});

test('init passes the reviewed profile and directory to the existing installer', async () => {
  const originals = {
    stdinTTY: Object.getOwnPropertyDescriptor(process.stdin, 'isTTY'),
    stdoutTTY: Object.getOwnPropertyDescriptor(process.stdout, 'isTTY'),
    select: prompts.select,
    note: prompts.note,
    confirm: prompts.confirm,
    action: install.action,
  };
  let received;
  try {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    prompts.select = async () => 'governance';
    prompts.note = async () => {};
    prompts.confirm = async () => true;
    install.action = async (options) => {
      received = options;
    };
    await init.action({ directory: process.cwd() });
    assert.deepEqual(received, { directory: process.cwd(), profile: 'governance' });
  } finally {
    if (originals.stdinTTY) Object.defineProperty(process.stdin, 'isTTY', originals.stdinTTY);
    else delete process.stdin.isTTY;
    if (originals.stdoutTTY) Object.defineProperty(process.stdout, 'isTTY', originals.stdoutTTY);
    else delete process.stdout.isTTY;
    prompts.select = originals.select;
    prompts.note = originals.note;
    prompts.confirm = originals.confirm;
    install.action = originals.action;
  }
});
