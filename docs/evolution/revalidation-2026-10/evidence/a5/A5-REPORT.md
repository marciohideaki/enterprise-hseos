# A5 - Tarefa de engenharia real com modelos reais (revalidacao 2026-10)

Tarefa: atualizar a secao "Native MCP Servers" do README (axon-bridge: stdio padrao; HTTP opcional com --http/--port e HSEOS_AXON_BRIDGE_CREDENTIAL >= 32 chars), em clones descartaveis, com HSEOS 4.0.0-rc.0 instalado offline fora do checkout (/tmp/hseos-reval/consumer-a5/project), serve em cgroup delegado. Verificador externo: verifier/verify-readme.mjs (sha em authorization-record.json, fixado antes dos despachos; controle negativo falha no baseline, positivo passa).
Autorizacao do owner (2026-10-09) registrada em authorization-record\*.json; nenhuma autorizacao W3/W4 reutilizada (grants novos).

| Rota                         | Interface | Status          | Despachos                    | Custo                              | Verificador externo |
| ---------------------------- | --------- | --------------- | ---------------------------- | ---------------------------------- | ------------------- |
| Codex assinatura             | CLI       | PASS            | 2 (1o falhou antes do turno) | US$0                               | PASS                |
| Claude API paga (teto US$1)  | SDK       | PASS            | 1                            | US$0,00696 real; US$0,25 reservado | PASS                |
| Claude assinatura            | -         | BLOCKED         | 0                            | 0                                  | -                   |
| LiteRT local (+ filho Codex) | SDK       | PASS (composto) | 1 local + 1 Codex (3o)       | US$0                               | PASS                |

Codex total: 3 despachos (limite 3). API paga: teto de US$1,00 no grant (verificado no ledger antes do 1o despacho), reserva de US$0,25/req.

## BLOCKED

Claude assinatura: o HSEOS so tem adapter claude/api; o adapter nativo recusa route account (CONTROL_PROVIDER_CONFIGURATION_INVALID). CLI logada (Max), mas nao ha rota governada; nao contornado.

## Ressalvas honestas

- O recibo de campanha so traz hash da evidencia, nao o texto. O patch foi montado a partir do texto do modelo lido nas transcricoes de sessao do vendor (ponte fora do HSEOS) e aplicado pelo contrato de tarefa v2 (prepare, create, resume, review, apply) com respostas roteirizadas. O HSEOS nao tem caminho governado que devolva a saida da campanha para a tarefa.
- LiteRT: o texto foi escrito pelo filho Codex; o Qwen3-0.6B so delegou via run_campaign_model (249/21 tokens medidos). Composicao client+client exige execucao programatica (o loader do serve exige subordinado model).
- Custo real do Claude vem do cost-state do SDK, nao de fatura.

## Achados

Ver a5-result.json (findings): pids_max=64 insuficiente para codex 0.161; web-content-v1 exige max_output_bytes > tamanho do arquivo (max 65536); max_tokens da tarefa; provider_version do binario nativo; regressao de linha em branco pega pelo verificador.

## Evidencia

routes/ (por rota), routes/litert/, routes/codex*/, routes/claude/, authorization-record*.json, a5-result.json, scripts/. Tentativas de tarefa falhas preservadas (codex-task-attempt1..3).
