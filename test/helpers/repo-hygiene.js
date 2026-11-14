'use strict';

const { execFileSync } = require('node:child_process');

const POLICY_PATH = 'docs/hygiene/repo-hygiene-policy.json';
const HOW_TO_CHANGE = `se for intencional, altere \`${POLICY_PATH}\` em PR revisada`;

function trackedFiles(root) {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  return output.split('\0').filter(Boolean);
}

function checkRepoHygiene({ files, policy, readFile }) {
  const violations = [];
  const add = (rule, path, message) => violations.push({ rule, path, message });
  const tracked = new Set(files);
  const allowedRoots = new Set(policy.allowedRoots);
  const runsPrefix = `${policy.runsRoot.replace(/\/+$/, '')}/`;
  const evolutionPrefix = 'docs/evolution/';
  const evolutionAllowed = new Set(policy.docsEvolutionEntries);
  const reportedRoots = new Set();
  const reportedEvolution = new Set();
  const runDirs = new Set();

  for (const file of files) {
    const slash = file.indexOf('/');
    const root = slash === -1 ? file : `${file.slice(0, slash)}/`;
    if (!allowedRoots.has(root) && !reportedRoots.has(root)) {
      reportedRoots.add(root);
      add(
        'root-not-allowed',
        file,
        `a raiz \`${root}\` nao esta em allowedRoots; mova o arquivo para uma raiz existente ou adicione a raiz a \`allowedRoots\` em \`${POLICY_PATH}\` (${HOW_TO_CHANGE})`,
      );
    }

    if (file.startsWith(runsPrefix)) {
      const parts = file.slice(runsPrefix.length).split('/');
      if (parts.length <= 2) {
        add(
          'loose-run-file',
          file,
          `arquivo solto em \`${policy.runsRoot}\`; registros de run ficam em \`${policy.runsRoot}/<categoria>/<run>/\`; mova-o para a pasta da run ou remova-o`,
        );
      } else {
        runDirs.add(`${runsPrefix}${parts[0]}/${parts[1]}/`);
      }
    }

    if (file.startsWith(evolutionPrefix)) {
      const rest = file.slice(evolutionPrefix.length);
      const sep = rest.indexOf('/');
      const entry = sep === -1 ? rest : `${rest.slice(0, sep)}/`;
      if (!evolutionAllowed.has(entry) && !reportedEvolution.has(entry)) {
        reportedEvolution.add(entry);
        add(
          'docs-evolution-entry',
          file,
          `a entrada \`${entry}\` de \`docs/evolution/\` nao esta em docsEvolutionEntries; mova o conteudo para fora de docs/evolution ou adicione a entrada em \`${POLICY_PATH}\` (${HOW_TO_CHANGE})`,
        );
      }
    }
  }

  for (const dir of [...runDirs].sort()) {
    if (!tracked.has(`${dir}STATUS.md`)) {
      add(
        'run-without-status',
        dir,
        `a run \`${dir}\` tem arquivos versionados mas nao tem \`STATUS.md\`; crie o STATUS.md da run ou remova a run`,
      );
    }
  }

  for (const manifest of policy.removalManifests) {
    let content;
    try {
      content = readFile(manifest);
    } catch (error) {
      add(
        'removed-path-returned',
        manifest,
        `manifest de remocao ilegivel (${error.code || error.message}); o guard falha fechado: restaure o manifest ou retire-o de removalManifests em \`${POLICY_PATH}\` (${HOW_TO_CHANGE})`,
      );
      continue;
    }
    const lines = content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      add(
        'removed-path-returned',
        manifest,
        `manifest de remocao vazio; o guard falha fechado: restaure a lista ou retire o manifest de removalManifests em \`${POLICY_PATH}\` (${HOW_TO_CHANGE})`,
      );
    }
    for (const removed of lines) {
      if (removed && tracked.has(removed)) {
        add(
          'removed-path-returned',
          removed,
          `caminho removido por \`${manifest}\` voltou a ser versionado; remova-o de novo (git rm) ou, se o retorno for intencional, retire a linha do manifest em PR revisada`,
        );
      }
    }
  }

  return violations;
}

module.exports = { checkRepoHygiene, trackedFiles, POLICY_PATH };
