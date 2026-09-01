const fs = require('node:fs');
const path = require('node:path');

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);

function walk(root, query, found, depth = 0) {
  if (depth > 7 || !fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) walk(full, query, found, depth + 1);
    else if (entry.isFile() && /\.(?:[cm]?[jt]sx?|cs|md)$/.test(entry.name) && entry.name.toLowerCase().includes(query.toLowerCase()))
      found.add(full);
  }
}

function signature(file, query) {
  const content = fs.readFileSync(file, 'utf8');
  const line = content
    .split('\n')
    .find((value) => value.includes(query) && /\b(?:export\s+)?(?:function|class|const|interface|type)\b/.test(value));
  return line ? line.trim() : 'name match; signature not found';
}

module.exports = {
  command: 'capability-check <query>',
  description: 'Find governed capability candidates before implementation',
  options: [['--directory <path>', 'Repository root to search (default: current directory)']],
  action: async (query, options = {}) => {
    const root = path.resolve(options.directory || process.cwd());
    const candidates = new Set();
    const roots = [path.join(root, 'packages'), path.join(root, 'cores'), path.join(root, 'src', 'BuildingBlocks')];
    const workspace = process.env.HSEOS_CAPABILITY_WORKSPACE;
    if (workspace) roots.push(path.join(workspace, 'cores'), path.join(workspace, 'applications'));
    for (const candidateRoot of roots) walk(candidateRoot, query, candidates);
    const rows = [...candidates].sort().slice(0, 20);
    if (rows.length === 0) {
      console.log(
        `No candidate found for ${query}. Record an intake before adding an exported capability; inspect repeated local implementations for a promote candidate.`,
      );
      return;
    }
    console.log('Candidate\tLocation\tSignature\tSuggested verdict');
    for (const candidate of rows)
      console.log(`${path.basename(candidate)}\t${path.relative(root, candidate)}\t${signature(candidate, query)}\tconsume or extend`);
  },
};
