/**
 * Registry of HSEOS-installed projects for the central kanban.
 * Stored at `~/.hseos/projects.json` per-host (gitignored).
 *
 * Atomic writes via tmp + rename.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const DEFAULT_REGISTRY_PATH = path.join(os.homedir(), '.hseos', 'projects.json');

const DEFAULT_COLORS = ['#00d3ff', '#bd93f9', '#50fa7b', '#f1fa8c', '#ff79c6', '#8be9fd', '#ffb86c', '#ff5555'];

function defaultColor(index) {
  return DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}

function emptyRegistry() {
  return { version: 1, projects: [] };
}

function registryPath(override) {
  if (override) return path.resolve(override.replace(/^~/, os.homedir()));
  return process.env.HSEOS_REGISTRY_PATH || DEFAULT_REGISTRY_PATH;
}

function loadRegistry(override) {
  const p = registryPath(override);
  if (!fs.existsSync(p)) return { ...emptyRegistry(), _path: p };
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!parsed || !Array.isArray(parsed.projects)) return { ...emptyRegistry(), _path: p };
    return { version: parsed.version || 1, projects: parsed.projects, _path: p };
  } catch {
    return { ...emptyRegistry(), _path: p };
  }
}

function saveRegistry(registry, override) {
  const p = registryPath(override);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  const payload = JSON.stringify(
    { version: registry.version || 1, projects: registry.projects || [] },
    null,
    2
  );
  fs.writeFileSync(tmp, payload + '\n', 'utf8');
  fs.renameSync(tmp, p);
}

function deriveId(projectPath) {
  return path.basename(path.resolve(projectPath));
}

function projectDbPath(projectPath) {
  return path.join(path.resolve(projectPath), '.hseos', 'state', 'project.db');
}

function addProject(registry, { id, path: projectPath, label, color }) {
  if (!projectPath) throw new Error('path is required');
  const resolved = path.resolve(projectPath);
  const finalId = id || deriveId(resolved);
  if (!finalId) throw new Error('Could not derive id from path');
  const existingIdx = registry.projects.findIndex((p) => p.id === finalId);
  const entry = {
    id: finalId,
    path: resolved,
    label: label || finalId,
    color: color || defaultColor(registry.projects.length),
  };
  if (existingIdx >= 0) registry.projects[existingIdx] = entry;
  else registry.projects.push(entry);
  return entry;
}

function removeProject(registry, id) {
  const before = registry.projects.length;
  registry.projects = registry.projects.filter((p) => p.id !== id);
  return registry.projects.length < before;
}

function validate(registry) {
  return registry.projects.map((p) => {
    const dbPath = projectDbPath(p.path);
    const pathExists = fs.existsSync(p.path);
    const dbExists = fs.existsSync(dbPath);
    const status = !pathExists ? 'path-missing' : !dbExists ? 'db-missing' : 'ok';
    return { id: p.id, path: p.path, dbPath, status };
  });
}

module.exports = {
  loadRegistry,
  saveRegistry,
  addProject,
  removeProject,
  validate,
  registryPath,
  projectDbPath,
  DEFAULT_REGISTRY_PATH,
};
