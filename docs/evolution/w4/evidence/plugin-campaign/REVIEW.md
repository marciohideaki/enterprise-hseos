# W4-02c2a — revisão da reserva

Tipo: revisão adversarial local, Constituição §§2.6/7 e ADR-0045 Proposed.

- Binding v2 é local, hash-pinado, sem segredo/rede/cobrança. Rotas v1 preservadas.
- A ponte exige campanha nominal, tarefa autorizada e manifesto fixado na abertura.
- A reserva real existe antes de mkdtemp/exec; chamar adapter.run diretamente falha.
- Resultado e hash ficam no ledger existente; replay confirmado não inicia processo.
- Falha injetada ao persistir recibo mantém consumo e bloqueia novo despacho.
- Achado corrigido: a sequência original integra a intenção; mudar sequência no
  retry causava conflito idempotente em vez de reconhecer resultado incerto.
- Outro achado corrigido: attach recusa mudança de limites/schema ou tarefa alheia.
- Duplicata concorrente, fechamento/cancelamento e saída fora do contrato têm testes.
- Contagem local reutiliza limite conservador UTF-8; não anuncia medição remota.
- Cobertura por arquivo inclui todos os arquivos críticos afetados e supera 90/80.
- Limites: ensaio de reinício reabre controle no mesmo processo; disputa entre
  processos e crash real pertencem à matriz posterior, não estão certificados aqui.

Gate integral Node24 aprovado, zero falhas. Avisos: placeholder herdado e nomes
Codex/Claude nos scripts de providers; nenhum deles representa atribuição de autoria.
