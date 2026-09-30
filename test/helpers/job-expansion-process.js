'use strict';
const { EngineeringControl } = require('../../tools/cli/lib/engineering-control');
let control;
process.on('message', async ({ state, root, command }) => {
  try {
    control = new EngineeringControl({ state, workspaces: [root] });
    const result = await control.jobs.expand(command);
    process.send({ sequence: result.current_sequence });
  } catch (error) {
    process.send({ code: error.code || error.message });
  }
});
process.on('disconnect', () => {
  control?.close();
  process.exit(0);
});
