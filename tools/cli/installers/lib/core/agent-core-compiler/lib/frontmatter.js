'use strict';

const yaml = require('yaml');

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  try {
    return { frontmatter: yaml.parse(match[1]) || {}, body: match[2] };
  } catch {
    return { frontmatter: {}, body: content };
  }
}

module.exports = { parseFrontmatter };
