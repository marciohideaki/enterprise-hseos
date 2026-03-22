const {
  encodeContextFile,
  impactContext,
  retrieveContext,
  traceContext,
} = require('../lib/cortex/recall-intelligence');

module.exports = {
  command: 'cortex',
  description: 'Encode, retrieve, trace, and inspect HSEOS CORTEX context',
  arguments: [
    ['<action>', 'CORTEX action: encode, retrieve, trace, or impact'],
    ['<target>', 'Source file for encode, or query term for retrieve/trace/impact'],
  ],
  options: [
    ['--project-dir <path>', 'Project directory that owns the CORTEX data'],
    ['--layer <name>', 'CORTEX layer for encode: immediate, scoped, archive'],
    ['--title <text>', 'Optional title for encoded context'],
  ],
  action: async (action, target, options) => {
    try {
      const normalizedAction = String(action || '').trim().toLowerCase();

      if (normalizedAction === 'encode') {
        const record = await encodeContextFile(target, options);
        console.log(JSON.stringify(record, null, 2));
        return;
      }

      if (normalizedAction === 'retrieve') {
        console.log(JSON.stringify(await retrieveContext(target, options), null, 2));
        return;
      }

      if (normalizedAction === 'trace') {
        console.log(JSON.stringify(await traceContext(target, options), null, 2));
        return;
      }

      if (normalizedAction === 'impact') {
        console.log(JSON.stringify(await impactContext(target, options), null, 2));
        return;
      }

      throw new Error(`Unsupported cortex action: ${action}`);
    } catch (error) {
      console.error(`CORTEX command failed: ${error.message}`);
      process.exit(1);
    }
  },
};
