'use strict';

module.exports = {
  command: 'control <action>',
  description: 'Local versioned engineering control API and client',
  options: [
    ['--config <path>', 'Server configuration with workspace allowlist and binding references'],
    ['--state <path>', 'Existing local candidate control ledger'],
    ['--url <url>', 'Loopback server URL'],
    ['--request <path>', 'Versioned JSON command'],
    ['--resource <id>', 'Task or campaign resource UUID'],
    ['--binding <id>', 'Provider binding identity'],
    ['--view <view>', 'status, evidence, review or session'],
    ['--after <cursor>', 'Event cursor'],
  ],
  action: async (action, options = {}) => {
    const fs = require('node:fs');
    const credential = process.env.HSEOS_CONTROL_CREDENTIAL;
    if (action === 'serve') {
      if (!options.config || Object.keys(options).some((key) => !['config', 'state'].includes(key)))
        throw new Error('serve requires config and optional state');
      const config = require('../lib/control-configuration').loadControlConfiguration(options.config, {
        state: options.state,
        adapterFactories: {
          [require('../lib/provider-api-adapter').API_ADAPTER_ID]: require('../lib/provider-api-adapter').createApiCampaignAdapter,
          'hseos-codex-campaign-v1': require('../lib/provider-native-adapter').createNativeCampaignAdapter,
          'hseos-codex-acp-campaign-v1': require('../lib/provider-acp-adapter').createAcpCampaignAdapter,
          'hseos-claude-campaign-v1': require('../lib/provider-native-adapter').createNativeCampaignAdapter,
          'hseos-antigravity-campaign-v1': require('../lib/provider-antigravity-adapter').createAntigravityCampaignAdapter,
        },
      });
      const { EngineeringControl } = require('../lib/engineering-control');
      const control = new EngineeringControl(config);
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
      await control.providerCampaigns.shutdown();
      await control.terminals.shutdown();
      await server.close();
      control.close();
      return;
    }
    if (action === 'adapters') {
      const api = require('../lib/provider-api-adapter');
      const result = {
        schema_version: 1,
        implemented: [
          {
            adapter: api.API_ADAPTER_ID,
            version: api.API_ADAPTER_VERSION,
            artifact_sha256: api.adapterArtifactDigest(),
            vendor: 'deepseek',
            route: 'api',
            provider_kind: 'model',
            identity_kind: 'credential',
            session_resume: false,
            real_conformance: 'not_certified',
          },
          ...['codex', 'claude'].map((vendor) => ({
            adapter: `hseos-${vendor}-campaign-v1`,
            vendor,
            artifact_sha256: require('../lib/provider-native-adapter').nativeArtifactDigest(),
            route: vendor === 'codex' ? 'account' : 'api',
            provider_kind: 'client',
            session_resume: true,
            real_conformance: 'not_certified',
          })),
          {
            adapter: 'hseos-antigravity-campaign-v1',
            vendor: 'antigravity',
            route: 'local',
            provider_kind: 'client',
            artifact_sha256: require('../lib/provider-antigravity-adapter').antigravityArtifactDigest(),
            session_resume: true,
            real_conformance: 'not_certified',
          },
        ],
        pending_campaign_adapters: [],
        pending_real_conformance: ['codex', 'claude', 'deepseek', 'antigravity'],
      };
      process.stdout.write(JSON.stringify(result) + '\n');
      return result;
    }
    const { ControlClient } = require('../../../packages/control-sdk');
    const client = new ControlClient({ url: options.url, credential });
    let result;
    switch (action) {
      case 'binding-inspect': {
        result = await client.bindingInspect(options.binding);
        break;
      }
      case 'campaign-run': {
        result = await require('../lib/provider-campaign-runner').runProviderCampaign(
          client,
          JSON.parse(fs.readFileSync(options.request, 'utf8')),
        );
        break;
      }
      case 'campaign-command': {
        result = await client.campaign(JSON.parse(fs.readFileSync(options.request, 'utf8')));
        break;
      }
      case 'campaign-query': {
        result = await client.campaignQuery(options.resource);
        break;
      }
      case 'campaign-events': {
        result = await client.campaignEvents(options.resource, { after: Number(options.after || 0) });
        break;
      }
      case 'terminal-attach': {
        await require('../lib/terminal-attach').attachTerminal(client, options.resource, { after: Number(options.after || 0) });
        return;
      }
      case 'terminal-command': {
        result = await client.terminal(JSON.parse(fs.readFileSync(options.request, 'utf8')));
        break;
      }
      case 'terminal-query': {
        result = await client.terminalQuery(options.resource);
        break;
      }
      case 'terminal-events': {
        result = await client.terminalEvents(options.resource, { after: Number(options.after || 0) });
        break;
      }
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
