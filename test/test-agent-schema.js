const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('yaml');

const { validateAgentFile } = require('../tools/schema/agent');

function main() {
  const agentPath = path.join(__dirname, '../src/core/agents/hseos-master.agent.yaml');
  const contents = fs.readFileSync(agentPath, 'utf8');
  const parsed = yaml.parse(contents);
  const result = validateAgentFile('src/core/agents/hseos-master.agent.yaml', parsed);

  assert.equal(result.success, true, 'core agent schema should validate');
  console.log('test-agent-schema: ok');
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
