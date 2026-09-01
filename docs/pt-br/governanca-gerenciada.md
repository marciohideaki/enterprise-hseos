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
hseos status
```

O health deve retornar migrations e projeção `current`, `ready: true`, modo
`managed-shadow` e quantidade de artefatos maior que zero. O MCP consulta somente
o endpoint gravado no projeto e não recebe credenciais do PostgreSQL.

Backup, restore, retenção, rotação de segredos, telemetria de produção e eventual
proxy TLS permanecem responsabilidades da plataforma que fornece o PostgreSQL.
