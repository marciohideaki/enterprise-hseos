# W4-02c1 — revisão das fronteiras

Tipo: revisão adversarial local, Constituição §§2.6/7, ADR-0045 Proposed.

- Teste integrado usa ToolRuntime/scheduler/ledger reais; política negada e schema inválido não lançam plugin.
- Replay devolve o recibo original após alteração do código; nova chamada rejeita hash divergente.
- Nome/capacidade, tipo, política permissiva, mutação e timeout inválidos falham na composição.
- Contexto recusa origem/tier externo e duplicatas; ContextAssembler registra origem e conteúdo citado.
- Cancelamento/close drenam processo isolado; erro injetado em cgroup.kill mantém incerteza após settlement.
- Achado corrigido: tentativa posterior a teardown incerto preserva outcome uncertain no gateway.
- Cobertura inclui todo o arquivo, inclusive código não alcançado; critérios 90/80 satisfeitos.
- Limites: composição de tarefa pública, providers/campanha e consumidor real ainda pendentes.
  Este adapter candidato só aceita operações readonly no sandbox existente.
- Pacote: adapter acrescenta um módulo publicado (1441); invariantes de exclusão preservadas.

Gate integral Node24 aprovado, zero falhas. Avisos: placeholder herdado e nomes
Codex/Claude nos scripts de providers; não são atribuição de autoria.
