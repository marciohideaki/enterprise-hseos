const fs = require('fs-extra');
const path = require('node:path');
const yaml = require('yaml');
const {
  evaluateExecutionRequest,
  explainPolicy,
  loadPolicyFile,
  resolveProjectPolicy,
} = require('../lib/policy/engine');

async function loadPolicyContext(policyFile, options) {
  if (policyFile) {
    const loaded = await loadPolicyFile(policyFile);
    return {
      ...loaded,
      context: {
        projectRoot: path.resolve(options.projectDir || process.cwd()),
        frameworkRoot: path.resolve(__dirname, '../../..'),
        cwd: process.cwd(),
      },
    };
  }

  return resolveProjectPolicy({
    projectDir: options.projectDir || process.cwd(),
    packName: options.pack,
  });
}

async function loadRequestFile(requestFile) {
  const absolutePath = path.resolve(requestFile);
  const contents = await fs.readFile(absolutePath, 'utf8');

  if (absolutePath.endsWith('.json')) {
    return JSON.parse(contents);
  }

  return yaml.parse(contents);
}

module.exports = {
  command: 'policy',
  description: 'Validate and explain HSEOS structural execution governance packs',
  arguments: [
    ['<action>', 'Policy action: validate or explain'],
    ['[policyFile]', 'Optional policy YAML path; otherwise resolve from HSEOS configuration'],
  ],
  options: [
    ['--project-dir <path>', 'Project directory used for policy resolution and path context'],
    ['--request-file <path>', 'Optional YAML/JSON execution request to evaluate during explain'],
    ['--pack <name>', 'Override the configured execution policy pack name'],
  ],
  action: async (action, policyFile, options) => {
    const normalizedAction = String(action || '').trim().toLowerCase();
    const context = await loadPolicyContext(policyFile, options);

    if (normalizedAction === 'validate') {
      console.log(`Policy valid: ${context.policy.name}`);
      console.log(`Source: ${context.path}`);
      return;
    }

    if (normalizedAction === 'explain') {
      console.log(explainPolicy(context.policy));
      console.log(`Source: ${context.path}`);

      if (options.requestFile) {
        const request = await loadRequestFile(options.requestFile);
        const decision = evaluateExecutionRequest(request, context.policy, context.context);
        console.log('');
        console.log(`Decision: ${decision.allowed ? 'allowed' : 'denied'}`);
        if (decision.violations.length > 0) {
          console.log('Violations:');
          for (const violation of decision.violations) {
            console.log(`- ${violation}`);
          }
        }
      }
      return;
    }

    throw new Error(`Unsupported policy action: ${action}`);
  },
};
