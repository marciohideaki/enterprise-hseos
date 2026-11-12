# WAVE-TC-REPORT — aceite instalado, reconciliação e documentação do terminal

Branch `feature/terminal-closeout-tc` (base: topo da TB `026acac9`, já contido na `master` pelo merge da #315; a PR vai para a `master`).

| Task | Lacuna | Commit | Arquivos | Prova principal |
|---|---|---|---|---|
| TD1 | GM-09..GM-14 | `d0f1b325` | `requirements.json` (só textos), `PLAN.md`, `MAPA.md`, `STATUS.md`, `w3/TRACE.json` (1 linha) | inventário sem contradição entre os docs; conflito de F01/F11/F16/F21 com o ADR-0050 declarado e ligado ao OG-01; nenhum `status.*` mudou |
| TD2 | GM-08 | `d0737435` | `docs/terminal.md`, `docs/README.md` | documentação de usuário do terminal com o que não está certificado; comandos conferidos no manifesto |
| TC1 | GM-06, GM-07, GM-17 | `2f973040`, rodada 2 `4c82765c` | `docs/evolution/terminal-closeout/**` | instalação `--offline` fora do checkout; `core-journey` PASS 12, `mcp-journey` legado PASS 144 e moderno PASS 507; upgrade sem reescrever eventos; downgrade recusado sem escrita; rollback ao sha256 original; migração de banco ativado entre schemas BLOCKED (OG-16) |
| TD0 | GM-18 | `75382d1c` | `README.md` | contagem de skills 52 → 54; `verify-doc-facts.sh` rc=0 |

Nenhum arquivo de produto mudou; `package.json` não mudou (o hash da F14 v4 segue `d2652177…`).
