// Compile-time contract probe: each line below MUST be rejected by the installed index.d.ts.
// tsc reports "Unused '@ts-expect-error' directive" if the declaration is too permissive.
import { ControlClient } from 'hseos/packages/control-sdk/index.js';

const client = new ControlClient({ url: 'http://127.0.0.1:1', credential: 'x'.repeat(32) });

// @ts-expect-error unknown view
void client.query('id', 'bogus');
// @ts-expect-error unknown action
void client.execute({ schema_version: 1, command_id: 'c', resource_id: 'r', expected_sequence: 0, action: 'bogus', input: {} });
// @ts-expect-error missing credential
void new ControlClient({ url: 'http://127.0.0.1:1' });
// @ts-expect-error expected_sequence must be a number
void client.terminal({ schema_version: 1, command_id: 'c', resource_id: 'r', expected_sequence: '0', action: 'open', input: {} });
