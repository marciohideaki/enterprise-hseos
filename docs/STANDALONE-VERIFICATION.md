# Standalone Verification — Procedimento

> **Propósito:** verificar que o HSEOS inicia e opera a partir de um clone limpo, sem
> estado da máquina hospedeira, sem skills globais de agente, sem vault second-brain e
> sem servidores MCP pré-instalados (ADR-0006, princípios P5 "zero global path" e P6
> "graceful degradation"), e que o **pacote instalado** funciona como consumidor real.
>
> Atualizado em 2026-10-09. A versão anterior deste documento (Node 20, "Wave 1",
> contagens de testes fixas) está obsoleta e foi substituída.

## Onde isto roda

| Verificação                                                                          | CI                                        | Local                                                 |
| ------------------------------------------------------------------------------------ | ----------------------------------------- | ----------------------------------------------------- |
| Clone limpo: schemas, lint, componentes de instalação, guardas P5/P6, suíte integral | `.github/workflows/standalone-smoke.yaml` | seção "Procedimento local"                            |
| Suíte integral e cobertura crítica 90/80 por arquivo, Node 22 e 24                   | `.github/workflows/ci.yaml`               | `npm test` e `npm run test:kernel-coverage`           |
| Gates de governança (`--phase ci`, `VALIDATION_ENFORCED=true`)                       | job `governance` do `ci.yaml`             | `bash scripts/governance/quality-gates.sh --phase ci` |
| Pacote instalado fora do checkout: plano de controle + SDKs e servidores MCP         | `.github/workflows/core-journey.yaml`     | [`test/journeys`](../test/journeys/README.md)         |

## Procedimento local

Pré-requisitos: Node 22 ou 24, `bubblewrap` e, para testes de executor, cgroup v2 delegado
(os mesmos do CI). Use um ambiente limpo (container ou usuário sem `~/.claude`, `~/.codex`
nem vault montado). Em máquina compartilhada, rode um comando pesado por vez.

```bash
test ! -d ~/.claude && test ! -d ~/.codex && test ! -d /opt/hideakisolutions/second-brain
npm ci
npm run validate:schemas
npm run lint                  # zero avisos
npm run test:install
```

Invariantes P5/P6, como no `standalone-smoke.yaml`:

```bash
! grep -rn --include='*.sh' --include='*.js' "~/\.claude\|/opt/hideakisolutions/second-brain" \
    .agents/ .hseos/agents/ .enterprise/governance/ scripts/governance/ | grep -Ev ":[0-9]+:[[:space:]]*(#|//)"
grep -q "vault_required: false" .agents/skills/second-brain/SKILL.md
grep -q "vault_required: false" .agents/skills/second-brain/QUICK.md
```

Suíte integral e cobertura, dentro de um serviço systemd com cgroup delegado (como o `ci.yaml`):

```bash
sudo systemd-run --wait --collect --pipe --service-type=exec \
  --uid="$(id -u)" --gid="$(id -g)" \
  --property=Delegate=yes --property=DelegateSubgroup=tests \
  --working-directory="$PWD" --setenv="PATH=$PATH" --setenv="HOME=$HOME" --setenv=CI=true \
  bash -c 'node .github/scripts/enable-test-cgroup.mjs && npm test && npm run test:kernel-coverage'
```

## Jornadas do pacote instalado

Gere o tarball (`npm pack`), instale-o fora do checkout e rode as jornadas conforme o
[README de `test/journeys`](../test/journeys/README.md). O CI faz isso para Node 22 e 24
e publica os JSON de resultado como artifact. Sem modelo real, provedor ou segredos.

## Critérios de aceite

Um clone é **standalone-compliant** quando, em ambiente limpo:

- `npm ci`, `validate:schemas`, `lint` (zero avisos) e `test:install` passam.
- `npm test` passa sem falhas nem skips; `test:kernel-coverage` mantém o gate 90/80 por arquivo.
- Os greps P5 não retornam ocorrências e `vault_required: false` consta nos dois arquivos da skill.
- As jornadas do pacote instalado terminam sem FAIL (e sem achados altos no MCP).

Contagens de testes mudam a cada onda: use o recibo vigente em vez de números neste documento
(linha de base atual em [revalidação 2026-10](evolution/revalidation-2026-10/STATUS.md)).

## Limites

Esta verificação não certifica modelo real, provedor, orçamento nem ativação operacional;
essas etapas têm decisões e evidências próprias (ver [docs/evolution](evolution/STATUS.md)).

## Falha

1. Não contornar: o smoke standalone é um gate constitucional (ADR-0006).
2. Abrir uma branch `task/` a partir da base e corrigir a causa raiz; nunca afrouxar gate ou threshold.
3. Se a falha revelar requisito fora do plano, escalar ao ORBIT e redigir emenda de ADR.
4. Repetir o procedimento completo antes do merge.
