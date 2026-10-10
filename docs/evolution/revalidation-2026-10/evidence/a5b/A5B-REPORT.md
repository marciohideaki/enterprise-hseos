# A5b - jornada governada campanha -> tarefa (2026-10-09)

Pacote fcb81c1a... instalado offline em consumer/. Serve em cgroup delegado. Verificador fixado da A5 (mesmo sha). Clones novos a5b-target-{sub,api}. Autorizacoes e grants em authorization-record.json (excecao de quota do owner registrada, 3 despachos assinatura; API: grant novo de US$0,75 = US$1,00 menos US$0,25 reservados na A5, pois o grant da A5 ja foi reivindicado).

| Rota                        | Interface | Despachos | Tokens (in/out) | Custo                                   | Tarefa campaign:// | Verificador externo | Status                            |
| --------------------------- | --------- | --------- | --------------- | --------------------------------------- | ------------------ | ------------------- | --------------------------------- |
| claude/account (assinatura) | CLI       | 1 de 3    | 2779/1767       | US$0                                    | approved           | PASS                | PASS                              |
| claude API paga             | SDK       | 1         | 1979/2613       | US$0,0166 real (SDK); US$0,25 reservado | approved           | FAIL                | jornada PASS; aceite externo FAIL |

Sem passo manual: campanha -> GET evidence (campaign-evidence/SDK) -> create com responses_from -> resume -> review -> apply. Negativo real: reuso da mesma saida em outro recurso = CONTROL_CAMPAIGN_EVIDENCE_CONSUMED (ambas as rotas). Identidade da assinatura observada (digest 704dfbe7...), quota_admission=owner_exception, reserva 0.
API FAIL: Haiku manteve `3103` na coluna Port e nao disse "optional" (C8, C10); o verificador interno (content-includes) aprovou. Nao refiz: grant de 1 requisicao, sem contorno.

## Nao observado

init (apiKeySource, fast_mode_state, model), rate_limit_event e pids_peak so entram no hash evidence_sha256; recibo e evidencia nao os expoem. Nao recuperavel sem contorno ou despacho extra (sessao nao persistida). Registrado como lacuna.
Codex: nao usado. Evidencias: routes/{sub,api}/, a5b-result.json.
