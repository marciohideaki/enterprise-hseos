# HSEOS control SDK

Cliente da [API local v1](../../docs/engineering-control-api.md). Distribuído dentro
do pacote HSEOS; este subpacote é privado, não publicado separadamente. Node 22/24,
JavaScript com declarações TypeScript; Python usa apenas a biblioteca padrão.

```js
const { randomUUID } = require('node:crypto');
const { ControlClient } = require('hseos/packages/control-sdk');
const client = new ControlClient({ url: process.env.HSEOS_CONTROL_URL, credential: process.env.HSEOS_CONTROL_CREDENTIAL });
const resource_id = randomUUID();
const created = await client.execute({
  schema_version: 1,
  command_id: randomUUID(),
  resource_id,
  expected_sequence: 0,
  action: 'create',
  input: example,
});
const run = {
  schema_version: 1,
  command_id: randomUUID(),
  resource_id,
  expected_sequence: created.current_sequence,
  action: 'resume',
  input: {},
};
const result = await client.execute(run);
const page = await client.events(resource_id, { after: 0, limit: 100 });
```

`example` é `{contract,responses}` produzido por `tools/examples/project-task.js`.
Guarde o comando `run` para uma repetição idempotente após desconexão. `query(id)`,
`query(id,'session')`, `query(id,'evidence')`, `query(id,'review')` e `prepare(template)`
compartilham as mesmas operações da CLI `hseos control`.

```python
# Adicione node_modules/hseos/packages/control-sdk ao PYTHONPATH.
import os
from hseos_control import ControlClient
client = ControlClient(os.environ['HSEOS_CONTROL_URL'],
                       os.environ['HSEOS_CONTROL_CREDENTIAL'])
status = client.query(resource_id)
events = client.events(resource_id, after=0, limit=100)
```

Em Python, `execute(command)` aceita o mesmo objeto JSON. Nenhum cliente escolhe
backend ou cria aprovação. Não registre credenciais nem objetos privados do
cliente. Endpoints remotos e redirecionamentos são rejeitados. Paginação é
explícita; eventos não são consumidos em segundo plano.

W2 adds `terminal(command)`, `terminalQuery(id)` and `terminalEvents(id, {after, limit})`.
Python exposes `terminal`, `terminal_query` and `terminal_events`. Commands use the
same explicit UUID/sequence/idempotency envelope; terminal output is base64.
See `docs/engineering-control-api.md` for actions, reconciliation and candidate limits.

## W4 jobs

JavaScript e TypeScript oferecem `job(command)`, `jobQuery(resourceId)` e
`jobEvents(resourceId, {after, limit})`. Python oferece `job(command)`,
`job_query(resource_id)` e `job_events(resource_id, after=0, limit=100)`.
O mesmo envelope com `schema_version: 1`, `command_id`, `resource_id`,
`expected_sequence`, `action` e `input` é usado por CLI e `POST
/v1/jobs/commands`. Ações públicas: `create`, `resume`, `cancel`, `reconcile`
e `retry`. Expansão de workflow é interna. Guarde o comando original para
replay; uma operação incerta exige reconciliação, sem novo ID de comando.

```js
const command = {
  schema_version: 1,
  command_id: randomUUID(),
  resource_id: randomUUID(),
  expected_sequence: 0,
  action: 'create',
  input: {
    kind: 'task',
    definition: { contract: example.contract, responses: [] },
    not_before: new Date(Date.now() - 1000).toISOString(),
    deadline_at: new Date(Date.now() + 60_000).toISOString(),
    depends_on: [],
  },
};
const createdJob = await client.job(command);
const currentJob = await client.jobQuery(command.resource_id);
const changes = await client.jobEvents(command.resource_id, { after: 0, limit: 100 });
```

O `input` completo segue o [contrato W4](../../.specs/features/harness-w4/jobs.md).
O exemplo usa uma tarefa sem provider; vínculos com provider precisam referenciar
campanha e autorização existentes. O cursor seguinte
é `changes.next_cursor`; use-o na próxima consulta. As credenciais continuam
obrigatórias, e o cliente não concede autorização financeira ou de provider.
