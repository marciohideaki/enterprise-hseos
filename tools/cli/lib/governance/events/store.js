const fs = require('fs-extra');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { resolveHseosDataPaths } = require('../../hseos-data');

function buildEventFileName(event) {
  const timestamp = String(event.timestamp || new Date().toISOString()).replaceAll(':', '').replaceAll('.', '');
  return `${timestamp}-${event.type}-${event.id}.json`;
}

async function readGovernanceEvents(projectDir = process.cwd()) {
  const paths = await resolveHseosDataPaths(projectDir);
  if (!(await fs.pathExists(paths.governanceEventsRoot))) {
    return [];
  }

  const entries = await fs.readdir(paths.governanceEventsRoot);
  const events = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue;
    }
    events.push(await fs.readJson(path.join(paths.governanceEventsRoot, entry)));
  }

  return events.sort((left, right) => String(right.timestamp).localeCompare(String(left.timestamp)));
}

async function writeGovernanceEvent(projectDir, event) {
  const paths = await resolveHseosDataPaths(projectDir);
  await fs.ensureDir(paths.governanceEventsRoot);

  const payload = {
    id: event.id || randomUUID(),
    type: event.type,
    source: event.source || 'unknown',
    status: event.status || 'open',
    severity: event.severity || 'info',
    sessionId: event.sessionId || null,
    workerId: event.workerId || null,
    policyPack: event.policyPack || null,
    summary: event.summary || null,
    payload: event.payload || {},
    timestamp: event.timestamp || new Date().toISOString(),
    acknowledgedAt: event.acknowledgedAt || null,
    acknowledgedBy: event.acknowledgedBy || null,
    acknowledgedReason: event.acknowledgedReason || null,
  };

  const filePath = path.join(paths.governanceEventsRoot, buildEventFileName(payload));
  await fs.writeJson(filePath, payload, { spaces: 2 });
  return payload;
}

async function findGovernanceEvent(projectDir, eventId) {
  const events = await readGovernanceEvents(projectDir);
  const event = events.find((entry) => entry.id === eventId);
  if (!event) {
    throw new Error(`Governance event not found: ${eventId}`);
  }

  return event;
}

async function acknowledgeGovernanceEvent(projectDir, eventId, options = {}) {
  const event = await findGovernanceEvent(projectDir, eventId);
  const paths = await resolveHseosDataPaths(projectDir);
  const entries = await fs.readdir(paths.governanceEventsRoot);
  const fileName = entries.find((entry) => entry.endsWith(`${event.id}.json`));

  if (!fileName) {
    throw new Error(`Governance event file not found for: ${eventId}`);
  }

  const nextEvent = {
    ...event,
    status: 'acknowledged',
    acknowledgedAt: new Date().toISOString(),
    acknowledgedBy: options.actor || 'operator',
    acknowledgedReason: options.reason || null,
  };

  await fs.writeJson(path.join(paths.governanceEventsRoot, fileName), nextEvent, { spaces: 2 });
  return nextEvent;
}

function explainGovernanceEvent(event) {
  return [
    `Event: ${event.id}`,
    `Type: ${event.type}`,
    `Status: ${event.status}`,
    `Severity: ${event.severity}`,
    `Source: ${event.source}`,
    `Session: ${event.sessionId || '(none)'}`,
    `Worker: ${event.workerId || '(none)'}`,
    `Policy pack: ${event.policyPack || '(none)'}`,
    `Summary: ${event.summary || '(none)'}`,
    `Timestamp: ${event.timestamp}`,
  ].join('\n');
}

module.exports = {
  acknowledgeGovernanceEvent,
  explainGovernanceEvent,
  findGovernanceEvent,
  readGovernanceEvents,
  writeGovernanceEvent,
};
