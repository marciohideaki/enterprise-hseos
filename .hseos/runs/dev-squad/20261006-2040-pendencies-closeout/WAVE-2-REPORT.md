# WAVE-2 REPORT — 20261006-2040-pendencies-closeout (backend-core)

Branch: `feature/pendencies-closeout-w2` (base `origin/develop` @ `e22294c`). PR: Hideaki-Solutions-Core/backend-core#25.

| Task | Resultado | Commit | Rodadas de correção |
|---|---|---|---|
| B-03 — `verify-vendor` recomputa `bundle_sha256` | DONE (escopo parcial documentado) | `81d987a` → `fe3e73c` | 1 (diretório, valor ausente, forma `=`, mensagem de saída) |
| B-01 — teste do gate de `Compile` | DONE | `7b46167` → `be8d4ae` | 1 (sinal de início do worker antes da janela de 3 s) |
| B-02 — JsonSchema.Net 9.4.0 com registry por store | DONE | `697a2bc` → `6cd65f2` | 2 (fallback `JsonSchema.True` fail-open; `$id` duplicado no `LoadAt`; `$ref` literal em `examples`/`default`) |

## Evidência (branch integrada)

- Conformance 182/182, Approval 51/51 (`dotnet test` por projeto, `-m:1`, via `heavy-run`).
- `contracts:test` 44/44; `contracts:verify` ok, reportando `bundle_sha256: format only`.
- B-01 falha sem o lock de `Compile` e passa com ele (reproduzido pelo revisor).
- B-02: contraexemplos do revisor (dangling stub, `$ref` ausente com `type`, `$ref` para id com falha, autociclo em `$defs`) falham fechado; teste de `LoadAt` repetido falha no código pré-correção.

## Limitações registradas

- `contracts:verify` sem `--ecp-bundle` não detecta `bundle_sha256` adulterado (tarball não vendorizado).
- Tarball 0.4.0 reconstruído localmente difere do publicado, em conflito com a afirmação de reprodutibilidade do README (B-07).
- A necessidade do gate global no 9.x continua não decidida; o gate foi mantido.
