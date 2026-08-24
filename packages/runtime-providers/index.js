'use strict';

const acp = require('./acp-runtime-provider');
const claude = require('./claude-agent-sdk-driver');
const codex = require('./codex-app-server-driver');
const deepseek = require('./deepseek-acp-composition');
const hosted = require('./hosted-runtime-provider');
const processAcp = require('./process-acp-peer');

class DeepSeekHarnessRuntimeProvider extends acp.AcpRuntimeProvider {}

module.exports = {
  ...acp,
  ...claude,
  ...codex,
  ...deepseek,
  ...hosted,
  ...processAcp,
  DeepSeekHarnessRuntimeProvider,
};
