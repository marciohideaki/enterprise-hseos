# WAVE-WB-REPORT

Onda WB do fechamento pré-W6 (habilitadores, sem gasto). As tasks B1–B6 foram aceitas depois da revisão cética; o detalhe está em `STATUS.md`.

## Entregas
- **Quarta família:** adapter e binding prontos para L2, com origem fixa e cota sob exceção auditada. A campanha fica **BLOCKED** porque a chave não existe, por decisão do owner.
- **Binding compatível com a API oficial:** pronto para L2.
- **F15:** compactação no `agent run` e fork pela CLI com lineage verificada.
- **F14:** memória no contexto com proveniência e promoção pelo operador, conforme a decisão (b) do owner, implementada sem migration (opção C).
- **Lançamento delegado do MCP para `environment.*`.**

## Verificação
- **Suíte:** 4698 testes, 0 falhas. `test:kernel-coverage` PASS. Matrizes W4 e W5 rejeitaram 20 e 43 mutantes.
- **Incidente de integração:** a 1ª execução da suíte falhou porque a resolução de conflito do Commander descartou segmentos encadeados do `test:kernel`. O problema foi corrigido em `5ada449c` e registrado no STATUS.

## Pendente para a WC
Campanhas com consumidor real e L2:
- C1–C5, C7;
- C8 (F14, com promoção pelo owner);
- C9 (F15);
- C10 (agregada);
- C11 (environment.*).

A C6 está BLOCKED pela chave Gemini.
