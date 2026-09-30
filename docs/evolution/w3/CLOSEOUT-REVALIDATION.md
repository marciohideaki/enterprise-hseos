# W3 — revalidação para fechamento integral

W3 permanece pendente. Esta rodada corrigiu falhas encontradas pela regressão
integral e ampliou a verificação ACP; não certifica FR07 nem autoriza merge.
As evidências anteriores são checkpoints imutáveis, não certificados do novo
snapshot. Fonte de aceite: `.specs/features/harness-w3/spec.md`, FR07/FR08.

## Correções verificadas

- Manifesto CLI regenerado pelo compilador após registro do adapter ACP.
- Testes de CLI Codex e launcher da fixture de API compatível preservam o
  diretório temporário do teste. O gate de ativação do ledger não foi relaxado.
- Claude distingue o evento local inicial, sequência 1, de progresso posterior:
  `create-only` pode ser reanexado sem transcript. A campanha exige explicitamente
  sessão remota existente; transcript perdido não vira sessão nova silenciosa.
- Transporte ACP entrega cópia do ambiente a `spawn`, preservando seu snapshot
  imutável e permitindo a instrumentação de cobertura do Node.
- Cinco módulos ACP passaram a integrar a cobertura crítica por arquivo;
  o teste de superfície exige sua presença. Incluídos casos negativos de pins,
  identidade, quota, metadados, comandos, ambiente e recibos incertos.

## Evidências e limites

Pacote instalado fora do checkout: **64/64 Node 24 e 64/64 Node 22**. Instalação
offline, scripts de lifecycle desativados e binário SQLite previamente existente
correspondente a cada ABI copiado explicitamente. Exercita consumidores
CLI/HTTP/JS/Python e controles ACP com fixtures; não faz inferência real.
Integração PostgreSQL: **15/15**, no serviço compartilhado já existente.
Regressão focada final: **55/55 em cada Node 22/24**, sem falhas ou skips.
Os cinco módulos ACP passaram individualmente no gate 90/80; agregado desse
recorte: 99,07% linhas / 98,12% ramos. Menor resultado individual:
95,41% linhas / 95,83% ramos no worker. Isso não substitui o gate integral.

A regressão integral Node 24 detectou o manifesto desatualizado, a divergência de
TMPDIR e a regressão Claude. As falhas foram corrigidas e reexercitadas. Entretanto,
a matriz integral final Node 22/24 e o gate integral de cobertura **não passaram
nesta rodada**: a última tentativa integral terminou na fixture de API compatível,
e a tentativa de cobertura encontrou o ambiente congelado. Não substituir esses
resultados por PASS dos testes focados.

A retomada automática da matriz aguardou capacidade e foi encerrada sem iniciar
nova suíte: carga do host persistiu acima dos seis núcleos físicos, chegando a
11,11. Regra aplicável: contrato global de agentes, §3f. Ensaios isolados seguintes
usaram um CPU e prioridade reduzida. Nenhum processo de outro trabalho foi encerrado.

## Revisão adversarial

| Afirmação                                                      | Resultado da tentativa de refutação                                              |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Testes focados anteriores bastavam para fechar W3              | Refutada: a suíte integral encontrou regressões não cobertas por aquele recorte. |
| `create-only` exige transcript remoto                          | Refutada: o primeiro evento é local, anterior à primeira inferência.             |
| Liberar `create-only` pode liberar recriação de sessão perdida | Risco reproduzível; campanha agora impõe `require_existing`, com teste negativo. |
| Ambiente validado pode ser entregue congelado ao Node          | Refutada sob c8; cópia de transporte preserva a imutabilidade do snapshot.       |
| Cobertura agregada comprova cada arquivo crítico               | Refutada; cinco módulos ACP foram adicionados ao gate individual 90/80.          |
| Instalação externa comprova campanha real                      | Refutada; recibo classifica explicitamente os consumidores como fixtures.        |
| ACP Codex completa sozinho a quarta família                    | Refutada pelo catálogo do runner; a identidade continua Codex.                   |
| O fechamento pode ser declarado apesar de FR07 incompleto      | Refutada pelo aceite da especificação.                                           |

## Pendências de aceite e entrega

1. Reexecutar matriz integral e cobertura Node 24/22 quando houver capacidade.
   Comandos canônicos: `VALIDATION_ENFORCED=true scripts/governance/quality-gates.sh
--phase full` e `npm run test:kernel-coverage`, um por vez e sob delegação cgroup.
2. Recuperação Claude com novo turno: solicitada autorização de até duas chamadas,
   reserva conjunta máxima US$ 1, dentro do saldo original. Autorizações anteriores
   foram consumidas; nenhuma nova autorização foi presumida.
3. Quarta família/API compatível: referência de credencial ainda solicitada.
   Referência Gemini também solicitada para o ensaio Antigravity API futuro;
   Antigravity local já possui evidência e não depende dessa chave.
4. Revalidar o artifact ACP atual em campanha de conta, pois os hashes incluem
   fontes corrigidas. Script preparado, **não executado**, sem apagar campanhas antigas.
5. Após aceite, integrar a task à feature W3, preparar PR contra a foundation e
   seguir o closeout governado. Não há commit, PR ou merge W3 nesta rodada.

Orçamento preservado: teto original US$ 10, reservas históricas US$ 8 e saldo
não comprometido US$ 2. **Zero chamadas novas de inferência nesta rodada**;
22 despachos de campanha anteriores permanecem registrados. Não liberar reservas
nem certificar fatura a partir de custos informados pelo provedor.

Evidências desta rodada: `evidence/integral-revalidation/receipt.json`.
AEW: aplicação/enforcement não verificados. ADR-0044 permanece candidato.
