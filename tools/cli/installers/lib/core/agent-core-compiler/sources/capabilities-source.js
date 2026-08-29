'use strict';

const path = require('node:path');
const fs = require('fs-extra');
const yaml = require('yaml');
const { validateCapabilityDocuments, validateSurfaceDocument } = require('../../../../../lib/capability-catalog');

const CANONICAL_CAPABILITIES_DIR = path.join('.enterprise', 'governance', 'capabilities');
const REQUIRED_CAPABILITY_FILES = ['profiles.yaml', 'components.yaml', 'surfaces.yaml'];

function assertCapabilitySource(directory) {
  const documents = {};
  for (const fileName of REQUIRED_CAPABILITY_FILES) {
    const filePath = path.join(directory, fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Capability catalog source is incomplete: missing ${filePath}`);
    }
    const document = yaml.parse(fs.readFileSync(filePath, 'utf8')) || {};
    documents[fileName] = document;
    const expectedVersion = fileName === 'surfaces.yaml' ? '1.0' : '2.0';
    if (String(document.schema_version) !== expectedVersion) {
      throw new Error(`Capability catalog source requires schema_version ${expectedVersion}: ${filePath}`);
    }
  }
  validateCapabilityDocuments(documents['profiles.yaml'], documents['components.yaml']);
  validateSurfaceDocument(documents['surfaces.yaml'], documents['components.yaml']);
}

function assertCompatibleCapabilitySource(directory) {
  const documents = {};
  for (const fileName of ['profiles.yaml', 'components.yaml']) {
    const filePath = path.join(directory, fileName);
    if (!fs.existsSync(filePath)) throw new Error(`Capability catalog source is incomplete: missing ${filePath}`);
    const document = yaml.parse(fs.readFileSync(filePath, 'utf8')) || {};
    documents[fileName] = document;
    if (String(document.schema_version) !== '2.0') {
      throw new Error(`Capability catalog source requires schema_version 2.0: ${filePath}`);
    }
  }
  validateCapabilityDocuments(documents['profiles.yaml'], documents['components.yaml']);
}

function synthesizeLegacySurfaces(directory) {
  const surfacePath = path.join(directory, 'surfaces.yaml');
  if (fs.existsSync(surfacePath)) return false;
  const components = yaml.parse(fs.readFileSync(path.join(directory, 'components.yaml'), 'utf8')) || {};
  const baseline = new Set(['baseline:governance', 'baseline:entrypoints', 'baseline:skills-registry']);
  const document = {
    schema_version: '1.0',
    classifications: ['core', 'module', 'sidecar', 'candidate', 'compatibility'],
    dispositions: ['active', 'opt-in', 'pre-activation', 'retiring'],
    component_classes: Object.fromEntries(
      (components.components || []).map((component) => [component.id, baseline.has(component.id) ? 'core' : 'compatibility']),
    ),
    standalone_surfaces: [],
  };
  fs.writeFileSync(surfacePath, yaml.stringify(document), 'utf8');
  return true;
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
    source = target;
    mode = 'legacy-generated-source';
  } else if (await fs.pathExists(sourceLegacy)) {
    source = sourceLegacy;
    mode = 'legacy-source-root';
  } else {
    return { mode: 'absent', source: null, target };
  }

  if (mode.startsWith('canonical-')) assertCapabilitySource(source);
  else assertCompatibleCapabilitySource(source);
  const parent = path.dirname(target);
  await fs.ensureDir(parent);
  const transactionDir = await fs.mkdtemp(path.join(parent, '.capabilities-sync-'));
  const staged = path.join(transactionDir, 'staged');
  const previous = path.join(transactionDir, 'previous');
  let previousMoved = false;

  try {
    await fs.copy(source, staged, { overwrite: true, errorOnExist: false });
    if (!mode.startsWith('canonical-')) synthesizeLegacySurfaces(staged);
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
  assertCompatibleCapabilitySource,
  synthesizeLegacySurfaces,
  syncCapabilityCatalog,
};
