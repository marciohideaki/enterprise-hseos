# W3 — campanhas reais reexercitadas

Em 2026-09-27 foram executados oito novos despachos no snapshot corrigido:
dois ACP/Codex, dois Claude API e quatro na composição Antigravity local/Codex.
Todos terminaram com recibos completos, replay idempotente, cancelamento final
e zero comandos vivos ou incertos. As campanhas foram sequenciais, limitadas a
um CPU, prioridade reduzida e memória limitada; nenhuma suíte integral rodou em
paralelo. A carga do host ainda impede iniciar a cobertura integral Node 22.

## Resultado observado

| Rota              | Evidência real                                                                                                                                        | Limite da conclusão                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| ACP sobre Codex   | Duas respostas READY na mesma sessão; inspeção de conta elegível, sem créditos pagos; prova local rejeitou chamadas de ferramentas e não criou efeito | ACP é protocolo; identidade continua Codex, não quarta família                         |
| Claude API        | Resposta inicial 42 e retomada 43, hashes esperados e mesma sessão; duas chamadas e recuperação comprovadas                                           | Exceção limitada de quota desconhecida autorizada; custo SDK não é fatura              |
| Antigravity local | Dois turnos LiteRT na mesma sessão, uma chamada subordinada por turno; ambos filhos Codex responderam READY                                           | Filhos têm sessões distintas; recuperação comprovada no pai; Gemini API não exercitada |

Versões e hashes constam nos manifests preservados. Claude SDK 0.3.283,
cliente 2.1.283; Codex 0.157.1; Antigravity SDK 0.1.18. Checkpoint LiteRT Qwen3-0.6B
fixado por revisão e SHA-256. Os recibos do runner, isoladamente, marcam recuperação
como não certificada; a comprovação adicional está nos validadores semânticos e
nos recibos reais de cada turno. Isso não declara conformidade universal dos
clientes externos nem confinamento de todas as suas ferramentas pelo kernel.

## Orçamento acumulado

- Teto original: US$ 10, sem reset.
- Reservas históricas preservadas: US$ 8.
- Nova reserva Claude: US$ 1, para duas chamadas de até US$ 0,50 cada.
- Total reservado: US$ 9; saldo não comprometido: US$ 1.
- Custo novo informado pelo SDK Claude: US$ 0,008886; não libera a reserva.
- ACP e composição local: reserva monetária adicional zero.
- Despachos acumulados: 22 anteriores + 8 novos = 30.
- Novas inferências: seis remotas e duas locais. Replay não incrementou despachos.

A autorização das duas chamadas Claude desta rodada foi consumida. Nenhuma nova
chamada paga deve ser inferida do saldo remanescente sem plano autorizado.

## Quarta família e aceite

Instrução explícita do proprietário: “A quarta familia só sera testada e validada
após a conclusao de todas as fases!”. A spec e as tasks registram o adiamento.
Sua parcela FR07 continua pendente, mas não bloqueia o avanço das entregas atuais.
Não classificar a família como validada nem substituir seu ensaio por ACP/Codex.
Antigravity foi executado por último entre as campanhas atuais, como solicitado.

A matriz funcional integral Node22/24 e a cobertura Node24 estão aprovadas no
mesmo snapshot de fontes. Falta a cobertura integral Node22 para FR08: carga
persistente do host acima dos seis núcleos físicos (contrato global §3f).
A preparação de retomada permanece em `resume-coverage-node22.py`, sem repetir
os três estágios aprovados. Não há commit, PR ou merge W3 nesta rodada.

## Revisão adversarial e refutação

- “Replay prova recuperação remota”: refutada. Os dois turnos são despachos
  distintos; a recuperação é comprovada separadamente pela sessão e pelas respostas.
- “READY em ACP prova a quarta família”: refutada pela identidade Codex.
- “Antigravity retomou todos os filhos”: refutada; o pai foi retomado, os filhos
  são sessões distintas. O orçamento composto registra os quatro despachos.
- “O gasto é exatamente a reserva”: refutada. SDK informa uso; ledger mantém
  reserva conservadora. Não há conciliação de fatura nesta rodada.
- “As quatro famílias foram validadas”: refutada. A quarta foi adiada pelo dono.
- “W3 está integralmente fechado”: refutada. Falta cobertura Node22 e entrega Git.

Evidências: `evidence/real-campaigns-resume/receipt.json`, validadores por rota e
hashes de todos os arquivos. Scan dos cinco segredos usados na rodada e padrões
de tokens não encontrou valores nos artefatos publicados. Coleta bruta de conta
fica ignorada; inspeção publicada omite identidade pessoal e IDs da conta.
AEW: aplicação/enforcement não verificados.
