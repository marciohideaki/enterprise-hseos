const assert = require('node:assert');
const fs = require('fs-extra');
const os = require('node:os');
const path = require('node:path');

const {
  encodeContextFile,
  impactContext,
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
    tags: ['policy', 'runtime', 'critical'],
  });
  await fs.writeFile(path.join(tempRoot, 'runtime.js'), 'const runtimePolicy = "critical remediation policy";\n', 'utf8');
  await fs.ensureDir(path.join(tempRoot, '.hseos'));
  await fs.writeFile(path.join(tempRoot, '.hseos', 'generated.txt'), 'policy critical remediation generated artifact', 'utf8');

  const retrieval = await retrieveContext('policy traceability', {
    missionContext: {
      type: 'remediation',
      priority: 'critical',
      labels: ['runtime'],
      dependencies: ['policy'],
    },
    projectDir: tempRoot,
  });

  assert.equal(retrieval.results.length, 1);
  assert.equal(retrieval.results[0].layer, 'scoped');
  assert(retrieval.results[0].trace.score > 0);
  assert.equal(retrieval.missionContext.priority, 'critical');

  const impact = await impactContext('policy', {
    projectDir: tempRoot,
    relatedTerms: ['critical', 'remediation'],
  });
  const runtimeMatch = impact.matches.find((entry) => entry.file === 'runtime.js');
  assert.ok(runtimeMatch);
  assert(runtimeMatch.matchedTerms.includes('policy'));
  assert(runtimeMatch.matchedTerms.includes('critical'));
  assert.equal(impact.matches.some((entry) => entry.file.startsWith('.hseos/')), false);

  console.log('test-cortex-recall-intelligence: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
