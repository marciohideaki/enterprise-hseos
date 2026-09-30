// CI-only setup inside a fresh systemd service with DelegateSubgroup=tests.
import fs from 'node:fs';
import path from 'node:path';
import executor from '../../packages/agent-isolation-attestation/executor.js';

const entry = fs.readFileSync('/proc/self/cgroup', 'utf8').trim();
if (!/^0::\/[^\n]+\.service\/tests$/.test(entry)) throw new Error('A dedicated delegated test service is required');
const parent = path.dirname(path.join('/sys/fs/cgroup', entry.slice(3)));
if (fs.statSync(parent).uid !== process.getuid()) throw new Error('The test service must own its delegated cgroup');
fs.writeFileSync(path.join(parent, 'cgroup.subtree_control'), '+memory +pids');
executor.executorOwner();
console.log('Delegated test cgroup controllers verified');
