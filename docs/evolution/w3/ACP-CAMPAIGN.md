# ACP restrito integrado à campanha

Incremento candidato executado em 1 → 2 → 3, autorizado pelo proprietário.

## 1. Compatibilidade

`CodexAcpPeer` adapta exclusivamente `@agentclientprotocol/codex-acp@1.13.1`.
Valida capacidades, versão, modo, modelo e opções; descarta apenas metadados
conhecidos e limitados. Recursos desconhecidos, mudanças de configuração e
comandos slash são recusados. O anúncio `api-key` não dispara autenticação: o
host verifica a conta preexistente e a identidade recebida pelo ACP.
`AcpRuntimeProvider` e `ProcessAcpPeer` continuam com seus contratos originais.

## 2. Fronteira de efeitos

O perfil fixa o binário Codex 0.157.1 e o agente por SHA-256. Usa home e cwd
privados, referência à autenticação existente, catálogo restrito no startup,
flags sem ferramentas e verificação antes de operações. O launcher revalida a
composição. Configuração local concorrente é recusada. Não copia credenciais para
documentação nem aceita chave API no ambiente do agente.

A prova offline usa esses binários contra um endpoint de loopback sem credencial.
Inspeciona tanto `tools` quanto `additional_tools`: cinco requisições, zero
ferramentas oferecidas. Execução, patch freeform, delegação e leitura de imagem
forjados são recusados pelo runtime. O arquivo testemunha não é criado.

A fronteira cobre efeitos solicitados pelo modelo. O cliente confiável mantém
estado de sessão/autenticação e acessa seu serviço remoto. Cgroup limita recursos,
encerra descendentes e não equivale a sandbox de filesystem/rede. A configuração
`read-only` não é a prova de ausência de ferramentas. Uma falha no binário
confiável está fora dessa evidência; futuras versões exigem novo pin e novo ensaio.

## 3. Campanha

Factory `hseos-codex-acp-campaign-v1` registrada no controle. Reutiliza inspeção de
conta/quota, ledger, supervisor, runner HTTP e SDK público. Aceita somente rota
`account`, cliente terminal e reserva por request zero. Antes de cada dispatch,
recusa créditos pagos disponíveis, quota esgotada, drift e identidade divergente.

O binding é um JSON com `binary`, `agent`, `catalog`, `catalog_sha256`, `model`,
`home`, `cwd` e `auth_source`. O catálogo contém exatamente um modelo, sem patch,
shell, busca, ferramentas experimentais ou delegação. `home/auth.json` aponta para
a referência de conta autorizada. As opções do adapter contêm `native_binding` e
`native_options`, reutilizando o formato do adapter nativo. O manifesto fixa os
digests da composição, opções e artefatos. Configuração é propriedade do host;
nenhuma dessas rotas é recebida de prompts.

Retomada vem de recibo anterior no mesmo binding/tarefa/campanha. Replay não
despacha novamente. A campanha real final executa dois turnos na mesma sessão,
confere replay e termina cancelada, sem comandos ativos ou pendências. A prova
adicional de cancelamento envia `session/cancel` após o primeiro fragmento e drena
o cgroup; não alega confirmação remota de faturamento ou recibo de tokens do turno
cancelado.

Tokens em cache são somados à entrada. Reasoning já integra a saída nativa e não
é contado duas vezes. Totais inconsistentes são recusados. O teto de tokens do
manifesto é validado no recibo; não é um limite remoto preventivo certificado.
`model_max_output_tokens` não pertence ao schema dessa versão e foi removido.
Os limites preventivos demonstrados são requests, rota de cobrança, duração,
memória/processos e interrupção pelo supervisor.

## Revisão adversarial e limites

| Afirmação questionada                           | Resultado                                                                                    |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Flags desligadas bastam                         | Refutada: catálogo habilitava delegação e patch; ambos agora recusados.                      |
| Campo `tools` ausente prova isolamento          | Refutada: havia `additional_tools`; a prova atual verifica os dois.                          |
| Read-only equivale a L0                         | Refutada: admissão depende da composição sem ferramentas e seus pins.                        |
| Uso ACP é apenas `inputTokens`                  | Refutada: cache separado; corrigido e reexercitado.                                          |
| Um parâmetro de saída configura limite remoto   | Refutada pelo schema fixado; removido, sem alegar cap remoto.                                |
| Cancelamento funcionava no primeiro diagnóstico | Refutada: faltava `cascade` no contrato; corrigido e exercitado.                             |
| Todo resultado incerto pode ser repetido        | Refutada: primeira tentativa foi reconciliada e encerrada, sem apagar o dispatch.            |
| Campanha real certifica todo ACP                | Refutada: apenas esta composição/versão e cenário; quatro famílias e L1–L4 não certificados. |
| Reserva zero significa fatura zero medida       | Refutada: rota por conta sem créditos; custo medido continua `null`.                         |

A primeira tentativa de campanha falhou no launcher antes da inferência: autofix
havia removido o shebang. A regra de lint agora reconhece o executável, e o teste
de pacote exige sua permissão de execução. O ledger conserva a tentativa e a
reconciliação. A primeira regressão ampla foi executada sem cgroup delegado e
falhou por essa precondição; a execução correta usa `systemd-run --user --scope
-p Delegate=yes`. Nenhuma dessas falhas foi apagada para produzir um relatório verde.

O teto global permanece USD 10: USD 8 retidos historicamente, USD 2 disponíveis,
sem novas chamadas API pagas. Gemini API continua fora deste incremento. Estado
candidato, sem commit/PR/merge novos; fechamento integral de W3 permanece separado.

Evidências: [recibo](evidence/acp-campaign/receipt.json),
[campanha](evidence/acp-campaign/campaign-result.json),
[prova de ferramentas](evidence/acp-campaign/tools-proof.json),
[cancelamento](evidence/acp-campaign/cancel.json) e regressões no mesmo diretório.

Fontes de implementação: [agente ACP](https://github.com/agentclientprotocol/codex-acp),
[schema fixado](https://github.com/openai/codex/blob/rust-v0.157.1/codex-rs/core/config.schema.json),
[registro de ferramentas](https://github.com/openai/codex/blob/rust-v0.157.1/codex-rs/core/src/tools/spec_plan.rs).

A revisão do pacote também detectou o limite de inventário anterior desatualizado.
O pacote foi inspecionado: 1.439 entradas, aproximadamente 9 MB, incluindo os seis
artefatos ACP novos. O limite agora reflete esse inventário; exclusões de estado,
chaves, configuração, testes e logs continuam verificadas independentemente.

O teto de requests limita despachos/prompts admitidos pelo controle; não certifica
quantas requisições internas o cliente realiza ao serviço do modelo. A prova de
ferramentas forjadas, por exemplo, exige respostas internas adicionais. Duração e
drain permanecem os limites preventivos desse processamento interno.

## Validação final

101/101 testes em Node 24.15.0 e 101/101 em Node 22.23.3, incluindo protocolo,
ledger, composição, replay, cancelamento, publicação do launcher e casos adversariais.
Lint e formato dos arquivos verificados passaram. Gate CI: zero falhas e um alerta
preexistente do template de Epic; markdownlint indisponível. Não foi executada a
suíte integral de release nem certificada cobertura integral do novo snapshot W3.
Logs históricos preservam whitespace original; a verificação de whitespace da
fonte exclui esses artefatos imutáveis.
