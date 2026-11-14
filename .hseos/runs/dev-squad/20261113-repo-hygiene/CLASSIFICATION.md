# CLASSIFICATION — run `20261113-repo-hygiene` (onda HA, fase 3)

Quem classificou foi o Commander, com base no grafo de referências `docs/hygiene/20261113/reference-graph.{mjs,config.json,json}`. O grafo foi gerado na base `a4fabbd5` pelos commits `ae717dc0`, `ddde51e9` (rodada de correção 1: não citantes) e `256426b5` (rodada de correção 2: citações por caminho absoluto, reticências e glob genérico, a partir do MAJOR do revisor). É determinístico: duas execuções deram o mesmo sha256 `f39e0c1c…`. Critério das classes: seção 6 do prompt (ver `INTAKE.md`).

## Método e prova

1. **Grafo.** Para cada arquivo versionado sob os prefixos candidatos (2989 arquivos, 32,56 MB), o grafo lista quem o cita. Conta como citação: caminho completo, caminho relativo, diretório ancestral específico ou glob. A citação só por nome de arquivo é marcada como fraca e não bloqueia.
2. **Ponto fixo.** Um candidato só é `removable_by_graph` se todos os seus citantes também forem removíveis. Esse é o critério de "cadeia fechada" da seção 5 do prompt.
3. **Não citantes.** Estes arquivos não contam como citação:
   - inventários-instantâneo, isto é, mapas de caminho para sha256 num commit fixo: 12 arquivos, entre eles `docs/evolution/baseline.json` e os `*sources.json`;
   - os padrões de exclusão `.gitignore` e `.prettierignore`.

   Os motivos estão um a um em `nonCitingReasons`.
4. **Resultado.** Saem 145 removíveis, somando 0,562 MB.
5. **Cenário hipotético, não versionado** (`$TMPDIR`). Mesmo tratando todo registro de run e todo `*.log` de `docs/` como não citante, as áreas de evidência continuam ancoradas por citação viva: `docs/v4` 3 de 108, `consumer-validation-2026-10` 1 de 30, `w1`–`w5`/`evidence` 0. Isso confirma que essas áreas são EVIDÊNCIA-CITADA e não andaime. O cenário só liberaria mais 84 arquivos de run, citados apenas pelo `STATUS.md` da própria run, e isso virou o OG-H07.

## Classes por área

| Área | Arquivos | Classe | Prova (citante que mantém) |
|---|---|---|---|
| `.hseos/runs/dev-squad/*` — prompts, logs, INTAKE e PLAN não citados, mais `.current-run-id` (ponteiro morto: nenhum leitor) | 140 | **ANDAIME** | `removable_by_graph: true`; nenhum citante fora do conjunto |
| `.hseos/runs/dev-squad/*/STATUS.md` e os relatórios citados; toda run mantém o `STATUS.md` | 150 | EVIDÊNCIA-CITADA | MAPA, `PLAN`, `.enterprise/agents/atlas/authority.md` e outros |
| `.hseos/runs/standalone-migration/` (README, STATUS, `handoffs/.gitkeep`) | 3 | **ANDAIME** | nenhum citante fora da própria pasta (`git grep standalone-migration` só acha inventários); o `.gitkeep` era citado só por glob genérico (`!**/.gitkeep`) |
| `docs/audits/2026-09-07-repository-consolidation/{README.md,inventory.json}` | 2 | **ANDAIME** | auditoria pontual superada; citada só por inventários e pela própria pasta |
| `docs/audits/PCCP-COMPLETION-AUDIT.md` | 1 | EVIDÊNCIA-CITADA | `_graph/pccp-governance/state/checkpoints/03-completion-audit.md` |
| `docs/evolution/**` (w0–w5, w10, evidence, revalidation, consumer-validation, terminal-closeout, audit-2026-10-27, COMPARISON) | 2383 | EVIDÊNCIA-CITADA | `requirements.json`, `TRACE.json`, `terminal-readiness.json`, `PLAN.md`, runbooks, ADR-0043/0047/0048, `core-journey.yaml`, `test-package-surface.js` |
| `_graph/` | 117 | NECESSÁRIO / EVIDÊNCIA-CITADA | `test/test-agentic-framework-foundation.js`, ADR-0025, `runbooks/activation.md` |
| `.specs/` (raiz) | 42 | NECESSÁRIO (spec) | **não é duplicata**: 0 de 42 blobs iguais em `.enterprise/.specs`; `AGENTS.md` §12 cita `.specs/features/harness-w5/liveness.md` |
| `docs/v4/` | 108 | EVIDÊNCIA-CITADA | ancorada mesmo no cenário hipotético (105 de 108) |
| `docs/goals/` | 11 | DÚVIDA → OG-H08 | cadeia ancorada por `docs/pt-br/especificacao-hseos.md` (vivo) e por recibos de consumer-validation |
| `docs/evidence/` | 4 | EVIDÊNCIA-CITADA | `docs/governance-discovery-hardening.md` (vivo) |
| `docs/releases/` | 14 | NECESSÁRIO | `.github/workflows/release.yaml`, `test/test-governance-scripts.js` |
| `plugins/` | 5 | NECESSÁRIO | READMEs de definição de plugin e testes |
| `smithery.yaml` | 1 | NECESSÁRIO | `README.md`, teste |
| `.logs/` versionado (`.gitkeep` ×3, `summaries/managed-governance-validation.md`) | 4 | NECESSÁRIO | `AGENTS.md` §10, `quality-gates.sh` |
| `.codex/`, `.claude/` versionados | 10 | NECESSÁRIO | configuração de host (fora do conjunto candidato do prompt) |
| `HSEOS-GOAL-HARNESS-AUTONOMO.md`, `_pipeline/` | 2 | NÃO TOCAR (seção 1) → OG-H01 | também citados por ADR-0040, ADR-0032 e testes |
| `docs/assets/` (15,4 MB de PNG) | 13 | NECESSÁRIO | `README.md` e docs (não é candidato) |

Total ANDAIME: **145 arquivos** (140 de `dev-squad`, 3 de `standalone-migration`, 2 de `docs/audits`), 562188 B. A lista, gerada do grafo sem edição manual, está em `REMOVAL-SET.txt` (sha256 `6bc5af85…fbbb8`). DUPLICADO: **nenhum**.

## O que este método não prova

- Caminho montado dinamicamente (`path.join`, `readdir`) não aparece no grafo. A cobertura disso vem da remoção simulada com a suíte completa (seção 5.4) e da passagem (b) do revisor.
- Um link absoluto para o repositório no GitHub (URL) não é detectado. Caminho absoluto de disco para dentro do repositório é detectado desde a rodada 2.
- Uma citação pelo run-id sem caminho (ex.: "run `20261030-1810-owner-decisions`") não protege arquivos. Todas as que o revisor achou citam a run como conceito ou arquivos que ficam (`STATUS.md` etc.).
- Uma citação só pelo nome de um arquivo genérico (ex. `workflow.js`) é tratada como falso positivo. Ela fica registrada aqui, não é ignorada em silêncio.

## Revisão cética

Ver `REVIEW-HA.md`.
