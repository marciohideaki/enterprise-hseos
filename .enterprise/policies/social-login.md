# Social Login & SSO compartilhado (extensão do §3e)

**Vigência:** 2026-08-21 · **Origem:** validação/pedido do owner (linked-out) — nenhum realm da
frota tinha Identity Provider até esta data.

## Princípio
Login social (Google, Facebook, X, LinkedIn, GitHub, Microsoft pessoal) e SSO corporativo
(Entra ID de parceiros/terceiros) são capacidade COMPARTILHADA, entregue por **identity
brokering do Keycloak compartilhado** (`keycloak.hideakiservicos.net/kc`) — nunca por SDK/fluxo
OAuth dentro do app. O app não muda: os botões aparecem na tela de login do realm dele.

## Fonte de verdade
- **Credenciais**: grupo canônico `pass social-login/` — `<provider>-client-id`,
  `<provider>-client-secret` e, para Entra ID, `entra-id-tenant` (single-tenant é o default
  seguro; sem tenant o script usa `organizations` com a ressalva de issuer multi-tenant).
  Providers suportados: `google` · `facebook` · `x` (provider nativo twitter) · `linkedin`
  (linkedin-openid-connect) · `github` · `microsoft` (conta pessoal) · `entra-id` (OIDC genérico).
- **Provisionamento**: `enterprise-hseos/scripts/social-login/provision-social-idps.sh <realm>
  [providers...]` — idempotente; provider sem credencial vira IdP DESABILITADO (esqueleto que
  habilita sozinho na re-execução após `pass insert`); imprime os redirect URIs a registrar no
  console de cada provider (`.../realms/<realm>/broker/<alias>/endpoint`).

## Regras
1. Um OAuth app por provider serve a frota DEV inteira (redirect URIs múltiplos, um por realm).
   Produção/marca própria: OAuth app dedicado por produto (consent screen com a marca certa).
2. §3c integral: credencial nasce no `pass` ANTES de ir ao Keycloak; nunca em git/echo.
3. `syncMode=IMPORT`, `trustEmail=true`, sem `storeToken` — o broker federa identidade, não
   armazena tokens do provider.
4. Entra ID de parceiro = IdP `oidc` por tenant (alias `entra-id` ou `entra-<parceiro>` para
   múltiplos parceiros no mesmo realm); nunca misturar com o provider social `microsoft`.
5. WAF Cloudflare do tunnel exige User-Agent de navegador em chamadas de script à admin API.

## Estado (2026-08-21)
Realm `linkedout`: 7 IdPs provisionados — **google HABILITADO** (client promovido de
`google/aiagents-oauth-client-*` → `social-login/`; PENDENTE do owner: adicionar o redirect URI
do linkedout no console Google) · facebook/x/linkedin/github/microsoft/entra-id desabilitados
aguardando credenciais. Demais realms: rodar o script sob demanda.
