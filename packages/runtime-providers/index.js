'use strict';

const acp = require('./acp-runtime-provider');
const hosted = require('./hosted-runtime-provider');

class DeepSeekHarnessRuntimeProvider extends acp.AcpRuntimeProvider {}

module.exports = {
  ...acp,
  ...hosted,
  DeepSeekHarnessRuntimeProvider,
};
