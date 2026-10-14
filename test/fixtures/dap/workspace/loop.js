const { spawn } = require('node:child_process');

spawn('/usr/bin/node', ['-e', 'setTimeout(() => {}, 600000)', process.argv[2]], { detached: true, stdio: 'ignore' }).unref();
setInterval(() => {}, 50);
