const crypto = require('node:crypto');
const fs = require('fs-extra');
const path = require('node:path');

const LAYERS = ['immediate', 'scoped', 'archive'];

async function resolveCortexRoot(projectDir) {
  const root = path.resolve(projectDir || process.cwd());
  const cortexRoot = path.join(root, '.hseos/data/cortex');

  for (const layer of LAYERS) {
    await fs.ensureDir(path.join(cortexRoot, layer));
  }

  return {
    projectDir: root,
    cortexRoot,
  };
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
}

function scoreEntry(queryTokens, entry) {
  const haystack = tokenize([entry.title, entry.content, entry.tags?.join(' ')].join(' '));
  let score = 0;
  const matches = [];

  for (const token of queryTokens) {
    const count = haystack.filter((candidate) => candidate === token).length;
    if (count > 0) {
      score += count;
      matches.push({ token, count });
    }
  }

  return {
    score,
    matches,
  };
}

async function encodeContextFile(filePath, options = {}) {
  const layer = options.layer || 'scoped';
  if (!LAYERS.includes(layer)) {
    throw new Error(`Unsupported CORTEX layer: ${layer}`);
  }

  const sourcePath = path.resolve(filePath);
  const content = await fs.readFile(sourcePath, 'utf8');
  const { cortexRoot } = await resolveCortexRoot(options.projectDir);
  const encodedAt = new Date().toISOString();
  const id = options.id || crypto.createHash('sha1').update(`${sourcePath}:${encodedAt}`).digest('hex').slice(0, 12);
  const record = {
    id,
    layer,
    title: options.title || path.basename(sourcePath),
    sourcePath,
    content,
    tags: options.tags || [],
    encodedAt,
  };

  await fs.writeJson(path.join(cortexRoot, layer, `${id}.json`), record, { spaces: 2 });
  return record;
}

async function loadAllEntries(projectDir) {
  const { cortexRoot } = await resolveCortexRoot(projectDir);
  const entries = [];

  for (const layer of LAYERS) {
    const layerDir = path.join(cortexRoot, layer);
    const files = await fs.readdir(layerDir);
    for (const file of files) {
      if (!file.endsWith('.json')) {
        continue;
      }

      const record = await fs.readJson(path.join(layerDir, file));
      entries.push(record);
    }
  }

  return entries;
}

async function retrieveContext(query, options = {}) {
  const entries = await loadAllEntries(options.projectDir);
  const queryTokens = tokenize(query);
  const scored = entries
    .map((entry) => {
      const trace = scoreEntry(queryTokens, entry);
      return {
        ...entry,
        trace,
      };
    })
    .filter((entry) => entry.trace.score > 0)
    .sort((left, right) => right.trace.score - left.trace.score)
    .slice(0, options.limit || 5);

  return {
    query,
    results: scored,
  };
}

async function traceContext(query, options = {}) {
  return retrieveContext(query, options);
}

async function impactContext(term, options = {}) {
  const projectDir = path.resolve(options.projectDir || process.cwd());
  const matches = [];

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      const content = await fs.readFile(fullPath, 'utf8').catch(() => null);
      if (!content || !content.includes(term)) {
        continue;
      }

      matches.push(path.relative(projectDir, fullPath));
    }
  }

  await walk(projectDir);
  return {
    term,
    matches: matches.slice(0, options.limit || 20),
  };
}

module.exports = {
  encodeContextFile,
  impactContext,
  retrieveContext,
  resolveCortexRoot,
  traceContext,
};
