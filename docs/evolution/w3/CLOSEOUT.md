# W3 — aceite técnico da entrega corrente

A implementação de bindings, admissão, adapters reais, orçamento composto,
ponte Antigravity e campanhas está validada no escopo corrente. Por instrução
explícita do proprietário, o ensaio real da quarta família fica para depois de
todas as fases. Esse requisito continua pendente e não é declarado concluído.

## Evidências de aceite

| Critério           | Resultado e evidência                                                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR01–FR06          | Contratos, identidade/quota, autorização, reservas duráveis, composição e paridade CLI/HTTP/SDK implementados; testes integrais e campanhas abaixo |
| FR07 atual         | ACP/Codex e Claude com recuperação real; Antigravity local com pai retomado e filhos reais; replay e drain aprovados                               |
| FR07 diferido      | Quarta família, por instrução explícita na spec; não bloqueia o avanço atual                                                                       |
| FR08               | Full Node 22/24 PASS; cobertura integral dos 56 arquivos ≥ 90/80 em ambos; 528 testes críticos Node 22 sem falhas/skips                            |
| Instalação externa | 64/64 por runtime; fixtures, offline e ABI SQLite provisionado explicitamente                                                                      |
| Orçamento          | Teto10USD, reservas US$ 9, saldo US$ 1; 30 despachos; valores informados pelo SDK não substituem fatura                                            |

Fontes e resultados vinculados por SHA-256 em
`evidence/final-matrix/receipt.json`, `evidence/integral-matrix-resume/receipt.json`,
`evidence/integral-revalidation/receipt.json` e
`evidence/real-campaigns-resume/receipt.json`.

A última cobertura foi executada após autorização específica do dono para
exceção à espera por capacidade (§3f do contrato global). Observação do processo
principal confirmou CPUQuota 100%, memória de 3.221.225.472 bytes, TasksMax 512 e afinidade
CPU 0. A autorização não alterou testes, limiares ou requisitos de validação.

## Revisão cética final

A conclusão foi confrontada com regressões anteriores, fontes atuais e recibos:
manifesto CLI/TMPDIR/create-only/ambiente congelado foram corrigidos e os testes
integrais passaram depois. Os cinco módulos ACP agora integram o gate individual;
a cobertura agregada não foi usada para ocultar arquivos abaixo do mínimo.

Recibos de replay não foram confundidos com recuperação: ACP e Claude tiveram
segundo despacho na mesma sessão; Claude comprovou mudança 42→43. Antigravity
retomou o pai, enquanto cada filho usou sessão própria, com quatro despachos
no orçamento composto. A prova ACP sem ferramentas não certifica confinamento
universal dos outros clientes externos. Gemini API não foi testada.

A afirmação “quatro famílias reais concluídas” é falsa e não é feita. A afirmação
“o programa inteiro terminou” também é falsa: W4–W8 e a validação diferida seguem
pendentes. AEW aplicação/enforcement não verificados. ADR-0044 permanece candidato.

## Entrega Git

Task isolada `task/hseos-w3-prototype`, feature W3 baseada na foundation que recebeu
W1/W2 por PRs 178/179. A task passa por validate/commit/merge do worktree-manager e
os hooks permanecem ativos. PR destinada à foundation; merge exige autorização
específica após checks. Não há publicação nem ativação operacional nesta entrega.
A worktree pode permanecer preservada enquanto houver estado local de campanha
necessário para auditoria e reconciliação; limpeza não deve apagar esse estado.

## Ajuste documental detectado pelo gate de fechamento

O primeiro gate de fechamento reprovou porque três cópias forenses dos scripts
privados de campanha foram anexadas como `.cjs` e entraram no lint executável.
As cópias foram arquivadas como `.cjs.txt`, sem alterar nenhum byte dos scripts
executados. O manifesto anterior e a correspondência de nomes/hashes foram
preservados em `evidence/real-campaigns-resume/script-archive-format.json`.
Nenhuma regra de lint foi desabilitada e nenhum código de runtime foi alterado.
