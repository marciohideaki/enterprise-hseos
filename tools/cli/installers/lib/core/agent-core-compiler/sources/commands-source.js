'use strict';

const path = require('node:path');
const fs = require('fs-extra');
const yaml = require('yaml');
const csv = require('csv-parse/sync');
const { slug } = require('../lib/slug');

async function writeCommandRegistry(root, hseosDir, agentsDirName = '.agents') {
  const outputDir = path.join(root, agentsDirName, 'commands');
  await fs.ensureDir(outputDir);

  const commands = [];
  const workflowRegistry = path.join(hseosDir, 'workflows', 'registry.yaml');
  if (await fs.pathExists(workflowRegistry)) {
    const parsed = yaml.parse(await fs.readFile(workflowRegistry, 'utf8')) || {};
    const workflows = Array.isArray(parsed.workflows) ? parsed.workflows : [];
    for (const workflow of workflows) {
      if (!workflow.id && !workflow.name) continue;
      commands.push({
        name: slug(`hseos-workflow-${workflow.id || workflow.name}`),
        type: 'workflow',
        source: workflow.path || null,
        description: workflow.description || workflow.name || workflow.id,
      });
    }
  }

  const workflowManifest = path.join(hseosDir, '_config', 'workflow-manifest.csv');
  if (commands.length === 0 && (await fs.pathExists(workflowManifest))) {
    const records = csv.parse(await fs.readFile(workflowManifest, 'utf8'), {
      columns: true,
      skip_empty_lines: true,
    });
    for (const workflow of records) {
      if (!workflow.name) continue;
      commands.push({
        name: slug(`hseos-workflow-${workflow.module}-${workflow.name}`),
        type: 'workflow',
        source: workflow.path || null,
        description: workflow.description || workflow.name,
      });
    }
  }

  const manifestPath = path.join(hseosDir, 'AGENT-MANIFEST.md');
  if (await fs.pathExists(manifestPath)) {
    commands.push({
      name: 'hseos-agent-manifest',
      type: 'agent-index',
      source: path.relative(root, manifestPath).replaceAll(path.sep, '/'),
      description: 'HSEOS installed agent manifest',
    });
  }

  const registry = { version: '1.0', commands };
  await fs.writeFile(path.join(outputDir, 'registry.yaml'), yaml.stringify(registry, { lineWidth: 0 }), 'utf8');
  return commands;
}

module.exports = { writeCommandRegistry };
