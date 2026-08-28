'use strict';

const path = require('node:path');
const fs = require('fs-extra');
const yaml = require('yaml');

const CANONICAL_CAPABILITIES_DIR = path.join('.enterprise', 'governance', 'capabilities');
const REQUIRED_CAPABILITY_FILES = ['profiles.yaml', 'components.yaml'];

function assertCapabilitySource(directory) {
  for (const fileName of REQUIRED_CAPABILITY_FILES) {
    const filePath = path.join(directory, fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Capability catalog source is incomplete: missing ${filePath}`);
    }
    const document = yaml.parse(fs.readFileSync(filePath, 'utf8')) || {};
    if (String(document.schema_version) !== '2.0') {
      throw new Error(`Capability catalog source requires schema_version 2.0: ${filePath}`);
    }
  }
}

async function syncCapabilityCatalog(root, sourceRoot, agentsDirName = '.agents') {
  const target = path.join(root, agentsDirName, 'capabilities');
  const targetCanonical = path.join(root, CANONICAL_CAPABILITIES_DIR);
  const sourceCanonical = path.join(sourceRoot, CANONICAL_CAPABILITIES_DIR);
  const sourceLegacy = path.join(sourceRoot, agentsDirName, 'capabilities');

  let source;
  let mode;
  if (await fs.pathExists(targetCanonical)) {
    source = targetCanonical;
    mode = 'canonical-target';
  } else if (await fs.pathExists(sourceCanonical)) {
    source = sourceCanonical;
    mode = 'canonical-source-root';
  } else if (await fs.pathExists(target)) {
    return { mode: 'legacy-generated-source', source: target, target };
  } else if (await fs.pathExists(sourceLegacy)) {
    source = sourceLegacy;
    mode = 'legacy-source-root';
  } else {
    return { mode: 'absent', source: null, target };
  }

  assertCapabilitySource(source);
  const parent = path.dirname(target);
  await fs.ensureDir(parent);
  const transactionDir = await fs.mkdtemp(path.join(parent, '.capabilities-sync-'));
  const staged = path.join(transactionDir, 'staged');
  const previous = path.join(transactionDir, 'previous');
  let previousMoved = false;

  try {
    await fs.copy(source, staged, { overwrite: true, errorOnExist: false });
    assertCapabilitySource(staged);
    if (await fs.pathExists(target)) {
      await fs.move(target, previous);
      previousMoved = true;
    }
    await fs.move(staged, target);
    if (previousMoved) await fs.remove(previous);
  } catch (error) {
    if (previousMoved && (await fs.pathExists(target))) await fs.remove(target);
    if (previousMoved && (await fs.pathExists(previous))) await fs.move(previous, target);
    throw new Error(`Capability catalog synchronization failed: ${error.message}`);
  } finally {
    await fs.remove(transactionDir);
  }

  return { mode, source, target };
}

module.exports = {
  CANONICAL_CAPABILITIES_DIR,
  REQUIRED_CAPABILITY_FILES,
  assertCapabilitySource,
  syncCapabilityCatalog,
};
