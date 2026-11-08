# Método da repontuação da execução 2

Repontuação posterior ao fato, com medidor corrigido, não substitui o critério pré-registrado.

Comando: `node rescore.cjs --root <repo> --runs <runs da execução> --ledgers <pasta com hseos-ledger-fixture-*> --out real-attempt2`. Offline, sem gasto, sem rede.

1. Para cada `runs/<rótulo>/result.json`, o ledger é localizado pelo `state_sha256` (sha256 do `ledger.sqlite`); as 33 casaram.
2. O ledger é copiado para um diretório privado sob `$TMPDIR` e lido com `openExecutionLedgerFileFixture`, `ExecutionEventLedger` e `RelationalSessionEventStore`.
3. `measure.cjs` aplica ao esqueleto da tarefa, em ordem, as chamadas `engineering.write` e `engineering.patch` com `tool.execution.completed` bem-sucedido, confere o `sha256` reconstruído com o do evento e devolve a fonte final.
4. Os testes protegidos (`tasks.cjs`) rodam sobre essa fonte. Sucesso = testes protegidos passam, verificador do produto aprovou e a execução não bateu o limite de requisições (mesma regra do roteiro).
5. `stats.cjs` (`evaluateCriterion`) calcula por tarefa e o p estratificado, como informação. Há também uma leitura sem o veredito do produto e sem a regra do limite.

Só o resumo agregado e sem segredo é gravado (`campaign.json`, varredura de segredos limpa). Ledgers e `runs/` ficam fora do repositório. Verificação independente: onde o diretório de trabalho guardado do ledger existia, o arquivo final dele é igual à fonte reconstruída (`meter.workspace_match`).
