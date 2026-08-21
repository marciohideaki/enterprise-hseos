#!/usr/bin/env bash
# provision-social-idps.sh — provisiona login social (identity brokering) num realm do Keycloak
# compartilhado (§3e). Idempotente: cria ou atualiza cada IdP. Credenciais SEMPRE do `pass`
# (grupo canônico `social-login/`, §3c) — provider sem credencial vira IdP DESABILITADO
# (esqueleto pronto; habilita sozinho na próxima execução após inserir as credenciais).
#
# Uso:   ./provision-social-idps.sh <realm> [provider...]
# Ex.:   ./provision-social-idps.sh linkedout            # todos: google facebook x linkedin github
#        ./provision-social-idps.sh linkedout google     # só google
#
# Pré-requisitos: pass (platform-shared-dev/keycloak-k3s-admin-{user,password}), curl, python3.
# Após habilitar um provider, registre no console dele o redirect URI impresso ao final.
set -euo pipefail

REALM="${1:?uso: provision-social-idps.sh <realm> [provider...]}"; shift || true
PROVIDERS=("${@:-google facebook x linkedin github microsoft entra-id}")
[ ${#PROVIDERS[@]} -eq 1 ] && [[ "${PROVIDERS[0]}" == *" "* ]] && read -ra PROVIDERS <<< "${PROVIDERS[0]}"

KC_BASE="${KC_BASE:-https://keycloak.hideakiservicos.net/kc}"
UA='Mozilla/5.0 hideaki-social-login-provisioner'   # WAF Cloudflare 403a UA não-navegador

kc_provider_id() { # alias -> providerId nativo do Keycloak
  case "$1" in
    google) echo google ;;
    facebook) echo facebook ;;
    x) echo twitter ;;          # provider nativo "twitter" cobre X.com
    linkedin) echo linkedin-openid-connect ;;
    github) echo github ;;
    microsoft) echo microsoft ;;    # conta Microsoft pessoal (social)
    entra-id) echo oidc ;;          # SSO organizacional (parceiros/terceiros) via OIDC genérico
    *) echo "" ;;
  esac
}

TOKEN=$(curl -sf "$KC_BASE/realms/master/protocol/openid-connect/token" -H "User-Agent: $UA" \
  -d grant_type=password -d client_id=admin-cli \
  -d "username=$(pass show platform-shared-dev/keycloak-k3s-admin-user)" \
  --data-urlencode "password=$(pass show platform-shared-dev/keycloak-k3s-admin-password)" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')

api() { local method="$1" path="$2" body="${3:-}"
  curl -s -o /tmp/kc-idp-resp.$$ -w '%{http_code}' -X "$method" "$KC_BASE/admin/realms/$path" \
    -H "Authorization: Bearer $TOKEN" -H "User-Agent: $UA" -H 'Content-Type: application/json' \
    ${body:+--data "$body"}
}

echo "== realm: $REALM =="
SUMMARY=()
for P in "${PROVIDERS[@]}"; do
  PID=$(kc_provider_id "$P"); [ -z "$PID" ] && { echo "provider desconhecido: $P (pulado)"; continue; }
  CID=$(pass show "social-login/${P}-client-id" 2>/dev/null || true)
  CSECRET=$(pass show "social-login/${P}-client-secret" 2>/dev/null || true)
  if [ -n "$CID" ] && [ -n "$CSECRET" ]; then ENABLED=true; else ENABLED=false; CID="PENDING-OWNER-CREDENTIALS"; CSECRET="PENDING"; fi

  TENANT=""
  [ "$P" = "entra-id" ] && TENANT=$(pass show "social-login/entra-id-tenant" 2>/dev/null || echo organizations)
  BODY=$(python3 - "$P" "$PID" "$ENABLED" "$CID" "$CSECRET" "$TENANT" <<'PY'
import json,sys
alias,pid,enabled,cid,csecret,tenant=sys.argv[1:7]
cfg={"clientId": cid, "clientSecret": csecret, "syncMode": "IMPORT", "useJwksUrl": "true"}
body={"alias": alias, "providerId": pid, "enabled": enabled=="true",
      "trustEmail": True, "storeToken": False,
      "firstBrokerLoginFlowAlias": "first broker login", "config": cfg}
if alias=="entra-id":
    base=f"https://login.microsoftonline.com/{tenant}"
    cfg.update({
        "authorizationUrl": f"{base}/oauth2/v2.0/authorize",
        "tokenUrl": f"{base}/oauth2/v2.0/token",
        "jwksUrl": f"{base}/discovery/v2.0/keys",
        "issuer": f"{base}/v2.0",
        "defaultScope": "openid profile email",
        "validateSignature": "true",
    })
    body["displayName"]="Entra ID (SSO corporativo)"
    # tenant "organizations" (multi-tenant): issuer varia por tenant — para produção,
    # fixe social-login/entra-id-tenant com o tenant do parceiro (single-tenant é o default seguro).
print(json.dumps(body))
PY
)
  CODE=$(api GET "$REALM/identity-provider/instances/$P")
  if [ "$CODE" = "200" ]; then
    CODE=$(api PUT "$REALM/identity-provider/instances/$P" "$BODY"); ACTION=atualizado
  else
    CODE=$(api POST "$REALM/identity-provider/instances" "$BODY"); ACTION=criado
  fi
  case "$CODE" in 20*|204) STATUS=ok ;; *) STATUS="ERRO($CODE)"; cat /tmp/kc-idp-resp.$$ >&2 ;; esac
  STATE=$([ "$ENABLED" = true ] && echo HABILITADO || echo desabilitado-sem-credencial)
  echo "  $P → $ACTION $STATUS [$STATE]"
  SUMMARY+=("$P|$STATE|$KC_BASE/realms/$REALM/broker/$P/endpoint")
done
rm -f /tmp/kc-idp-resp.$$

echo; echo "== redirect URIs para registrar no console de cada provider =="
for line in "${SUMMARY[@]}"; do IFS='|' read -r p st uri <<< "$line"; echo "  $p ($st): $uri"; done
echo; echo "Credenciais: pass insert social-login/<provider>-client-id e -client-secret; re-rode para habilitar."
