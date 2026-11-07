'use strict';
// Stand-in for the Podman door of the F15 L2 script, used by test/test-f15l2-campaign.js. CI cannot run a real Podman (its rootless pause
// process, `catatonit -P`, outlives the test and the repository's orphan detector fails the suite). This executor:
//  - records every call (F15L2_PODMAN_RECORD, one JSON line each);
//  - REFUSES the call unless the arguments carry the security flags the plan requires;
//  - runs the whole-file verifier locally, as a plain subprocess with no extra privilege. It cannot isolate the network by itself,
//    so it passes --accept-no-network-isolation: this proves the plumbing and the arguments, NOT the container isolation.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const record = (entry) => fs.appendFileSync(process.env.F15L2_PODMAN_RECORD, `${JSON.stringify(entry)}\n`);
const DIGEST = 'sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5';

function assertSecureArguments(args) {
  const at = (flag) => args[args.indexOf(flag) + 1];
  const problems = [];
  if (!args.includes('--network=none')) problems.push('network');
  if (!args.includes('--cap-drop=ALL')) problems.push('cap-drop');
  if (!args.includes('--pull=never')) problems.push('pull');
  if (!args.includes('--read-only')) problems.push('read-only');
  if (!/^\d+:\d+$/.test(at('--user') ?? '') || at('--user').startsWith('0:')) problems.push('user');
  if (!(Number(at('--pids-limit')) > 0)) problems.push('pids-limit');
  if (at('--security-opt') !== 'no-new-privileges') problems.push('no-new-privileges');
  if (!args.some((item) => item.endsWith(`@${DIGEST}`))) problems.push('digest');
  return problems;
}

module.exports = {
  inspect(ref) {
    record({ call: 'inspect', ref });
    return `fake-image-id|${JSON.stringify([ref])}`;
  },
  async run({ args }) {
    const problems = assertSecureArguments(args);
    record({ call: 'run', args, problems });
    if (problems.length > 0) return { status: 125, stdout: '', stderr: `refused by the fake Podman: ${problems.join(',')}` };
    const mount = (target) => args.find((item) => item.endsWith(`:${target}:ro`)).split(':')[0];
    const bundle = mount('/bundle');
    const caseDir = mount('/case');
    const result = spawnSync(process.execPath, [path.join(bundle, 'summarize-whole-file.cjs'), caseDir, '--accept-no-network-isolation'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
    });
    return { status: result.status, stdout: result.stdout };
  },
  rm(name) {
    record({ call: 'rm', name });
  },
};
