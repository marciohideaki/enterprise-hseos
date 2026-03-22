const { buildOperationsSnapshot } = require('../lib/ops/console-read-model');

module.exports = {
  command: 'ops',
  description: 'Inspect HSEOS execution observability read models',
  arguments: [
    ['<action>', 'Operational action: summary, runs, evidence, or blockers'],
  ],
  options: [['--project-dir <path>', 'Project directory that owns the HSEOS operational data']],
  action: async (action, options) => {
    try {
      const snapshot = await buildOperationsSnapshot(options.projectDir || process.cwd());
      const normalizedAction = String(action || '').trim().toLowerCase();

      if (normalizedAction === 'summary') {
        console.log(JSON.stringify(snapshot.summary, null, 2));
        return;
      }

      if (normalizedAction === 'runs') {
        console.log(JSON.stringify(snapshot.runs, null, 2));
        return;
      }

      if (normalizedAction === 'evidence') {
        console.log(JSON.stringify(snapshot.evidence, null, 2));
        return;
      }

      if (normalizedAction === 'blockers') {
        console.log(JSON.stringify(snapshot.blockers, null, 2));
        return;
      }

      throw new Error(`Unsupported ops action: ${action}`);
    } catch (error) {
      console.error(`Execution observability command failed: ${error.message}`);
      process.exit(1);
    }
  },
};
