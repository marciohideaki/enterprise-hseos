# Antigravity local com LiteRT

A rota local usa o agente oficial `google-antigravity==0.1.18`, o engine
`litert-lm==0.17.1` e um checkpoint provisionado explicitamente. A factory continua
aceitando somente CPU e arquivos locais; não baixa modelos nem usa API como fallback.

## Conexão e limites

`antigravity_litert.py` reutiliza a configuração e o tradutor de mensagens do SDK,
com ciclo de vida local controlado pelo HSEOS. A estratégia recebe `budget_config`
e o modo explícito de retomada. O engine não faz aquecimento: toda inferência
consome uma admissão. O servidor serializa as chamadas, limita a saída ao saldo de
tokens restante e mede entrada/saída pelo benchmark nativo. A ausência de métricas,
uma chamada sem medição final ou ultrapassagem observada impedem recibo de sucesso.

A capacidade de contexto é dividida pelo máximo de chamadas e inclui a geração;
ring buffers ficam desativados. Essa escolha conservadora pode rejeitar uma tarefa
que caberia em um contexto maior. O supervisor também impõe prazo, memória e
processos/threads, e verifica a drenagem do cgroup. Isso não é sandbox de filesystem.
A configuração real exercitada fixa `pids_max: 256` e memória em 2 GiB.

O servidor Go do SDK não apresenta essas métricas em `response.usage_metadata`.
O cliente usa os contadores nativos da conexão, marcados como
`litert_native_benchmark`; não estima tokens pelo texto e não converte ausência em
zero. Tokens gerados incluem o processamento de raciocínio do engine, sem dupla
contagem. As versões são verificadas; não se afirma atestação de todos os bytes das
dependências opcionais instaladas.

## Ferramentas e composição

A campanha expõe somente `run_campaign_model`. Essa ferramenta é uma capacidade
fixa, de uso único, para o binding selecionado pelo operador. O filho pode ser um
modelo ou um cliente terminal, como o adapter Codex por conta. Sua classificação é
preservada. Filhos com subordinados, auto-referência, bindings ausentes e runtimes
delegados não são aceitos nessa composição. Pai e filho precisam estar no mesmo
grant; cada dispatch reserva request e custo antes do efeito.

O checkpoint precisa incluir formato de chamadas de ferramenta. O primeiro
checkpoint compacto carregou e gerou texto, mas não expôs os schemas ao modelo.
O checkpoint dinâmico utilizado no ensaio bem-sucedido inclui esse formato. O
[formato canônico Qwen3 no LiteRT](https://github.com/google-ai-edge/LiteRT-LM/blob/main/models/qwen3/README.md)
descreve o suporte; o arquivo efetivamente utilizado é identificado por revisão e
SHA-256 nos recibos. A qualidade geral de um modelo de 0,6 bilhão de parâmetros
não é inferida desse ensaio simples.

## Retomada e escopo financeiro

A retomada exige identidade de um recibo anterior da mesma campanha, tarefa e
binding. O SDK recebe `RESUME` e orçamento `FORWARD_LOOKING`: os limites valem para
os novos efeitos autorizados, enquanto o ledger mantém o histórico da campanha.
Isso não renova automaticamente uma autorização nem libera reservas anteriores.

O ensaio composto combina Antigravity/LiteRT local e Codex por conta, com quota
observada e sem créditos pagos habilitados. Não é uma execução integralmente offline.
Nenhuma Gemini API ou chamada adicional à API Claude faz parte desse ensaio.
O teto global continua em USD 10: USD 8 de reservas históricas retidas e USD 2
não comprometidos. Reserva retida e faturamento efetivo são medidas diferentes.

## Resultado verificado

O [recibo final](evidence/litert-local-verified/receipt.json) registra quatro
dispatches na mesma campanha: dois turnos do pai e dois filhos. O pai retomou a
mesma sessão; cada turno fez uma inferência local e uma chamada ao filho. Os usos
locais medidos foram **249/21** e **331/21** tokens de entrada/saída. Ambos os filhos
retornaram o hash do texto esperado `READY`. Os filhos abriram sessões próprias;
essa execução não prova retomada dos filhos.

O ledger registra a reserva do pai e a reserva vinculada do filho antes de cada
efeito. Os replays mantiveram o mesmo relatório sem novas chamadas. A campanha
ficou cancelada, sem comandos vivos ou incertos. Os testes focados passaram
**78/78 em Node 24 e 78/78 em Node 22**, incluindo a suíte de 17 testes Python.
O ensaio negativo de entrada excedente não produziu medição completa e foi
rejeitado sem invocar a capacidade subordinada. O limite de saída de 256 tokens
também foi observado no primeiro ensaio; o ensaio final usou limite de 96 tokens
com uma chamada por turno.

## Revisão adversarial final

| Afirmação                                   | Verificação e limite                                                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| O SDK faz inferência local real             | Confirmado com engine e checkpoint reais; nenhum fixture no modelo pai da campanha final.                                     |
| A ferramenta aciona um subordinado real     | Confirmado pelos dois recibos Codex e pelas reservas vinculadas. O ensaio de callback isolado é evidência separada.           |
| A retomada preserva identidade              | Confirmada para o pai, com uso medido em ambos os turnos. Não generalizada para todos os providers.                           |
| Limites de chamadas/saída são aplicados     | A conexão limita admissões e saída restante; testes cobrem esgotamento. Uso incompleto e excesso observado rejeitam sucesso.  |
| Toda tarefa cabe na capacidade declarada    | Refutado: a divisão conservadora do contexto pode rejeitar entradas antes de obter recibo.                                    |
| O resultado certifica quatro famílias       | Refutado: trata-se do piloto composto local/conta; Gemini API e a campanha de quatro famílias continuam fora desta evidência. |
| Local significa offline                     | Refutado: o pai é local; o filho utiliza a conta remota explicitamente selecionada.                                           |
| USD 8 representam faturamento confirmado    | Refutado: são reservas históricas retidas; não uma fatura. Nenhuma API paga foi chamada neste incremento.                     |
| Zero ferramentas nativas equivale a sandbox | Refutado: há contenção de recursos, sem certificação de confinamento completo de filesystem.                                  |
