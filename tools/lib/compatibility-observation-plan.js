'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertNoSymlinkAncestors(target) {
  const resolved = path.resolve(target);
  const root = path.parse(resolved).root;
  let current = root;
  for (const component of resolved.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error('Observation schedule path must not traverse a symlink');
    }
  }
}

function assertAbsoluteRegularFile(filename, label, { executable = false } = {}) {
  if (!path.isAbsolute(filename || '')) throw new TypeError(`${label} must be absolute`);
  assertNoSymlinkAncestors(filename);
  const metadata = fs.lstatSync(filename);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error(`${label} must be a regular, non-linked file`);
  }
  if (executable && process.platform !== 'win32' && (metadata.mode & 0o111) === 0) {
    throw new Error(`${label} must be executable`);
  }
}

function assertProjectDirectory(projectDirectory) {
  if (!path.isAbsolute(projectDirectory || '')) throw new TypeError('Project directory must be absolute');
  assertNoSymlinkAncestors(projectDirectory);
  const metadata = fs.lstatSync(projectDirectory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Project directory must be a real directory');
}

function assertEvidenceDirectory(projectDirectory, evidenceDirectory) {
  if (!path.isAbsolute(evidenceDirectory || '')) throw new TypeError('Evidence directory must be absolute');
  assertNoSymlinkAncestors(evidenceDirectory);
  const stateDirectory = path.join(projectDirectory, '.hseos', 'state');
  if (isWithin(stateDirectory, evidenceDirectory)) {
    throw new Error('Evidence directory must be outside the operational state directory');
  }
  if (!fs.existsSync(evidenceDirectory)) return;
  const metadata = fs.lstatSync(evidenceDirectory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Evidence directory must be a real directory');
  if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) {
    throw new Error('Evidence directory must not be accessible by group or other users');
  }
}

function hasControlCharacters(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || codePoint === 127;
  });
}

function systemdQuote(value) {
  if (typeof value !== 'string' || value.length === 0 || hasControlCharacters(value)) {
    throw new TypeError('Systemd argument must be a non-empty string without control characters');
  }
  return `"${value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', () => String.raw`\"`)
    .replaceAll('$', () => '$$')
    .replaceAll('%', '%%')}"`;
}

function systemdEscapeDirectiveValue(value) {
  if (typeof value !== 'string' || value.length === 0 || hasControlCharacters(value)) {
    throw new TypeError('Systemd directive value must be a non-empty string without control characters');
  }
  return [...Buffer.from(value)]
    .map((byte) => {
      const character = String.fromCodePoint(byte);
      return /[A-Za-z0-9_./:@+-]/u.test(character) ? character : String.raw`\x${byte.toString(16).padStart(2, '0')}`;
    })
    .join('');
}

function renderSystemdUnits({ unitBase, projectDirectory, evidenceDirectory, nodeExecutable, cliPath, minuteUtc }) {
  const manifestPath = path.join(projectDirectory, '.hseos', 'state', 'harness-g9-observation-release.json');
  const serviceName = `${unitBase}.service`;
  const timerName = `${unitBase}.timer`;
  const execStart = [
    nodeExecutable,
    cliPath,
    'compatibility-observe',
    '--directory',
    projectDirectory,
    '--evidence-directory',
    evidenceDirectory,
    '--json',
    '--require-current-hour',
  ]
    .map(systemdQuote)
    .join(' ');
  const service = [
    '[Unit]',
    'Description=Capture bound HSEOS compatibility observation evidence',
    `ConditionPathExists=${systemdEscapeDirectiveValue(manifestPath)}`,
    `ConditionPathIsDirectory=${systemdEscapeDirectiveValue(evidenceDirectory)}`,
    '',
    '[Service]',
    'Type=oneshot',
    `WorkingDirectory=${systemdEscapeDirectiveValue(projectDirectory)}`,
    'Environment=HSEOS_DISABLE_UPDATE_CHECK=1',
    `ExecStart=${execStart}`,
    'UMask=0077',
    'NoNewPrivileges=true',
    'PrivateTmp=true',
    'ProtectSystem=strict',
    `ReadWritePaths=${systemdEscapeDirectiveValue(evidenceDirectory)}`,
    'ProtectKernelTunables=true',
    'ProtectControlGroups=true',
    'RestrictSUIDSGID=true',
    'LockPersonality=true',
    'RestrictAddressFamilies=AF_UNIX',
    'IPAddressDeny=any',
    'StandardOutput=journal',
    'StandardError=journal',
    '',
  ].join('\n');
  const timer = [
    '[Unit]',
    'Description=Capture HSEOS compatibility observation evidence hourly',
    '',
    '[Timer]',
    `OnCalendar=*-*-* *:${String(minuteUtc).padStart(2, '0')}:00 UTC`,
    'Persistent=true',
    'AccuracySec=1min',
    'RandomizedDelaySec=0',
    `Unit=${serviceName}`,
    '',
    '[Install]',
    'WantedBy=timers.target',
    '',
  ].join('\n');
  return Object.freeze({ service_name: serviceName, timer_name: timerName, service, timer });
}

function buildCompatibilityObservationSchedulePlan({
  projectDirectory,
  evidenceDirectory,
  nodeExecutable = process.execPath,
  cliPath,
  minuteUtc = 20,
}) {
  if (!path.isAbsolute(projectDirectory || '')) throw new TypeError('Project directory must be absolute');
  if (!path.isAbsolute(evidenceDirectory || '')) throw new TypeError('Evidence directory must be absolute');
  if (!path.isAbsolute(nodeExecutable || '')) throw new TypeError('Node executable must be absolute');
  if (!path.isAbsolute(cliPath || '')) throw new TypeError('HSEOS CLI must be absolute');
  const resolvedProject = path.resolve(projectDirectory);
  const resolvedEvidence = path.resolve(evidenceDirectory);
  const resolvedNode = path.resolve(nodeExecutable);
  const resolvedCli = path.resolve(cliPath);
  if (!Number.isInteger(minuteUtc) || minuteUtc < 0 || minuteUtc > 59) {
    throw new TypeError('Observation minute must be an integer from 0 through 59');
  }
  assertProjectDirectory(resolvedProject);
  assertEvidenceDirectory(resolvedProject, resolvedEvidence);
  assertAbsoluteRegularFile(resolvedNode, 'Node executable', { executable: true });
  assertAbsoluteRegularFile(resolvedCli, 'HSEOS CLI');
  const instanceId = createHash('sha256').update(resolvedProject).digest('hex').slice(0, 12);
  const unitBase = `hseos-compatibility-observe-${instanceId}`;
  const systemd = renderSystemdUnits({
    unitBase,
    projectDirectory: resolvedProject,
    evidenceDirectory: resolvedEvidence,
    nodeExecutable: resolvedNode,
    cliPath: resolvedCli,
    minuteUtc,
  });
  return Object.freeze({
    schema_version: 1,
    plan_only: true,
    activation_authorized: false,
    instance_id: instanceId,
    schedule: { kind: 'hourly', minute_utc: minuteUtc, persistent: true },
    project_directory: resolvedProject,
    evidence_directory: resolvedEvidence,
    command: {
      executable: resolvedNode,
      arguments: [
        resolvedCli,
        'compatibility-observe',
        '--directory',
        resolvedProject,
        '--evidence-directory',
        resolvedEvidence,
        '--json',
        '--require-current-hour',
      ],
      environment: { HSEOS_DISABLE_UPDATE_CHECK: '1' },
    },
    prerequisites: [
      'Create the evidence directory with mode 0700 before activation.',
      'Independently verify the generated unit files on the target host.',
      'Obtain explicit operational authorization before installing or enabling the timer.',
    ],
    rollback: [
      `Disable and remove ${systemd.timer_name} and ${systemd.service_name}.`,
      'Preserve the evidence directory and supervising journal as audit records.',
    ],
    systemd,
  });
}

module.exports = { buildCompatibilityObservationSchedulePlan, renderSystemdUnits, systemdEscapeDirectiveValue, systemdQuote };
