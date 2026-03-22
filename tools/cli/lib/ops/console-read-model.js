const fs = require('fs-extra');
const path = require('node:path');

async function readJsonFiles(directory, suffix = '.json') {
  if (!(await fs.pathExists(directory))) {
    return [];
  }

  const entries = await fs.readdir(directory);
  const records = [];

  for (const entry of entries) {
    if (!entry.endsWith(suffix)) {
      continue;
    }

    records.push(await fs.readJson(path.join(directory, entry)));
  }

  return records;
}

async function listFiles(directory, suffix) {
  if (!(await fs.pathExists(directory))) {
    return [];
  }

  const entries = await fs.readdir(directory);
  return entries.filter((entry) => (suffix ? entry.endsWith(suffix) : true)).map((entry) => path.join(directory, entry));
}

async function summarizeValidationLogs(validationDir) {
  const files = await listFiles(validationDir, '.log');
  const records = [];

  for (const filePath of files.sort().slice(-5)) {
    const content = await fs.readFile(filePath, 'utf8');
    records.push({
      file: path.basename(filePath),
      hasFailure: content.includes('[FAIL]'),
      hasWarning: content.includes('[WARN]'),
    });
  }

  return records;
}

async function buildOperationsSnapshot(projectDir = process.cwd()) {
  const root = path.resolve(projectDir);
  const runtimeWorkItems = path.join(root, '.hseos/data/runtime/work-items');
  const runtimeEvidence = path.join(root, '.hseos/data/runtime/evidence');
  const validationDir = path.join(root, '.logs/validation');

  const runs = await readJsonFiles(runtimeWorkItems);
  const evidenceFiles = await listFiles(runtimeEvidence);
  const validations = await summarizeValidationLogs(validationDir);

  const invalidatedRuns = runs.filter((run) => run.status === 'invalidated');
  const blockers = [
    ...invalidatedRuns.map((run) => ({
      type: 'runtime',
      id: run.id,
      reason: run.reconcile_reason || 'invalidated',
    })),
    ...validations
      .filter((validation) => validation.hasFailure)
      .map((validation) => ({
        type: 'validation',
        id: validation.file,
        reason: 'validation-failure',
      })),
  ];

  return {
    summary: {
      totalRuns: runs.length,
      invalidatedRuns: invalidatedRuns.length,
      evidenceFiles: evidenceFiles.length,
      validationLogs: validations.length,
    },
    runs,
    evidence: {
      files: evidenceFiles.map((filePath) => path.basename(filePath)),
      validations,
    },
    blockers,
  };
}

module.exports = {
  buildOperationsSnapshot,
};
