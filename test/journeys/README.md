# Jornadas de consumidor real

Duas jornadas que exercitam o **pacote instalado** (tarball de `npm pack` instalado
fora do checkout), como um consumidor o usaria. Ficam em `test/`, portanto não
entram no pacote. Não usam modelo, provedor nem segredos: as respostas são fixtures
roteirizadas. Contexto e resultados: [revalidação 2026-10](../../docs/evolution/revalidation-2026-10/README.md).

| Arquivo                                  | Papel                                                                                                                             |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `core-journey.mjs`                       | Plano de controle: API HTTP e SDKs JS, TypeScript e Python contra uma única instância de `hseos control serve` em cgroup delegado |
| `sdk-ts-client.ts`, `sdk-ts-negative.ts` | Worker TypeScript tipado (strict, nodenext) e contrato negativo de tipos                                                          |
| `sdk_py_client.py`                       | Worker Python (somente stdlib)                                                                                                    |
| `mcp-journey.mjs`                        | Os 4 servidores MCP do pacote instalado                                                                                           |

O script de cgroup é derivado em tempo de execução de `.github/scripts/enable-test-cgroup.mjs`
(só o import muda, para apontar ao executor instalado).

## Pré-requisitos

- Linux com cgroup v2 delegável via systemd, `bwrap` (bubblewrap) e, em runners com
  AppArmor, `kernel.apparmor_restrict_unprivileged_userns=0`.
- Node 22 ou 24 (o worker TypeScript roda por remoção nativa de tipos). `/usr/bin/node` deve
  ser o mesmo Node, como no `ci.yaml`.
- Python 3 (`python3` no PATH, ou `--python`/`PYTHON`).
- `npm ci` no checkout: o `tsc` vem de `node_modules/typescript` (ou `--tsc`/`TSC`).
- Sem cgroup delegado a criação de tarefas retorna `ENGINEERING_ISOLATION_UNAVAILABLE`.

## Comando

```bash
npm pack --pack-destination /tmp/j/pack
mkdir -p /tmp/j/consumer && (cd /tmp/j/consumer && npm init -y >/dev/null && npm install /tmp/j/pack/hseos-*.tgz)
# estação de trabalho (systemd --user):
node test/journeys/core-journey.mjs --prefix /tmp/j/consumer --tgz /tmp/j/pack/hseos-*.tgz --out /tmp/j/out/core
node test/journeys/mcp-journey.mjs  --prefix /tmp/j/consumer --tgz /tmp/j/pack/hseos-*.tgz --out /tmp/j/out/mcp
```

Os caminhos acima são exemplos. Opções de `core-journey.mjs`: `--service-mode user|system`
(`system` usa `sudo systemd-run --uid/--gid`, como no CI), `--only s03,s06`, `--max-load N`,
`--keep-work`. `mcp-journey.mjs` aceita `--fail-on none|low|medium|high` (padrão `none`, só relata) e
`--axon-real optional|required` (padrão `optional`: o axon é uma integração opcional do HSEOS). Com `optional` e o binário
`axon` ausente do PATH, as checagens que exigem um axon real (`get_overview`, `code_search` do axon-bridge, em stdio e HTTP)
recebem o status `NOT_EXERCISED` (distinto de PASS e de BLOCKED), o JSON registra `axon_real: "not_exercised"` com a causa
e o veredito não falha por isso; com axon no PATH elas rodam e contam normalmente. `required` (opt-in) transforma a ausência
em BLOCKED e reprova. Os cenários de axon ausente (`AXON_UNAVAILABLE` explícito, sem falso sucesso) são obrigatórios em
qualquer modo. O CI usa o padrão (o runner não tem axon); o axon real é exercitado na revalidação local
(`docs/evolution/revalidation-2026-10`).
Cada passo registra PASS, FAIL, BLOCKED (ou NOT_EXERCISED, só no mcp-journey); a saída é `core-journey-result.json` e
`mcp-journey-result.json` no diretório `--out`. O núcleo sai com 1 se algum passo não for PASS.

Em máquinas compartilhadas, rode sob `heavy-run` e um job por vez. No CI: workflow
`.github/workflows/core-journey.yaml`.
