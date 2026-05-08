'use strict';

const path = require('node:path');
const fs = require('fs-extra');

async function findFiles(dir, filename) {
  const results = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findFiles(fullPath, filename)));
    } else if (entry.name === filename) {
      results.push(fullPath);
    }
  }
  return results;
}

module.exports = { findFiles };
