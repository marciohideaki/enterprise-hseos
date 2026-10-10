# W5 — estado de execução

Tipo: evidência de progresso, iniciado em 2026-10-10. Base `e079409c`; upstream `master`;
feature `feature/hseos-evolution-w5`. Governança: Constituição §§2.6/5/7, AGENTS.md, ADR-0047 Proposed.

## W5-01

Contratos redigidos na task `task/hseos-w5-contracts`: `.specs/features/harness-w5/{spec,design,tasks,_INDEX}.md`,
`docs/decisions/harness-w5-intake.md`, ADR-0047 (Proposed), `docs/evolution/w5/{PLAN,STATUS,README}.md` e nós
`proposed` no fragmento do grafo de capacidades (fonte `.enterprise` e espelho `.agents`).
Estado: rascunho para revisão do Commander e para o gate G2. Nenhum código de produção alterado.
As verificações registradas pela task (diff, validador de grafo, suítes focadas, contagem do pacote) devem
ser reexecutadas por quem integrar; este arquivo não as certifica por antecipação.

Fatos novos verificados pela task (2026-10-10), com fonte em `design.md` seção 2: o seccomp atual bloqueia
`socket`, `socketpair` e `connect`; `pids_max` padrão é 32; saída do executor é limitada a 64 KiB; o broker de
egresso existente atende uma única rota de provider; em `bwrap --unshare-all` o loopback funciona e não há rota
externa; `xdotool`, `pyright`, `typescript-language-server`, `debugpy` e `python-xlib` estão ausentes no host.

## Matriz de entrega

| Etapa                           | Determinístico                               | Consumidor real | Ativação       |
| ------------------------------- | -------------------------------------------- | --------------- | -------------- |
| W5-01                           | rascunho; verificação pendente de reexecução | não aplicável   | não autorizada |
| W5-02a / W5-02b / W5-04         | não verificado                               | não verificado  | não autorizada |
| W5-03 / W5-05 / W5-06           | não verificado                               | não verificado  | não autorizada |
| W5-07 / W5-08 / W5-09           | não verificado                               | não verificado  | não autorizada |
| W5-10 / W5-11a / W5-11b / W5-12 | não verificado                               | não verificado  | não autorizada |

## Limites e continuidade

- G2 pendente: consumidor real, distribuição core x plugin, orçamento por área (G3), dependências e licenças, perfis de isolamento, autorização de campanha. Ver [PLAN.md](PLAN.md) seção 7.
- Teto do pacote 1540 e orçamentos por área inalterados; projeção na seção 8 do design e na seção 7.3 do plano.
- ADR Proposed documenta design candidato, não aprovação institucional.
- AEW: aplicação/enforcement não verificados. axon: integração opcional.
- Arquivo alheio `HSEOS-GOAL-HARNESS-AUTONOMO.md` preservado fora desta worktree.
