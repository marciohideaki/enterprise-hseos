'use strict';

module.exports = {
  command: 'control <action>',
  description: 'Local versioned engineering control API and client',
  options: [
    ['--config <path>', 'Server configuration with workspace allowlist and binding references'],
    ['--state <path>', 'Existing local candidate control ledger'],
    ['--url <url>', 'Loopback server URL'],
    ['--request <path>', 'Versioned JSON command'],
    ['--resource <id>', 'Task resource UUID'],
    ['--view <view>', 'status, evidence, review or session'],
    ['--after <cursor>', 'Event cursor'],
  ],
  action: async (action, options = {}) => {
    const fs = require('node:fs');
    const credential = process.env.HSEOS_CONTROL_CREDENTIAL;
    if (action === 'serve') {
      if (!options.config || Object.keys(options).some((key) => !['config', 'state'].includes(key)))
        throw new Error('serve requires config and optional state');
      const { z } = require('zod');
      const config = z
        .object({
          workspaces: z.array(z.string()).min(1),
          bindings: z.record(z.string(), z.string()).default({}),
          port: z.number().int().min(0).max(65_535).default(0),
        })
        .strict()
        .parse(JSON.parse(fs.readFileSync(options.config, 'utf8')));
      const { EngineeringControl } = require('../lib/engineering-control');
      const control = new EngineeringControl({ ...config, state: options.state });
      let server;
      try {
        server = await require('../lib/engineering-control-http').startControlServer({ control, credential, port: config.port });
      } catch (error) {
        control.close();
        throw error;
      }
      process.stdout.write(JSON.stringify({ schema_version: 1, url: server.url, state: control.state, operational: false }) + '\n');
      await new Promise((resolve) => {
        const stop = () => {
          process.off('SIGTERM', stop);
          process.off('SIGINT', stop);
          resolve();
        };
        process.once('SIGTERM', stop);
        process.once('SIGINT', stop);
      });
      await server.close();
      control.close();
      return;
    }
    const { ControlClient } = require('../../../packages/control-sdk');
    const client = new ControlClient({ url: options.url, credential });
    let result;
    switch (action) {
      case 'prepare': {
        result = await client.prepare(JSON.parse(fs.readFileSync(options.request, 'utf8')));
        break;
      }
      case 'command': {
        result = await client.execute(JSON.parse(fs.readFileSync(options.request, 'utf8')));
        break;
      }
      case 'query': {
        result = await client.query(options.resource, options.view || 'status');
        break;
      }
      case 'events': {
        result = await client.events(options.resource, { after: Number(options.after || 0) });
        break;
      }
      default: {
        throw new Error('Unknown control action');
      }
    }
    process.stdout.write(JSON.stringify(result) + '\n');
    return result;
  },
};
