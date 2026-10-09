# Catálogo de rotas W3

Este catálogo classifica superfícies oficiais. A presença de uma rota não instala
um SDK, não autentica uma conta e não certifica a execução. O manifesto fixa o
binding e o artefato; somente uma observação do adapter confirma a identidade
realmente selecionada. O serviço recusa quota remota desconhecida salvo exceção explícita, limitada e auditada do proprietário.

| Família        | Conta/assinatura                                               | API                               | Local                                      | Fronteira atual                                                                                                          |
| -------------- | -------------------------------------------------------------- | --------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Codex          | App Server, conta nativa                                       | App Server, API key explícita     | não estabelecida neste catálogo            | driver existente de instruções, L0                                                                                       |
| Claude         | cliente Claude Code (`claude -p`), implementada como candidata | Agent SDK com autenticação de API | não estabelecida neste catálogo            | conta: binário oficial headless sob o login do proprietário, sem certificação de campanha; SDK: assinatura não presumida |
| Compatível/ACP | não estabelecida neste catálogo                                | API compatível e harness ACP      | endpoint compatível configurado no harness | modelo sob kernel ou composição ACP existente; endpoint e modelo precisam de prova própria                               |
| Antigravity    | cliente oficial                                                | SDK Python                        | SDK Python com LiteRT ou endpoint local    | cliente externo; integração W3 ainda em implementação                                                                    |

## Fontes e limites

Consultadas em 2026-09-26:

- [Codex App Server](https://learn.chatgpt.com/docs/app-server): seleção de conta,
  login/logout e consulta de rate limits são operações distintas da execução.
- [Claude Code authentication](https://code.claude.com/docs/en/authentication) e
  [Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview): distinguir login
  do produto de autenticação admitida para integração programática.
- Claude por assinatura, consultadas em 2026-10-09:
  [headless](https://code.claude.com/docs/en/headless),
  [CLI reference](https://code.claude.com/docs/en/cli-reference),
  [authentication](https://code.claude.com/docs/en/authentication) e
  [legal and compliance](https://code.claude.com/docs/en/legal-and-compliance):
  a assinatura só é usada conduzindo o binário `claude` não modificado, com o login
  do próprio usuário. O Agent SDK não é usado com login de assinatura, credenciais
  não são lidas nem copiadas e `--bare` (que desliga a assinatura) não é usado.
- Provider compatível/ACP: fontes exatas no catálogo de runtime
  `tools/lib/provider-control-manifest.js` e no
  [registro autorizado de comparação](../COMPARISON-2026-09-25.md).
  Configuração inspecionada em `docs/user/guide/providers.md` do checkout
  `477b4f420553e8a52c2fbccc464d7561b239c443`. Formato compatível não comprova
  identidade, quota ou compatibilidade de um endpoint.
- [Antigravity SDK](https://antigravity.google/docs/sdk/overview/) e
  [modelos locais](https://antigravity.google/docs/sdk/local-models/): local admite
  LiteRT ou servidor compatível; os artefatos de modelo não são redistribuídos.
  SDK inspecionado no revision `7f19db07e7c6c5038102b45a8a7a5da7eecc8b11`.

`account`, `api` e `local` são seleções explícitas. Créditos adicionais não são
tratados como parte gratuita da assinatura. O manifesto atual exige uma rota
metered separada para consumo pago. Não há pooling de identidade nem fallback
entre credenciais. `configuration: valid` e `real_conformance: not_certified` são
estados simultaneamente possíveis e intencionais.

## Disponibilidade no serviço candidato

O CLI registra factories de API compatível, Codex conta/App Server, Claude API/SDK,
Claude conta/cliente headless e Antigravity local/LiteRT. Consulte [execução candidata](ADAPTERS-CAMPAIGN.md)
para contratos e limites. Todas permanecem sem certificação de campanha real.
Os testes de protocolo não comprovam login, quota, cobrança ou recuperação real;
instalação externa e campanha real têm aceites separados.

A nomenclatura neutra da fronteira ACP segue ADR-0025 e documentation-policy §10.
Os identificadores executáveis e o escopo das quatro integrações permanecem iguais;
essa redação não amplia as exceções do gate nem altera os contratos de runtime.
