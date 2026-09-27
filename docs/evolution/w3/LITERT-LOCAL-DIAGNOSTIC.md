# Antigravity local: diagnóstico real de 2026-09-26

Estado: **incompleto**, sem campanha composta certificada. Esta evidência acrescenta
um checkpoint; não substitui os recibos históricos nem reinicia o teto financeiro.

## Execução e correção

Foram provisionados fora do repositório `google-antigravity==0.1.18`,
`litert-lm==0.17.1` e um checkpoint Qwen3 0.6B com revisão e SHA-256 fixos
no [recibo](evidence/litert-local-diagnostic/receipt.json). A verificação de
compatibilidade das 53 dependências instaladas passou.

A construção real de `Agent` copiava profundamente os métodos ligados ao cliente,
atingindo seu `threading.RLock` e falhando antes da inferência. As ferramentas agora
usam closures que preservam uma única instância do estado de admissão. O teste de
regressão copia a configuração, executa pela cópia e confirma que uma segunda
chamada pela original permanece negada. Não são criados contadores independentes.

O teste real posterior executou o modelo em CPU, com afinidade de duas CPUs,
cgroup de 2 GiB, teto de 256 processos/threads e prazo de 100 segundos. O supervisor
encerrou e drenou o grupo. A resposta não obedeceu à instrução de retornar somente
`READY`. Portanto, execução real não equivale a correção funcional do modelo.

## Revisão adversarial

- **“A rota está concluída”: refutado.** A ponte com o subordinado não foi exercitada
  pelo modelo; não existe recibo de campanha composta nesta etapa.
- **“Todos os limites chegam ao executor”: refutado.** Na distribuição 0.1.18,
  `LiteRTAgentConfig.create_strategy` não encaminha `budget_config`; a estratégia
  usa constantes internas para KV cache e saída. A configuração declarada não
  comprova enforcement dos limites de tokens ou chamadas. O cgroup e o prazo
  continuam sendo limites externos distintos.
- **“Uso desconhecido significa zero”: refutado.** `response.usage_metadata` retornou
  `None`; o servidor LiteRT dessa distribuição não inclui uso em seus frames de
  resposta. O adapter exige contagens inteiras e rejeita essa ausência.
- **“O formato de sessão foi validado”: refutado.** A sessão real tem 32 caracteres
  e atende ao tamanho mínimo existente. Isso não certifica uma retomada real,
  que ainda precisa ser exercitada. A suspeita inicial de tamanho incompatível
  foi descartada após medir o valor; o contrato não foi flexibilizado.
- **“A cópia do SDK renova a autorização”: refutado pelo novo teste.** As closures
  mantêm a mesma admissão e o mesmo limite de uso único.
- **“Houve chamada Gemini”: refutado.** Nenhuma chamada API foi feita nesta etapa.
  O teto global permanece USD 10, com USD 8 de reservas históricas retidas e USD 2
  disponíveis; o saldo retido não é uma afirmação de faturamento efetivo.

## Validação e continuidade

Passaram 14 testes Python do cliente e 12 testes Node das suítes do cliente e
adapters, incluindo fixtures de protocolo e isolamento. Essas fixtures não
substituem a execução real da campanha. Não houve commit ou merge desta correção.

Próximo trabalho necessário: adaptar a conexão local com limites efetivamente
encaminhados e métricas nativas verificáveis; testar a identidade de sessão; então
executar a ponte real com o subordinado sob o mesmo orçamento. A chave Gemini
informada pelo usuário pertence à NB Eventos; sua localização ainda não foi
confirmada. Testes API permanecem para depois da rota local, conforme solicitado.
