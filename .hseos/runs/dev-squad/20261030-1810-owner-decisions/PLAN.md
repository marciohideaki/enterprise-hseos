<!-- G2: aprovado pelo owner em 2026-10-30 ("Plano aprovado") -->
# Plano — decisões do owner de 2026-10-30 sobre a auditoria W0–W5

## Context
Na sessão de 2026-10-30 o owner respondeu às 16 decisões abertas depois das correções #255–#257 (master `f953992b`). Este plano executa as respostas dos itens 1 a 8. Os itens 9 a 16 continuam abertos.

| Item | Decisão do owner | Como executa |
|---|---|---|
| 1 | Refazer a auditoria, focada | Reauditoria dos 20 achados sobre a master final, por último, para cobrir também as mudanças deste plano |
| 2 | Revalidar os aceites | Revalidar os 20 resíduos "aceito" do `w5/STATUS.md`, com foco nos 8 cujo dono é o owner, e trazer perguntas sobre irregularidades |
| 3 | Aceitar os ADRs | ADRs 0042–0045 passam a Accepted (owner, 2026-10-30) |
| 4 | Revalidar e marcar piloto | Conferir família por família, com evidência, o que foi ativado no piloto de 22/10. O que tiver prova vira `pilot_enterprise_hseos_only`; o restante fica `not_authorized`. O guard do inventário passa a aceitar o novo valor |
| 5 | Criar o ADR | ADR-0049, fork e upstream do Code OSS para a W6, como **Proposed** |
| 6 | Incluir no c8 | Ledger e banco da ativação entram no `.c8-kernel.json`, com testes até 90/80, sem baixar limite |
| 7 | Repassar o token | `HSEOS_SUITE_ORPHAN_TOKEN` passa a chegar aos filhos lançados com `env: {}`, só quando existe no pai |
| 8 | Retenção de 90 dias e digest | (a) Saída dos adapters retida por 90 dias, com expurgo. (b) Digest de conta com sal (HMAC, chave por instalação), formato v2, v1 legível. O g9 fica para depois |

## Execution Protocol
- **Coordenação.** `dev-squad`/SWARM (ADR-0015; `.enterprise/governance/agent-skills/dev-squad/SKILL.md`).
  - Commander: esta sessão, em Opus. Planeja, extrai handoffs, decide vereditos e consolida.
  - Executores: Sonnet, 1 por task, cada um em worktree próprio via `worktree-manager.sh create`.
  - Revisor cético: Sonnet isolado por task, duas passagens (cega, depois confronto). Reporta e não corrige. No máximo 3 rodadas de correção.
- **Run dir.** `.hseos/runs/dev-squad/20261030-1810-owner-decisions/`, com INTAKE, PLAN (G2), STATUS, `prompts/`, `logs/` e a cópia de `prompts/COMMON.md` da run `20261027-1900-audit-fixes`.
- **Invariantes.**
  - 1 task = 1 commit, feito por `cg.sh`/`commit-in-cgroup` com o hook ativo, sem `--no-verify` e sem atribuição de IA.
  - G3 sem folga (tools 393, packages 137): nenhum arquivo novo em `tools/` ou `packages/`.
  - c8 90/80, G3 e branch protection nunca afrouxados. Bloqueio vira BLOCKED, nunca PASS.
  - Recibos em `docs/evolution/**/evidence/` não são reescritos.
  - Scratch em `$TMPDIR`. `uptime` antes de carga pesada, uma suíte completa por vez, no máximo 3 executores simultâneos.
  - Nunca `pkill`/`kill` amplo.
  - O banco real `.hseos/state/project.db` e `~/.local/state/hseos` não são tocados.
- **Gates humanos.**
  - G2: aprovação deste plano.
  - Merge de cada PR só com autorização explícita, por squash com corpo limpo e `--match-head-commit`, com `update-branch --rebase` entre elas.
  - O ADR-0049 sai como Proposed. Aceitá-lo é decisão do owner.
- **Versionamento.**
  - Uma feature por onda, a partir de `master`: `feature/owner-decisions-w<k>`, com 1 PR por onda.
  - Integração em worktree dedicado com `git merge --no-ff`, suíte completa da onda pelo runner do repo em cgroup delegado.
  - Depois de cada merge: tag `hseos-owner-decisions-w<k>`, STATUS da run atualizado e MAPA §8 atualizado.

| Onda | Task | Item | Executor | Tier | Arquivos principais |
|---|---|---|---|---|---|
| W1 | D2 revalidação dos aceites (só leitura) | 2 | Sonnet | medium | `w5/STATUS.md`, runs, código citado → `logs/D2-REPORT.md` |
| W1 | D3 aceite dos ADRs 0042–0045 | 3 | Sonnet | small | ADRs, `_INDEX.md`, MAPA §1/§5, referências em `docs/evolution` |
| W1 | D5 ADR-0049 Code OSS (Proposed) | 5 | Sonnet | medium (+1, decisão arquitetural) | `.enterprise/.specs/decisions/ADR-0049-*.md`, `_INDEX.md`, PLAN W6 |
| W2 | D7 token no ambiente filho | 7 | Sonnet | medium (+1, isolamento) | `provider-campaign-process.js:76` e `agent-isolation-attestation/{executor:240,index:514,terminal-executor:88,profiles:435}`, `suite-orphans.mjs`, testes |
| W2 | D6 ledger e banco no c8 | 6 | Sonnet | large | `.c8-kernel.json`, testes de `tools/mcp-project-state/lib/*` |
| W2 | D8a retenção de 90 dias | 8a | Sonnet | large (+1, dados) | `campaign-evidence-store.js`, adapters `provider-{api,acp,native,claude-account}-*.js`, testes, docs |
| W3 | D8b digest com sal v2 | 8b | Sonnet | medium (+1, privacidade) | `provider-claude-account-worker.js:30`, `provider-native-adapter.js:185`, ACP worker/adapter, testes, `v4-migration.md` |
| W3 | D4 `operational` revalidado | 4 | Sonnet | medium | `requirements.json`, guard do inventário, MAPA/STATUS |
| W4 | D1 reauditoria focada (só leitura) | 1 | 2 coletores Sonnet + Commander | — | relatório `CONFORMIDADE-W0-W5-<data>-reaudit.md` em `$TMPDIR` |

A W3 vem depois da W2 porque o D8b toca os mesmos adapters do D8a. A D2 pode gerar perguntas ao owner; se gerar, a W1 fecha sem esperar e as perguntas seguem à parte.

## Verificação
- **Por task:** teste vermelho antes da mudança, mutação dirigida morta, eslint (`node_modules/.bin/eslint`), prettier e G3.
- **Por onda:** suíte completa no cgroup com `verify --shards 6`, mais `check-w4/w5-mutations`.
- **D6:** `npm run test:kernel-coverage` passa com os arquivos novos dentro do gate, sem limite reduzido.
- **D7:** um teste prova que um filho com `env: {}` que fica órfão é detectado pelo supervisor, e que sem o token no pai nada é injetado (produção).
- **D8a:** expurgo testado com relógio injetado (89 dias fica, 91 sai), mais evidência retida nos 4 adapters.
- **D8b:** o digest v2 não é reversível por dicionário sem a chave, o v1 continua legível e o worker ACP compara no mesmo formato.
- **Pós-merge:** CI na master por `workflow_dispatch`.
- **D1:** reauditoria nos moldes da original, com o veredito do Commander.
