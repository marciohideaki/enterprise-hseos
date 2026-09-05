# Governança Gerenciada — Instalação Completa

Este guia instala o control plane opcional em modo `managed-shadow`. Os arquivos
do repositório continuam sendo a autoridade publicada; `managed-enforced`
permanece indisponível.

O pacote é agnóstico à infraestrutura: ele consome um PostgreSQL fornecido pelo
operador e não inicia contêiner, escolhe host, database ou organização, nem busca
credenciais na máquina.

## 1. Instale o pacote e o componente opcional

Instale o GitHub Release verificado conforme o `README.md` principal. No projeto:

```bash
hseos install-plan --components runtime:managed-governance-client --json
hseos install --directory . --components runtime:managed-governance-client
hseos status
```

## 2. Prepare o PostgreSQL

Como administrador do serviço PostgreSQL escolhido, substitua todos os exemplos:

```sql
CREATE ROLE example_hseos_migrator LOGIN CREATEROLE;
CREATE ROLE example_hseos_runtime LOGIN;
CREATE DATABASE example_hseos_governance OWNER example_hseos_migrator;
\password example_hseos_migrator
\password example_hseos_runtime
```

Os comandos `\password` solicitam os valores interativamente e não persistem
credenciais no histórico do shell nem nesta configuração. Em ambientes
automatizados, use o gerenciador de segredos do serviço PostgreSQL.

A role de migração precisa de `CREATEROLE` para criar as roles NOLOGIN delimitadas
do HSEOS. O setup concede à role de runtime somente
`hseos_governance_application`. Em plataformas gerenciadas, provisione database e
roles pelo mecanismo institucional equivalente.

## 3. Configure sem persistir segredos

```bash
install -m 600 \
  "$(npm root --global)/hseos/tools/managed-governance-control-plane/config.example.json" \
  .hseos/config/managed-governance-sidecar.json
```

Edite apenas referências e identificadores do seu ambiente. O arquivo aponta
para variáveis de ambiente e nunca contém senhas, tokens ou connection strings.

```bash
export HSEOS_GOVERNANCE_MIGRATION_DATABASE_URL='postgresql://example_hseos_migrator:...@db-host:5432/example_hseos_governance'
export HSEOS_GOVERNANCE_RUNTIME_DATABASE_URL='postgresql://example_hseos_runtime:...@db-host:5432/example_hseos_governance'
export HSEOS_GOVERNANCE_TOKEN='substitua-por-um-token-aleatorio-com-pelo-menos-16-caracteres'
```

Use os nomes declarados no seu JSON. Os nomes acima pertencem apenas ao template.

## 4. Fixe a fonte canônica no Git

Revise e versione os arquivos criados por `hseos install` pelo fluxo governado do
repositório. O importador exige `repository-contract.yaml` verificado, commit Git
fixo e raízes canônicas limpas.

## 5. Aplique migrations, seed e binding

```bash
hseos governance setup install \
  --database-config .hseos/config/managed-governance-sidecar.json \
  --actor managed-governance-setup \
  --json
```

O comando valida a configuração, aplica migrations, concede a role delimitada ao
runtime, importa a governança de forma determinística e grava atomicamente:

- `.hseos/config/managed-governance-binding.json`;
- `.hseos/config/managed-governance.json`.

Repita o comando. A segunda execução deve informar zero migrations e catálogo
inalterado. Nenhum arquivo gerado pode conter os segredos exportados.

## 6. Inicie o control plane e a UI

```bash
hseos governance server start \
  --database-config .hseos/config/managed-governance-sidecar.json \
  --json
```

Acesse a URL loopback configurada, por exemplo `http://127.0.0.1:4319/`. A mesma
origem publica UI, `/health` e `/api/v1/*`. Binding não-loopback e
`managed-enforced` continuam bloqueados.

## 7. Valide

```bash
curl --fail --silent http://127.0.0.1:4319/health
curl --fail --silent 'http://127.0.0.1:4319/api/v1/artifacts?limit=50'
hseos governance catalog status --endpoint http://127.0.0.1:4319 --json
hseos governance session preflight --json
hseos status
```

O health deve retornar migrations e projeção `current`, `ready: true`, modo
`managed-shadow` e quantidade de artefatos maior que zero. O MCP consulta somente
o endpoint gravado no projeto e não recebe credenciais do PostgreSQL.

O preflight de sessão normaliza a Constituição local com as mesmas regras do
importador e compara identidade do repositório e digest com a projeção ativa do
catálogo. Os estados possíveis são `equivalent`, `drift_detected`,
`remote_unavailable`, `invalid_local_contract` e `not_configured`. Todos são
consultivos em `managed-shadow`: os arquivos locais continuam autoritativos. A
CLI registra somente a evidência mais recente, sem segredos, em
`.hseos/state/managed-governance/session-preflight.json`.

No Claude Code, o adapter compilado executa o preflight por um hook
`SessionStart` não bloqueante. No Codex e em adapters sem evento nativo de início
de sessão, execute o comando uma vez antes da primeira ação. A ferramenta MCP
read-only `get_governance_session_preflight` aplica a mesma comparação sem
persistir evidência. O hook não inicia PostgreSQL nem o sidecar; indisponibilidade
remota gera alerta e nunca bloqueia a sessão.

Backup, restore, retenção, rotação de segredos, telemetria de produção e eventual
proxy TLS permanecem responsabilidades da plataforma que fornece o PostgreSQL.

## 8. Implantação em rede compartilhada (LAN)

O loopback continua sendo o padrão em toda instalação, mesmo já configurada com
PostgreSQL. Acesso em rede compartilhada é um opt-in explícito adicional no
mesmo `.hseos/config/managed-governance-sidecar.json`; nunca muda a autoridade
de governança nem ativa `managed-enforced`, que permanece indisponível
independentemente do perfil de rede.

Adicione uma seção `network`. Todo valor abaixo é estado de implantação, nunca
um padrão do pacote — o CIDR mostrado é ilustrativo; o valor aprovado para uma
implantação específica só é decidido e aplicado depois que o checklist de
ativação abaixo passar:

```json
{
  "network": {
    "profile": "shared-network",
    "listen_host": "192.168.5.70",
    "port": 4319,
    "allowed_clients": ["192.168.5.0/24"],
    "trusted_proxies": [],
    "transport": {
      "mode": "direct-tls",
      "certificate_ref_env": "HSEOS_GOVERNANCE_TLS_CERTIFICATE",
      "private_key_ref_env": "HSEOS_GOVERNANCE_TLS_PRIVATE_KEY"
    },
    "authentication": {
      "query_token_env": "HSEOS_GOVERNANCE_QUERY_TOKEN",
      "admin_token_env": "HSEOS_GOVERNANCE_ADMIN_TOKEN"
    },
    "rate_limits": { "query_requests_per_minute": 120, "admin_requests_per_minute": 30 }
  }
}
```

`control_plane.host`/`port` devem ser idênticos a `network.listen_host`/`port`.
`allowed_clients` exige CIDRs específicos e não-vazios — uma lista vazia ou uma
rede allow-all (`0.0.0.0/0`, `::/0`) é rejeitada. `trusted_proxies` fica vazio a
menos que um proxy reverso específico seja deliberadamente confiável para
`X-Forwarded-For`; qualquer outro cabeçalho de encaminhamento é ignorado, e uma
cadeia multi-hop ambígua é rejeitada em vez de adivinhada.

`transport.mode` é `direct-tls` (o próprio sidecar termina TLS com o
certificado/chave privada referenciados, nunca um caminho de arquivo ou valor
literal na configuração) ou `terminated-upstream` (um proxy reverso externo já
confiável termina TLS; o sidecar continua em HTTP puro nesse modo, de
propósito). `authentication` exige dois tokens distintos e delimitados — um
para consulta, outro para administração — sem sobreposição de escopo em
nenhuma direção.

### Checklist de ativação

Aplique o perfil de rede compartilhada só depois que cada item abaixo passar
para a implantação alvo, nesta ordem:

1. **Threat model** (`threat-model.md`) sem nenhum achado Critical/High aberto.
2. **Rehearsal de instalação empacotada**: `npm run test:package-surface && node --test test/managed-governance/installation.test.js` passando contra a versão exata do pacote a ser implantada.
3. **Prova de admissão LAN**: o CIDR real de `allowed_clients` da implantação admite um cliente dentro dele e nega um fora — confirme que o CIDR declarado corresponde exatamente à sub-rede real dos clientes.
4. **Atualize e reinicie**: só então edite o `managed-governance-sidecar.json` real da implantação com a seção `network` acima, exporte as variáveis novas, e reinicie `hseos governance server start`.
5. **Observação começa**: a janela de observação de 30 dias começa a contar a partir do primeiro preflight/receipt real contra a implantação em rede compartilhada — nunca a partir da edição do arquivo de configuração. Um relatório sem 30 dias consecutivos de evidência reporta honestamente `evaluated: false`, nunca um valor inventado.

Desabilitar a seção `network` (ou não incluí-la) restaura o binding somente-loopback
na próxima reinicialização, sem reverter migrations nem apagar evidência já
registrada.
