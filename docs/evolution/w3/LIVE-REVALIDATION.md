# Revalidação da campanha real — 2026-09-26

O piloto Codex passou com duas inferências reais, criação e retomada na mesma
sessão, respostas exatas verificadas por SHA-256 e replay de controle idempotente.
O resultado está em `evidence/live-revalidation/final-codex-validation.json`.
Isso valida o piloto dessa rota, não a campanha completa de quatro famílias.

## Causas e correções

1. O grupo de recursos com teto 32 esgotava threads durante a inicialização do
   cliente. Desativar MCPs não corrigiu isso; desativar snapshot de shell ou
   descoberta de skills também não isolou a causa. Seis inicializações com teto
   256 passaram sem eventos de limite, com picos medidos entre 99 e 164. Pelo
   launcher corrigido, outra inicialização passou com pico 184. Os snapshots são
   amostrados, portanto não representam garantia sobre todo pico instantâneo.
   A implementação reutiliza o executor existente: `pids_max` opcional de 32 a
   256, padrão 32, selecionado explicitamente no binding da campanha. Inspeção e
   execução recebem o mesmo limite, fixado no digest; o executor integra o digest
   de artefatos. Memória finita e drenagem continuam aplicadas. Não se afirma que
   256 seja suficiente para toda carga ou versão futura do cliente.
2. O primeiro ensaio após essa correção concluiu uma inferência, mas abortou a
   retomada. A inspeção real de `thread/resume` mostrou uma atualização de consumo
   atrasada do turno anterior, cujo ID constava do histórico devolvido pelo
   servidor. O driver atribuía esse ID ao novo turno. Agora descarta atualizações
   de consumo de IDs históricos conhecidos, somente na mesma sessão. Uma
   identidade de outra sessão continua recusada. O teste adversarial também
   expôs uma rejeição de Promise não observada antes do reconhecimento de
   `turn/start`; essa corrida foi corrigida sem suprimir o erro entregue ao cliente.

## Execução e orçamento

O último ensaio retornou exatamente `{"value":42,"phase":"initial"}` e
`{"value":43,"phase":"resumed"}`. As duas execuções usaram o mesmo `provider_session_id`, registrado nos recibos.

Foram cinco despachos acumulados: um no ensaio original, dois no intermediário e
dois no final. Há três recibos concluídos e dois resultados históricos incertos,
reconciliados para encerramento sem reclassificá-los como sucesso ou como ausência
de execução. As campanhas anteriores foram canceladas; a última também terminou
cancelada, sem comandos ativos ou pendentes. Os relatórios antes/depois e a
instrução do proprietário estão preservados nos recibos de reconciliação.

O teto global continua **US$ 10**, não reiniciado a cada ensaio. O saldo de
requisições foi transferido como 10 → 9 → 7 antes dos respectivos ensaios;
restam cinco despachos no limite adicional adotado para esta autorização.
O comprometimento monetário acumulado no ledger é zero: somente a rota de conta
com assinatura e sem créditos pagos foi admitida. Nenhuma API paga foi exercitada.
Esses registros não são comprovação da fatura do provedor.

## Revisão adversarial

- “Apenas desativar MCP corrige a inicialização”: refutado por falhas reproduzidas.
- “Aumentar o limite prova toda a campanha”: refutado pela falha posterior de retomada.
- “Replay de controle prova retomada nativa”: não; o ensaio final verifica também
  identidade da sessão e mudança exata da resposta baseada no histórico.
- “A atualização de consumo sempre pertence ao turno ativo”: refutado pelo
  protocolo real e coberto por regressão com evento histórico antes do novo ACK.
- “Erros de protocolo não deixam rejeições órfãs”: era falso no caso adversarial;
  corrigido e reexercitado com rejeição preservada para o chamador.
- “O piloto encerra W3/FR07”: falso. Claude ainda depende da decisão explícita
  sobre quota desconhecida; API compatível/ACP depende da referência da credencial;
  Antigravity depende do checkpoint real `.litertlm`. A ponte composta permanece
  testada localmente, sem alegação de inferência real dessas rotas.
- “A contenção de recursos é sandbox de arquivos”: falso. Mantém-se a limitação
  já declarada para clientes SDK confiáveis. Não houve ativação operacional.

As provas anteriores em `evidence/live-10usd/` permanecem intactas como checkpoint.
Este incremento usa `evidence/live-revalidation/`. AEW e aplicação global da
governança não foram certificados por este ensaio.

## Validação do incremento

Regressão focada: **65/65 em Node 24 e 65/65 em Node 22**, zero falhas/skips.
Inclui controlador de campanha, orçamento, runner, adapters, executor e driver
Codex. Lint e formato das fontes alteradas passaram. O gate de governança CI passou
com zero falhas e um aviso preexistente. O digest nativo do ensaio corresponde às
fontes atuais. A matriz completa, cobertura global e
consumidor instalado não foram repetidos neste incremento; seus recibos anteriores
são checkpoints históricos, não certificação deste novo conteúdo.
