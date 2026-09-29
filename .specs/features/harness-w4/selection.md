# Seleção de extensões por execução

FR01/02/07; ADR-0045 Proposed. Implementação candidata W4-02c3a.

`tools/lib/execution-plugin-selection.js` expõe pinExecutionPluginSelection(catalog,
selected), parseExecutionPluginSelection(value) e restoreExecutionPluginSelection(catalog,
value). Catalog é configuração local confiável, por selection_id estável e versionado.
Cada declaração contém directory absoluto, policy de admissão (sem node_major),
configuration JSON do port e dependencies como IDs de seleção. Node major é observado
no processo atual e confrontado pelo contrato de admissão existente.

Pin retorna selection v1 serializável e entries admitidas locais. Selection contém
IDs escolhidos, entradas em ordem topológica, identidade/kind/digest de manifesto,
hashes de configuração e política, dependências e hash do conjunto. Não contém paths,
credenciais ou funções. Entries contêm admission nominal e configuration congelada;
são dados internos de composição e nunca são enviados ao processo externo.

Restore refaz admissão dos IDs originais e compara o digest completo. Configuração,
permissões, dependências ou versão divergentes são bloqueadas. Catálogo deve reter
IDs versionados usados por execuções existentes; upgrade adiciona outra declaração,
rollback seleciona declaração anterior. Relocação de mesmos bytes é permitida.
Declarar duas seleções do mesmo plugin na mesma execução é recusado, inclusive aliases.
Somente entradas escolhidas/dependências são lidas. Limites: 128 entradas transitivas,
64 KiB de declaração JSON cada; limites de arquivos/conteúdo continuam na admissão.

Esta camada fixa dados; não executa plugin, não reserva dinheiro e não certifica a
semântica de configuration. O port host valida essa configuração antes de lançar
qualquer processo. Integração ao evento created da tarefa e resolução pública por IDs
são as próximas subdivisões; não alegar instalação/ativação concluídas.

Verificação: node --test --test-concurrency=1 test/test-execution-plugin-selection.js.
Evidência: docs/evolution/w4/evidence/selection/receipt.json e logs comprimidos.
