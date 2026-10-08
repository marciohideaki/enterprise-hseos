# STATUS — 20261007-2130-guard-tokenizer

- Commander: Opus.
- Squad e revisores: Sonnet.
- Base: master `4bff762e`. O N2 foi rebaseado sobre `1c939aa5`.
- Autorização do owner: execução via `/dev-squad` (2026-10-07). Merge do que ficasse disponível (2026-10-08).

## Waves

| Wave | Branch | PR | Estado |
|---|---|---|---|
| A | `feature/ecp-drift-lock-repository` | #209 | Mergeada (`1c939aa5`) |
| B | `feature/guard-real-tokenizer` | PR B | Aberta |

## Nós

| Nó | Estado | Commit | Revisão |
|---|---|---|---|
| N1 ECP drift lê o lock | PASS | `5dcc9b6f` | Passagem cega e confronto deram PASS de primeira; houve só achados minor. |
| Pendência 2 (drift no npm) | Já resolvida na master | — | `package.json:74`/`:174`; não gerou nó. |
| N2 tokenizer real no guard | PASS após 3 arbitragens | `2217c58e` | Detalhes abaixo. |

## Arbitragens do N2 (Commander)

1. **FAIL.** Com o piso `lexLegacyFast`, o invariante de superset da master não valia. Houve deny→allow em TS real, por exemplo `x = a! / /'/; export ...` e `type A = {..} /'/; ...`. Os revisores tinham classificado o caso como minor por ser "JS inválido".
   - **Decisão:** a união passa a ser o tokenizer mais **todas** as views da master, o que dá superset por construção.
2. **FAIL**, por dois motivos:
   - A enumeração 2^k das barras ambíguas de ASI levava o guard a 8 s com 8 barras em 1 MB, contra 110 ms na master. Isso é DoS no hook PreToolUse.
   - O caso realista estava 2× mais lento, e o teste de 200 ms falhou 2 de 3 vezes.
   - **Decisão:** custo linear e limitado, e otimização do tokenizer.
   - A caça achou mais duas entradas de custo quadrático: chaves profundas com crases (29 s) e listas `export {` sem fechamento (14 s). Ambas foram corrigidas.
3. **PASS.**
   - Superset da master: 0 deny→allow em 600k (executor) e em 300k com seed própria (revisor).
   - Custo: o caso realista leva 86–96 ms, contra 51–62 ms na master. Os cenários patológicos ficam em no máximo ~2,5× a master.
   - Suíte do guard 56/56. Os 6 gates verdes em cgroup delegado.

## Riscos residuais registrados (não são regressão)

- **Surface de bypass não esgotada:** as caças terminaram por limite de ciclos, não com 2 rodadas secas. Os últimos achados eram lacunas do scanner aditivo de exports (`extraExportEntries`), que a master também não cobre.
- **`extraExportEntries` falha aberto depois de 6 pulos por cabeça.** A partir do 7º declarador com vírgula dentro de `<...>`, o símbolo seguinte deixa de ser visto. A master também não vê esses casos. Sugestão: falhar fechado, marcando export anônimo, quando o teto for atingido.
- **Custo de cabeças de destructuring sem fechamento:** 7–10× a master (36–100 ms a 800 KB). O custo é linear e fica abaixo do teste de 1 MB / 200 ms.
- **Re-exports com `from`** continuam permitidos, por política (`blankReexports`).
- **Nome de export em string** (`export { x as "Y" }`) é limitação documentada no CHANGELOG.

## Lições

- `test-kernel-mutations` só passa com cgroup delegado. Pre-commit e `validate` precisam rodar via `systemd-run --user -p Delegate=yes ... enable-test-cgroup.mjs`. Executores sem isso reportam BLOCKED falso.
- Revisores que medem `entryCount` fora do worktree, com `git archive` ou worktrees temporários, veem 1474 por resíduo. A medida válida é `npm pack --dry-run` no próprio worktree.
- "Acorn rejeita" não torna irrelevante um deny→allow: arquivos `.ts`/`.tsx` são a entrada típica do guard.
- Medir o pior caso (2^k, quadrático) é responsabilidade do árbitro. Revisor e caçador sem lente de custo deixaram passar.
