# ADR draft — Lifecycle de terminais candidatos

Status: draft. Autoridade: solicitação W2 de 2026-09-26, ADR-0043/0044,
Constituição §§2.6/5/7, Data Contracts & Schema Evolution e Hexagonal Architecture.

Decisão proposta: estender executor Linux e controle existentes com broker PTY/pipe;
reutilizar ledger e limites, sem IDE no kernel. Recuperação drena processos e
preserva incerteza; não tenta inferir exactly-once para efeitos externos.

Alternativas: daemon operacional persistente exige ativação e ownership novos;
PTY no host enfraquece isolamento. Nenhuma é autorizada nesta candidata.
Risco: crash pode perder output/receipt; mitigação é reconciliação explícita e ausência
de retry automático. Fixtures temporárias não garantem retenção após reboot/limpeza.
Rollout: candidata isolada com matriz 22/24 e testes de falha; ativação permanece
separada. Rollback: parar admissões, cancelar/drain e conservar evidências.
