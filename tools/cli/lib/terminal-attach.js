'use strict';
const { randomUUID } = require('node:crypto');

/** Explicit interactive adapter; control-] detaches without terminating the job. */
async function attachTerminal(client, id, { after = 0, input = process.stdin, output = process.stdout } = {}) {
  let state = await client.terminalQuery(id);
  let stopped = false;
  let failure;
  let pending = Promise.resolve();
  const wasRaw = input.isRaw;
  let rawModeEnabled = false;
  const mutate = (action, value = {}) => {
    if (stopped) return;
    pending = pending
      .then(async () => {
        if (failure) return;
        state = await client.terminalQuery(id);
        const result = await client.terminal({
          schema_version: 1,
          command_id: randomUUID(),
          resource_id: id,
          expected_sequence: state.current_sequence,
          action,
          input: value,
        });
        if (action === 'input' && result.effect?.bytes !== Buffer.from(value.data, 'base64').length) {
          const error = new Error('Terminal accepted incomplete input; inspect the receipt before sending more data');
          error.code = 'CONTROL_TERMINAL_INPUT_PARTIAL';
          throw error;
        }
      })
      .catch((error) => {
        failure = error;
        stopped = true;
      });
  };
  const data = (buffer) => {
    if (buffer.length === 1 && buffer[0] === 29) {
      stopped = true;
      return;
    }
    if (buffer.length === 1 && buffer[0] === 3) {
      mutate('interrupt');
      return;
    }
    if (buffer.length === 1 && buffer[0] === 4) {
      mutate('eof');
      return;
    }
    for (let offset = 0; offset < buffer.length; offset += 4096)
      mutate('input', { data: buffer.subarray(offset, offset + 4096).toString('base64') });
  };
  const resize = () => {
    if (state.mode === 'pty') mutate('resize', { rows: Math.min(500, output.rows || 24), cols: Math.min(500, output.columns || 80) });
  };
  const end = () => mutate('eof');
  const stop = () => {
    stopped = true;
  };
  try {
    input.on('data', data);
    input.on('end', end);
    output.on('resize', resize);
    process.on('SIGTERM', stop);
    if (input.isTTY) {
      input.setRawMode(true);
      rawModeEnabled = true;
    }
    input.resume();
    while (!stopped) {
      const batch = await client.terminalEvents(id, { after });
      for (const event of batch.events) if (event.payload.kind === 'output') output.write(Buffer.from(event.payload.data, 'base64'));
      after = batch.next_cursor;
      state = await client.terminalQuery(id);
      if (state.descendants_terminated && after >= state.current_sequence) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await pending;
    if (failure) throw failure;
    return { next_cursor: after };
  } finally {
    input.off('data', data);
    input.off('end', end);
    output.off('resize', resize);
    process.off('SIGTERM', stop);
    try {
      if (rawModeEnabled) input.setRawMode(Boolean(wasRaw));
    } finally {
      input.pause();
    }
  }
}
module.exports = { attachTerminal };
