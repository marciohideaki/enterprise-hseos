const assert = require('node:assert');
const fs = require('fs-extra');
const os = require('node:os');
const path = require('node:path');

const {
  encodeContextFile,
  retrieveContext,
} = require('../tools/cli/lib/cortex/recall-intelligence');

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-cortex-'));
  const sourceFile = path.join(tempRoot, 'context.txt');

  await fs.writeFile(sourceFile, 'policy enforcement and mission runtime traceability', 'utf8');
  await encodeContextFile(sourceFile, {
    projectDir: tempRoot,
    layer: 'scoped',
    title: 'Runtime governance context',
  });

  const retrieval = await retrieveContext('policy traceability', {
    projectDir: tempRoot,
  });

  assert.equal(retrieval.results.length, 1);
  assert.equal(retrieval.results[0].layer, 'scoped');
  assert(retrieval.results[0].trace.score > 0);

  console.log('test-cortex-recall-intelligence: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
