# HSEOS control SDK

Cliente da [API local v1](../../docs/engineering-control-api.md). Distribuído dentro
do pacote HSEOS; este subpacote é privado, não publicado separadamente. Node 22/24,
JavaScript com declarações TypeScript; Python usa apenas a biblioteca padrão.

```js
const { randomUUID } = require('node:crypto');
const { ControlClient } = require('hseos/packages/control-sdk');
const client = new ControlClient({url: process.env.HSEOS_CONTROL_URL,
  credential: process.env.HSEOS_CONTROL_CREDENTIAL});
const resource_id = randomUUID();
const created = await client.execute({schema_version:1, command_id:randomUUID(),
  resource_id, expected_sequence:0, action:'create', input:example});
const run = {schema_version:1, command_id:randomUUID(), resource_id,
  expected_sequence:created.current_sequence, action:'resume', input:{}};
const result = await client.execute(run);
const page = await client.events(resource_id, {after:0, limit:100});
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
