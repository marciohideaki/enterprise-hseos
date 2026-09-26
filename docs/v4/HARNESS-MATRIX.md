# Matriz de acompanhamento H01–H15

IDs desta integração: a busca em `_graph`, `docs` e `.enterprise` da base a842308
não encontrou matriz anterior H01–H15. Checkpoints históricos H1/H2/H4/H5/H6
mantêm seus identificadores. Nenhuma conclusão abaixo reclassifica eventos antigos.
Evidências são da revisão candidata, sem campanha real nem ativação operacional.
Gates completos da base anterior à ampliação: zero falhas, um aviso histórico; recibo
`evidence/2026-09-25-final/receipt.json`.
Correção e reconciliação têm validação adicional descrita em `RECOVERY-CORRECTION.md`.

| ID | Capacidade / consumidor | Implementação | Evidência determinística | Lacuna / critério restante |
|---|---|---|---|---|
| H01 | Resultado CLI | deltas anteriores integrados | CLI rejeita sessão/tarefa falha | fechado deterministicamente; campanha real separada |
| H02 | Efeito confirmado / reference | evidência de efeito integrada | escrita falha não vira sucesso | fechado deterministicamente |
| H03 | Política / ToolRuntime | gateway explícito; desconhecidas negadas | testes nativos e escopo de engenharia | campanha real; revisar novas ferramentas ao registrá-las |
| H04 | Isolamento / Node e Python | bwrap, seccomp, cgroup v2, limites e teardown | testes de rede, memória, saída, processos e cancelamento | validação em outro ambiente compatível; sem fallback |
| H05 | Contrato / agent run | escopos, comandos exatos, deadline, byte/token budgets | três tarefas e rejeição de adulterações | correção automática com diagnóstico e reverificação quando max_failed_corrections > 0; mesmo orçamento |
| H06 | Worker / executor | worker usa broker existente; código recebe apenas mounts e ambiente restritos | binding simulado em tarefa e workflow; credencial não persistida | campanha com bindings reais |
| H07 | Verificação / tarefas | três verificadores protegidos; prova v1 ligada ao contrato e artefatos | correto aprovado, resposta vazia/erro/adulteração rejeitados | ampliar registro somente com consumidor concreto; campanha real |
| H08 | Retomada / cancelamento | claims, deadline original, cancelamento cruzado e reaper | reconciliação de escrita, comando e modelo; perguntas vinculadas ao estado atual; cancelamento ativo | incerteza exige resposta explícita; owner não comprovado bloqueia; terminais não são reabertos |
| H09 | workflow run | WorkflowEngine + supervisor existentes; YAML só leitura/definição | composição, migração, owner morto, claim exato e disputa entre retomadas | correção e reconciliação compartilhadas com tarefas; campanha real separada |
| H10 | Orçamento da árvore | validação/reserva de todos os tetos; consumo no estado de sessões | concorrência limitada, gasto/reserva/liberação consultáveis | correções e recuperação debitadas no teto original; descendentes dinâmicos não habilitados; campanha separada |
| H11 | Perfil mínimo / candidato | dependências transitivas, compilação seletiva e lazy loading | catálogo 161 verificações; guardas contra processos/rede/opcionais | garantia de materialização restrita a consumidores novos e dois perfis |
| H12 | Contexto / sessão longa | critérios obrigatórios fora do histórico; contagem compartilhada | compactação preserva objetivo/restrições/aceite; checkpoint exato | contagem estimada continua distinta de uso informado |
| H13 | Replay / estado canônico | redução incremental nominal e replay integral | equivalência 100/1.000/10.000 eventos; rollback não contamina cache | benchmark usa eventos de controle, não payloads grandes de modelos |
| H14 | Credenciais / hooks | broker bloqueia segredo conhecido em texto/chunks; autoridade no gateway | regressão do broker; documentação distingue aviso, aprovação e bloqueio | não há promessa de detecção universal de segredos |
| H15 | Distribuição / migração | root 4.0.0-rc.0, definições elegíveis, rollback e v3 preservada | pacote externo: tarefas, workflow, consulta e perfis | gates finais aprovados; campanha real, janela de depreciação e ativação separados |
