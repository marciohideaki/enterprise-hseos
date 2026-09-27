# W4-02c3a — seleção durável

Tipo: revisão local com passagem cética isolada, Constituição §§2.6/7; ADR-0045 Proposed.

A passagem cega não identificou bloqueio: apenas declarações selecionadas e suas
dependências são inspecionadas; admissão nominal existente valida conteúdo, política
e grafo. Dados são congelados. Hash fixa configuração, permissões, seleção e ordem;
restore exige igualdade. Diretório não integra identidade, permitindo relocação
com mesmos bytes/políticas. Pin não implica certificação de consumidor ou execução.
Semântica de configuração dos ports deve ser validada pelo adapter antes do efeito.

8 testes de seleção/distribuição passaram em Node22/24; cobertura por arquivo 100% linhas/branches.
Gate integral Node24 passou, zero falhas; hook ainda pendente. Revisão cega foi estática, sem executar testes.

Confronto isolado confirmou hashes, logs e limitações do recibo; sem novos bloqueios.

Após integração dos providers, ajustes de lint apenas no teste e nova execução Node22/24.
Pacote inspecionado: 1445 entradas; delta de um módulo, sem alterar exclusões.
