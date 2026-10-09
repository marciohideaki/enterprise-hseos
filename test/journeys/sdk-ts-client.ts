// Typed SDK worker for the core journey. Type-checked with tsc (strict, nodenext) against the INSTALLED
// package's index.d.ts and executed by Node's native type stripping. Line-delimited JSON over stdio:
//   request  {"id":1,"method":"query","args":["<uuid>","evidence"]}
//   response {"id":1,"ok":true,"result":{...}} | {"id":1,"ok":false,"error":{"code":"...","message":"..."}}
import { ControlClient } from 'hseos/packages/control-sdk/index.js';
import type {
  CampaignStatus,
  ControlCommand,
  JobCommand,
  JobStatus,
  TaskStatus,
  TerminalCommand,
  TerminalStatus,
  WorkflowStatus,
} from 'hseos/packages/control-sdk/index.js';

declare const process: any;

interface Page {
  resource_id: string;
  events: Record<string, unknown>[];
  next_cursor: number;
}
interface Paging {
  after?: number;
  limit?: number;
}

const url: string = process.argv[2];
const credential: string = process.env.HSEOS_CONTROL_CREDENTIAL;
const client = new ControlClient({ url, credential });

const cursor = (value: unknown): Paging => (value ?? {}) as Paging;

const handlers: Record<string, (args: unknown[]) => Promise<unknown>> = {
  prepare: (a) => client.prepare(a[0] as Record<string, unknown>),
  execute: (a) => client.execute(a[0] as ControlCommand),
  query: async (a): Promise<TaskStatus | WorkflowStatus | Record<string, unknown>> => {
    const id = a[0] as string;
    const view = (a[1] ?? 'status') as string;
    if (view === 'status') return client.query(id);
    if (view === 'evidence' || view === 'review' || view === 'session') return client.query(id, view);
    throw new Error('Invalid control query');
  },
  events: (a): Promise<Page> => client.events(a[0] as string, cursor(a[1])),
  job: (a): Promise<JobStatus> => client.job(a[0] as JobCommand),
  jobQuery: (a): Promise<JobStatus> => client.jobQuery(a[0] as string),
  jobEvents: (a): Promise<Page> => client.jobEvents(a[0] as string, cursor(a[1])),
  terminal: (a) => client.terminal(a[0] as TerminalCommand),
  terminalQuery: (a): Promise<TerminalStatus> => client.terminalQuery(a[0] as string),
  terminalEvents: (a): Promise<Page> => client.terminalEvents(a[0] as string, cursor(a[1])),
  bindingInspect: (a) => client.bindingInspect(a[0] as string),
  campaignQuery: (a): Promise<CampaignStatus> => client.campaignQuery(a[0] as string),
  campaignEvents: (a): Promise<Page> => client.campaignEvents(a[0] as string, cursor(a[1])),
};

async function handle(line: string): Promise<void> {
  const request = JSON.parse(line) as { id: number; method: string; args: unknown[] };
  try {
    const handler = handlers[request.method];
    if (!handler) throw new Error('Unknown method ' + request.method);
    const result = await handler(request.args ?? []);
    process.stdout.write(JSON.stringify({ id: request.id, ok: true, result }) + '\n');
  } catch (error) {
    const e = error as { code?: string; message?: string };
    process.stdout.write(JSON.stringify({ id: request.id, ok: false, error: { code: e.code ?? null, message: String(e.message) } }) + '\n');
  }
}

let buffer = '';
let chain: Promise<void> = Promise.resolve();
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  let index: number;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line.trim()) chain = chain.then(() => handle(line));
  }
});
process.stdin.on('end', () => {
  void chain.then(() => process.exit(0));
});
process.stdout.write(JSON.stringify({ ready: true, runtime: 'node-ts', node: process.version }) + '\n');
