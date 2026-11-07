'use strict';
// Local HTTP server on 127.0.0.1 for the failure-path tests of the F15 L2 script. It is the ONLY destination those tests can reach: with
// F15L2_TEST_MODE=1 the guard accepts nothing but this origin and refuses api.openai.com, so no test ever touches the internet.
// Behaviors: `sse` (a valid answer with usage), `non-sse` (a JSON body), `no-usage` (SSE without a usage frame), `hang` (never answers).
const http = require('node:http');

function startServer(behavior) {
  const sockets = new Set();
  let received = 0;
  const server = http.createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      received += 1;
      if (behavior === 'hang') return;
      if (behavior === 'non-sse') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'not a stream' }));
        return;
      }
      const frames = [{ model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }];
      if (behavior !== 'no-usage') frames.push({ model: 'gpt-4o', choices: [], usage: { prompt_tokens: 100, completion_tokens: 5 } });
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(`${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')}data: [DONE]\n\n`);
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        url: `http://127.0.0.1:${port}/v1`,
        received: () => received,
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

module.exports = { startServer };
