'use strict';

const path = require('node:path');
const fs = require('fs-extra');
const yaml = require('yaml');
const { parseFrontmatter } = require('../lib/frontmatter');
const { hash } = require('../lib/hash');
const { displayPath } = require('../lib/path-resolver');
const { findFiles } = require('../lib/find-files');

function normalizeSkill(sourceContent, quickContent, metadata) {
  const source = sourceContent.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const quick = quickContent.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const parsedSource = parseFrontmatter(source);
  const parsedQuick = parseFrontmatter(quick);
  const sourceFm = parsedSource.frontmatter || {};
  const quickFm = parsedQuick.frontmatter || {};

  const preserved = {};
  const generatedKeys = new Set(['name', 'description', 'version', 'owner', 'tier', 'source', 'quick', 'portable', 'license', 'metadata']);

  for (const [key, value] of Object.entries(sourceFm)) {
    if (!generatedKeys.has(key)) preserved[key] = value;
  }

  if (sourceFm.metadata?.hseos) {
    preserved.metadata = { hseos: sourceFm.metadata.hseos };
  }

  const frontmatter = {
    ...preserved,
    name: sourceFm.name || quickFm.name || metadata.name,
    description: sourceFm.description || quickFm.description || `Use when ${metadata.name} is required`,
    version: String(sourceFm.version || quickFm.version || '1.0'),
    owner: sourceFm.metadata?.owner || sourceFm.owner || 'platform-governance',
    tier: 'full',
    source: metadata.sourcePath,
    quick: metadata.quickPath,
    portable: sourceFm.portable ?? true,
  };

  if (sourceFm.license) frontmatter.license = sourceFm.license;

  const body = parsedSource.body.trimStart();
  const quickSection = quick
    ? `\n\n## Quick Mode\n\nFor low-context activation, load \`${metadata.quickPath}\` or \`QUICK.md\` first. Load this full skill for deep analysis, violation fixing, or formal review gates.\n`
    : '';

  return {
    metadata: frontmatter,
    content: `---\n${yaml.stringify(frontmatter, { lineWidth: 0 }).trimEnd()}\n---\n\n${body}${quickSection}\n`,
  };
}

async function writeSkills(root, enterpriseSkillsDir, sourceRoot, agentsDirName) {
  const outputDir = path.join(root, agentsDirName, 'skills');
  await fs.ensureDir(outputDir);

  if (!(await fs.pathExists(enterpriseSkillsDir))) return [];

  const skillFiles = await findFiles(enterpriseSkillsDir, 'SKILL.md');
  const skills = [];

  for (const skillFile of skillFiles) {
    const relativeSource = path.relative(enterpriseSkillsDir, skillFile).replaceAll(path.sep, '/');
    const skillName = path.dirname(relativeSource).replaceAll('/', '-');
    if (!skillName || skillName === '.') continue;

    const quickFile = path.join(path.dirname(skillFile), 'SKILL-QUICK.md');
    const sourceContent = await fs.readFile(skillFile, 'utf8');
    const quickContent = (await fs.pathExists(quickFile)) ? await fs.readFile(quickFile, 'utf8') : '';
    const normalized = normalizeSkill(sourceContent, quickContent, {
      name: skillName,
      sourcePath: displayPath(root, sourceRoot, skillFile),
      quickPath: (await fs.pathExists(quickFile)) ? displayPath(root, sourceRoot, quickFile) : null,
    });

    const skillDir = path.join(outputDir, skillName);
    await fs.ensureDir(skillDir);
    const outputPath = path.join(skillDir, 'SKILL.md');
    await fs.writeFile(outputPath, normalized.content, 'utf8');

    if (quickContent) {
      await fs.writeFile(path.join(skillDir, 'QUICK.md'), quickContent.replaceAll('\r\n', '\n'), 'utf8');
    }

    skills.push({
      name: skillName,
      source: normalized.metadata.source,
      quick: normalized.metadata.quick,
      output: path.relative(root, outputPath).replaceAll(path.sep, '/'),
      hash: hash(normalized.content),
    });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { writeSkills, normalizeSkill };
