'use strict';
// Local HTTP server on 127.0.0.1 for the failure-path tests of the F15 L2 script. It is the ONLY destination those tests can reach: with
// F15L2_TEST_MODE=1 the guard accepts nothing but this origin and refuses api.openai.com, so no test ever touches the internet.
// Behaviors: `sse` (a valid answer with usage, served as the dated snapshot), `non-sse` (a JSON body), `no-usage` (SSE without a usage frame),
// `hang` (never answers), `diverge` (answers with another snapshot) and `no-model` (frames that name no model).
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
      // Shape of a real stream: role chunk, content, finish chunk with an empty delta, and a LAST frame with choices [] and usage.
      const served = behavior === 'diverge' ? 'gpt-4o-2024-11-20' : 'gpt-4o-2024-08-06';
      const frame = (extra) => ({
        id: 'chatcmpl-localtest',
        object: 'chat.completion.chunk',
        created: 1_762_500_000,
        ...(behavior === 'no-model' ? {} : { model: served }),
        service_tier: 'default',
        system_fingerprint: 'fp_f15l2localtest',
        ...extra,
      });
      const frames = [
        frame({ choices: [{ index: 0, delta: { role: 'assistant', content: '', refusal: null }, logprobs: null, finish_reason: null }] }),
        frame({ choices: [{ index: 0, delta: { content: 'ok' }, logprobs: null, finish_reason: null }] }),
        frame({ choices: [{ index: 0, delta: {}, logprobs: null, finish_reason: 'stop' }] }),
      ];
      if (behavior !== 'no-usage')
        frames.push(frame({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 } }));
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
