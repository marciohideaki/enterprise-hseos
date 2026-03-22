const fs = require('fs-extra');
const path = require('node:path');
const yaml = require('yaml');

async function loadYamlIfExists(filePath) {
  if (!(await fs.pathExists(filePath))) {
    return null;
  }

  return yaml.parse(await fs.readFile(filePath, 'utf8'));
}

function getFrameworkRoot() {
  return path.resolve(__dirname, '../../..');
}

async function resolveHseosDataPaths(projectDir = process.cwd()) {
  const frameworkRoot = getFrameworkRoot();
  const root = path.resolve(projectDir);
  const projectConfig = await loadYamlIfExists(path.join(root, '.hseos/config/hseos.config.yaml'));
  const frameworkConfig = await loadYamlIfExists(path.join(frameworkRoot, '.hseos/config/hseos.config.yaml'));
  const config = projectConfig || frameworkConfig || {};
  const dataRelativePath = config.paths?.data || '.hseos/data';
  const dataRoot = path.resolve(root, dataRelativePath);

  return {
    frameworkRoot,
    projectDir: root,
    dataRoot,
    runtimeRoot: path.join(dataRoot, 'runtime'),
    sessionRoot: path.join(dataRoot, 'sessions'),
    installRoot: path.join(dataRoot, 'install'),
    governanceRoot: path.join(dataRoot, 'governance'),
    governanceEventsRoot: path.join(dataRoot, 'governance', 'events'),
  };
}

module.exports = {
  resolveHseosDataPaths,
};
