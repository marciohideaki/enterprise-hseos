'use strict';
const { EngineeringControl } = require('../../tools/cli/lib/engineering-control');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { createResourceGroup } = require('../../packages/agent-isolation-attestation/executor');
let control;
process.on('message', async ({ state, root, command, now, survivor, foreignGroup }) => {
  if (foreignGroup) fs.writeFileSync(foreignGroup + '/cgroup.procs', String(process.pid));
  control = new EngineeringControl({ state, workspaces: [root] });
  control.jobs.now = () => now;
  try {
    const result = await control.jobs.worker.execute(command);
    let group, pid;
    if (survivor) {
      group = createResourceGroup();
      const child = spawn(
        '/usr/bin/python3',
        ['-c', 'import os,sys,time;open(sys.argv[1]+"/cgroup.procs","w").write(str(os.getpid()));time.sleep(120)', group],
        { stdio: 'ignore', detached: true, env: {} },
      );
      pid = child.pid;
      child.unref();
      const until = Date.now() + 5000;
      while (
        !fs
          .readFileSync(group + '/cgroup.procs', 'utf8')
          .split('\n')
          .includes(String(pid))
      ) {
        if (Date.now() > until) throw new Error('Descendant did not join its resource group');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    process.send({ result, group, pid });
  } catch (error) {
    process.send({ code: error.code || error.message });
  }
});
process.on('disconnect', () => {
  control?.close();
  process.exit(0);
});
