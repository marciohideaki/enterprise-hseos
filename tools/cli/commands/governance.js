const {
  acknowledgeGovernanceEvent,
  explainGovernanceEvent,
  findGovernanceEvent,
  readGovernanceEvents,
} = require('../lib/governance/events/store');

module.exports = {
  command: 'governance',
  description: 'Inspect and acknowledge HSEOS governance events',
  arguments: [
    ['<action>', 'Governance action: events'],
    ['[target]', 'Event subaction: list, inspect, ack, or explain'],
    ['[subtarget]', 'Event id for inspect/ack/explain'],
  ],
  options: [
    ['--project-dir <path>', 'Project directory that owns the HSEOS governance data'],
    ['--actor <name>', 'Operator identity recorded for event acknowledgement'],
    ['--reason <text>', 'Reason recorded for event acknowledgement'],
  ],
  action: async (action, target, subtarget, options) => {
    const projectDir = options.projectDir || process.cwd();
    const normalizedAction = String(action || '').trim().toLowerCase();
    const normalizedTarget = String(target || '').trim().toLowerCase();

    if (normalizedAction !== 'events') {
      throw new Error(`Unsupported governance action: ${action}`);
    }

    if (normalizedTarget === 'list') {
      console.log(JSON.stringify(await readGovernanceEvents(projectDir), null, 2));
      return;
    }

    if (normalizedTarget === 'inspect') {
      console.log(JSON.stringify(await findGovernanceEvent(projectDir, subtarget), null, 2));
      return;
    }

    if (normalizedTarget === 'ack') {
      console.log(JSON.stringify(await acknowledgeGovernanceEvent(projectDir, subtarget, {
        actor: options.actor,
        reason: options.reason,
      }), null, 2));
      return;
    }

    if (normalizedTarget === 'explain') {
      console.log(explainGovernanceEvent(await findGovernanceEvent(projectDir, subtarget)));
      return;
    }

    throw new Error(`Unsupported governance event action: ${target}`);
  },
};
