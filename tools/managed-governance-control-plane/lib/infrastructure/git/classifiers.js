'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const yaml = require('yaml');
const { canonicalize } = require('../../../../../packages/managed-governance-contracts');

function slugify(value) {
  return value
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 120);
}

function markdownStructure(content) {
  const headings = [];
  for (const line of content.split('\n')) {
    const match = /^(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(line);
    if (match) headings.push({ level: match[1].length, title: match[2] });
  }
  return {
    format: 'markdown',
    title: headings.find((heading) => heading.level === 1)?.title || null,
    headings,
  };
}

function structuredDocument(content, extension) {
  const document = yaml.parseDocument(content, {
    customTags: [],
    maxAliasCount: 0,
    schema: 'core',
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) throw new Error('structured source is not valid or has duplicate keys');
  if (extension === '.json') JSON.parse(content);
  const value = document.toJS({ maxAliasCount: 0 });
  canonicalize(value);
  return { format: extension === '.json' ? 'json' : 'yaml', value };
}

function artifactTypeForKind(sourceKind) {
  const mapping = {
    constitution: 'constitution',
    standard: 'standard',
    'stack-standard': 'standard',
    adr: 'adr',
    policy: 'policy',
    capability: 'capability',
    hook: 'hook',
    workflow: 'workflow',
    skill: 'skill',
  };
  return mapping[sourceKind] || 'unclassified';
}

function artifactIdFor(entry, artifactType) {
  if (artifactType === 'constitution') return 'enterprise-constitution';
  const withoutExtension = entry.source_path.replaceAll(/\.[^./]+$/g, '');
  const logicalPath = artifactType === 'skill' ? path.posix.dirname(withoutExtension) : withoutExtension;
  const slug = slugify(logicalPath);
  if (!slug) return null;
  const suffix = crypto.createHash('sha256').update(logicalPath, 'utf8').digest('hex').slice(0, 12);
  return `${artifactType}:${slug}:${suffix}`;
}

function classifySource(entry) {
  const artifactType = artifactTypeForKind(entry.source_kind);
  const extension = path.posix.extname(entry.source_path).toLowerCase();
  const issues = [];
  let structuredContent;
  let classificationStatus = artifactType === 'unclassified' ? 'unclassified' : 'classified';

  try {
    if (extension === '.md') structuredContent = markdownStructure(entry.normalized_content);
    else if (['.yaml', '.yml', '.json'].includes(extension)) structuredContent = structuredDocument(entry.normalized_content, extension);
    else {
      structuredContent = {
        format: extension === '.sh' ? 'shell' : 'javascript',
        executable: false,
      };
    }
  } catch {
    classificationStatus = 'partial';
    structuredContent = { format: extension.slice(1) || 'unknown', parse_status: 'invalid' };
    issues.push({
      code: 'source.parse_failed',
      path: entry.source_path,
      message: 'Source is preserved but requires review because structured parsing failed',
      severity: 'error',
    });
  }

  const artifactId = artifactIdFor(entry, artifactType);
  if (!artifactId || artifactType === 'unclassified') {
    classificationStatus = 'unclassified';
    issues.push({
      code: 'source.classification_required',
      path: entry.source_path,
      message: 'Source has no deterministic artifact classification and requires review',
      severity: 'warning',
    });
  }

  return Object.freeze({
    artifact_id: artifactId,
    artifact_type: artifactType,
    classification_status: classificationStatus,
    structured_content: Object.freeze(structuredContent),
    issues: Object.freeze(issues),
  });
}

module.exports = {
  classifySource,
};
