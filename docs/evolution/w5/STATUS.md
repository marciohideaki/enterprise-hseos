# W5 — estado de execução

Tipo: evidência de progresso, iniciado em 2026-10-10 e atualizado em 2026-10-11. Base dos contratos `e079409c`, rebaseados sobre a master `0dd3bb89`; upstream `master`;
feature `feature/hseos-evolution-w5`. Governança: Constituição §§2.6/5/7, AGENTS.md, ADR-0047 Accepted (2026-10-11).

## W5-01

Contratos redigidos na task `task/hseos-w5-contracts`: `.specs/features/harness-w5/{spec,design,tasks,_INDEX}.md`,
`docs/decisions/harness-w5-intake.md`, ADR-0047 (Accepted em 2026-10-11), `docs/evolution/w5/{PLAN,STATUS,README}.md` e nós
`proposed` no fragmento do grafo de capacidades (fonte `.enterprise` e espelho `.agents`).
Estado: **concluída em 2026-10-11** com a aplicação das decisões do gate G2 (G2 aprovado pelo owner na mesma data; ver [PLAN.md](PLAN.md) seção 7). Nenhum código de produção alterado.
Próximo passo: **onda B1** (W5-02a, W5-02b1 seguida de W5-02b2, e W5-04; 3 agentes simultâneos, builds serializadas).
As verificações registradas pela task (diff, validador de grafo, suítes focadas, contagem do pacote) devem
ser reexecutadas por quem integrar; este arquivo não as certifica por antecipação.

Fatos novos verificados pela task (2026-10-10), com fonte em `design.md` seção 2: o seccomp atual bloqueia
`socket`, `socketpair` e `connect`; `pids_max` padrão é 32; saída do executor é limitada a 64 KiB; o broker de
egresso existente atende uma única rota de provider; em `bwrap --unshare-all` o loopback funciona e não há rota
externa; `xdotool`, `pyright`, `typescript-language-server`, `debugpy` e `python-xlib` estão ausentes no host.

## Matriz de entrega

| Etapa                                    | Determinístico                                                   | Consumidor real | Ativação       |
| ---------------------------------------- | ---------------------------------------------------------------- | --------------- | -------------- |
| W5-01                                    | contratos concluídos; verificação a reexecutar por quem integrar | não aplicável   | não autorizada |
| W5-02a / W5-02b1 / W5-02b2 / W5-04       | não verificado                                                   | não verificado  | não autorizada |
| W5-03 / W5-05 / W5-06                    | não verificado                                                   | não verificado  | não autorizada |
| W5-07 / W5-08 / W5-09                    | não verificado                                                   | não verificado  | não autorizada |
| W5-10 / W5-10b / W5-11a / W5-11b / W5-12 | não verificado                                                   | não verificado  | não autorizada |

## Gate G2 (aprovado em 2026-10-11)

Decisões do owner aplicadas em PLAN seção 7, spec, design, tasks e ADR-0047:

1. Consumidores reais A (`cambio-real/apps/platform-web`, prova principal) e B (`axon-web`, teste e defeito sintéticos declarados); instalação offline do cache.
2. Distribuição híbrida: contratos e runtime de todas as capacidades no core com carregamento tardio; empacotáveis em `plugins/*` a partir do mesmo código; binários como pins fora dos tarballs.
3. Inventário: elevar o teto (sem realocação); `packages` 123 para 137 e teto 1554 (G3 de 2026-10-11); acima disso só pelo número medido, com novo G3 (projeção alta ≈1565, estimativa); plugins ≤40 entradas e ≤1 MB.
4. Isolamento: P1 e P2 aprovados; seccomp por argumento (permite `AF_UNIX`/`AF_INET*`; bloqueia `AF_NETLINK`, `AF_PACKET`, `AF_VSOCK`, `io_uring`); Chromium com `--no-sandbox` dentro do `bwrap`.
5. Entrada X11 por `xdotool` (BSD), pin externo; `python-xlib` descartado.
6. Modelo nos ensaios (W5-11b): local ou custo zero; assinaturas Claude/Codex com no máximo 3 despachos por binding; API paga com teto de US$ 1; reserva e recibo por despacho; sem rota, BLOCKED; acima do teto, G4.
7. Aceite endurecido na W5: task nova W5-10b (B4), com os resíduos REVIEW3-C1 e N1.
8. Itens menores: B1 com 3 agentes; pins e licenças com "sem download em runtime, sem cache = BLOCKED" e conferência de licença no artefato fixado por task; pendências fora da W5 registradas; W5-02b2 absorve a leitura do virtual store do pnpm e os testes nativos do verificador.
9. G2 fechado; ADR-0047 Accepted.

## Decisões do Commander sobre as inconsistências (2026-10-11)

- **Soma dos orçamentos:** a opção "elevar o teto" do owner implica teto 1554 com `packages` 137, aprovado no G3 de 2026-10-11. A alteração de `test/test-package-surface.js` entra na W5-02a, primeira task que adiciona entradas em `packages`. O extra do híbrido (≈1565, estimativa) só vale pelo número medido no fechamento da onda, com novo G3.
- **`plugins/memory`:** aceito como está; distribui o mesmo código e a persistência continua no ledger do host (a memória não pode ter store próprio fora do ledger). Justificativa no design §5.5.
- **W5-02b dividida** em W5-02b1 (perfis P1/P2, seccomp, artefatos) e W5-02b2 (virtual store do pnpm e verificador com testes nativos), no mesmo slot da B1, em sequência (02b2 depende de 02b1). A W5-10b depende da W5-02b2.
- **Risco `packages` sem folga:** 24 arquivos novos contratados em `packages/` (113 + 24 = 137); se a medição passar de 137, a onda para em G3 com o número medido, sem aumentar o orçamento por conta própria. Lista em PLAN §7.3 e `tasks.md`.
- **Risco `.agents` sem folga:** 5 plugins com 2 ou mais entradas por definição mais o espelho gerado (cerca de 10 ou mais) contra folga de 7; primeiro estouro provável na W5-05 (primeiro plugin). Se a medição estourar, a onda para em G3 com o número medido; nenhum orçamento sobe por conta própria.
- **Cobertura:** por task, c8 focado (`.c8-kernel.json` com `--include` dos arquivos da task); o `npm run test:kernel-coverage` completo roda uma vez por onda, na integração. Testes novos e os existentes citados entram na lista `test:kernel` de `package.json` (W5-02b1, W5-04 e W5-09 registram os já existentes).
- **Mapa de ondas:** B2 é `W5-03 ∥ (W5-05 → W5-06)` e B3 é `(W5-07 → W5-08) ∥ W5-09`; arquivos compartilhados (`.c8-kernel.json`, `package.json`, registro de plugins) são resolvidos por merge na integração da onda.
- **Gerador de plugins:** pertence à W5-05; as demais reutilizam.
- **Projeções por área:** são estimativa, não decisão; vale o medido.
- **Grafo de capacidades:** os nós `proposed` do fragmento descrevem spec, design e intake; continuam coerentes com o híbrido e não foram alterados.

## Limites e continuidade

- Teto do pacote 1554 e `packages` 137 aprovados (G3 de 2026-10-11), mas ainda não aplicados no teste (hoje 1540/123): a alteração entra na W5-02a. Acima de 1554, só pelo número medido, com novo G3.
- ADR Accepted aprova o design da W5; merge, publicação, instalação global e ativação continuam não autorizados.
- Pendências fora da W5, apenas registradas: `loop-guard.sh` em `node_modules`, evidência de saída nos adapters API/ACP/local, digest de conta `claude/account` sem sal, hook de commit que bloqueia nomes de fornecedor.
- AEW: aplicação/enforcement não verificados. axon: integração opcional.
- Arquivo alheio `HSEOS-GOAL-HARNESS-AUTONOMO.md` preservado fora desta worktree.

## Decisão do owner em 2026-10-12: pin de navegador

O pin de navegador passa a ser o `chrome-headless-shell-1228`. O `chromium-1228` saiu dos pins porque é a build do Google Chrome e só traz o LICENSE do Widevine, sem o texto BSD-3, e por isso o critério de licença ficava BLOCKED. O headless-shell traz o BSD-3 (`LICENSE.headless_shell`) e passou no ensaio da W5-02b1 dentro do bwrap no P1. O Chrome completo (`--headless=new`) trava no sandbox. Este host não tem Chromium da distro.
