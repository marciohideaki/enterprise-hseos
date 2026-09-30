# W4-02c2b — revisão dos providers

Tipo: revisão adversarial local, Constituição §§2.6/7 e ADR-0045 Proposed.

- Manifest/discovery e registro não executam plugin. Execução exige ponte da campanha.
- ModelProvider valida request/result/events e limita uma requisição ativa.
- IDs de despacho derivados do request estável permitem replay confirmado sem efeito.
- Propostas de ferramenta são validadas e não executadas pelo plugin provider.
- Runtime reutiliza ciclo HostedInstructionsRuntimeProvider L0, com novo descriptor.
- Cancelamento valida identidade da sessão antes de atingir processo; teste negativo
  comprova que a sessão alheia não pode cancelar um cgroup ocupado.
- Eventos terminais e close esperam drain. Falha injetada de teardown não vira sucesso,
  nem pode ser escondida por return() no iterador de modelo.
- Testes observam cgroup ocupado antes do cancelamento e ausência depois.
- Contagem local é limite superior UTF-8, não billing remoto. Uso observado é emitido
  apenas após resultado válido. Excesso do orçamento solicitado conserva incerteza.
- Resume externo não é suportado nem anunciado; teste confirma recusa.
- Limites: sem campanha real, consumidor externo certificado ou composição pública.
  Cobertura dos três arquivos afetados supera 90% linhas/80% branches por arquivo.

Revisão cética isolada em duas passagens encontrou P1: validação de tools após
recibo de sucesso. Hook foi interrompido antes do commit. Correção antecipou a
validação de ferramentas e orçamento da requisição para antes de plugin_result e
receipt; identidade versionada do validador host faz parte do binding. Revisor
confirmou correção por inspeção, sem novos bloqueios. Novos testes exigem comando
não resolvido, ausência de resultado, replay sem nova reserva e close incerto.
65 testes em Node22/24 passaram; cobertura renovada inclui ponte de campanha.
Logs originais de 52 testes/gate são históricos, anteriores à correção.
Gate integral atualizado aprovado: zero falhas, um aviso herdado. Recibo renovado.
