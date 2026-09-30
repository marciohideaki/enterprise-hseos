# W3 — retomada da matriz e ordem das campanhas

Em 2026-09-27, a matriz funcional integral passou no snapshot corrigido em
Node 24.15.0 e Node 22.23.3. Ambos os gates completos terminaram com zero falhas
e um aviso histórico de placeholders. Nenhum teste pulado foi identificado.
A cobertura integral Node 24 passou nos 56 arquivos críticos: agregado de
96,24% linhas e 89,54% ramos, com cada arquivo acima de 90% / 80%.

A cobertura integral Node 22 não iniciou: após a suíte funcional, a carga de
um minuto permaneceu acima dos seis núcleos físicos. O scheduler foi encerrado
enquanto aguardava, sem interromper teste ativo. Regra: contrato global de
agentes, §3f. O port-forward temporário da validação foi encerrado no cleanup.
As fontes continuam com os mesmos hashes da revalidação anterior.

## Campanhas e orçamento

O usuário autorizou prosseguir com a matriz e as campanhas reais após a proposta
de até duas chamadas Claude, reserva conjunta máxima US$ 1. Essa autorização
está preservada; não requer nova confirmação para executar o mesmo plano.
Nenhuma chamada nova de inferência foi executada nesta rodada.

- Teto acumulado: US$ 10; reservas históricas: US$ 8; saldo não comprometido: US$ 2.
- Despachos históricos de campanha: 22; não reiniciar a contagem nem liberar reservas.
- ACP: duas chamadas na rota de conta, custo pago adicional autorizado zero,
  inspeção de identidade/quota e prova de ferramentas antes do despacho.
- Claude: duas chamadas com recuperação da sessão, até US$ 0,50 por chamada.
  Script valida respostas iniciais/retomadas e depende do recibo ACP drenado.
- API compatível: falta referência segura da credencial. Busca limitada aos nomes
  das entradas do pass e às variáveis de ambiente do processo não identificou
  referência utilizável; isso não prova ausência em todo o ambiente.
- Antigravity: por decisão explícita do usuário, testar por último. A rota local
  tem evidência histórica; Gemini API continua dependendo da referência da chave.

## Próxima execução

Retomar somente a cobertura Node 22 pelo script ignorado
`.logs/runs/w3-integral-closeout/resume-coverage-node22.py`, após verificar capacidade
e restabelecer o port-forward PostgreSQL compartilhado 39317. O script preserva
os três estágios aprovados em `matrix-checks.json` e remove o symlink ABI22 no finally.
Depois, executar os scripts preparados em `acp-revalidation/` e `claude-recovery/`,
sequencialmente, sem apagar guardas de execução, recibos ou reservas anteriores.

## Revisão cética

- Matriz funcional verde não encerra FR08: falta cobertura Node 22.
- Autorização de campanha não é evidência de execução: novas chamadas são zero.
- ACP sobre Codex não comprova a quarta família; identidade permanece Codex.
- Adiar Antigravity muda a ordem, não dispensa o aceite FR07.
- Custos reportados por SDK não comprovam fatura nem liberam reserva conservadora.
- Consumidores instalados anteriores usam fixtures; não substituem campanha real.

FR07/FR08 permanecem sem aceite integral. Nenhum requisito foi reduzido, nenhum
commit/PR/merge W3 foi criado. AEW: aplicação/enforcement não verificados.
Evidências imutáveis: `evidence/integral-matrix-resume/receipt.json` e hashes locais.
