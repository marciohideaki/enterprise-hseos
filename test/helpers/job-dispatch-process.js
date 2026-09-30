'use strict';
const { EngineeringControl } = require('../../tools/cli/lib/engineering-control');
process.once('message', async ({ state, root, fault }) => {
  const control = new EngineeringControl({ state, workspaces: [root] });
  if (fault) {
    const runtime = require('../../tools/cli/lib/engineering-task-runtime');
    const original = runtime.executeJobTask;
    runtime.executeJobTask = async (...args) => {
      if (fault === 'after-effect') await original(...args);
      process.send({ boundary: fault });
      await new Promise(() => {});
    };
  }
  try {
    await control.jobs.dispatcher.tick();
    process.send({ done: true });
  } catch (error) {
    process.send({ error: error.code || error.message });
  }
});
