# PostgreSQL e matriz Node 20/22

Autorização do usuário: configurar o banco de testes PostgreSQL e executar a
matriz Node 20/22, antes de versionamento/publicação.

## Ambiente de teste

- Instância existente: `postgres-shared`, namespace `platform-shared-dev`.
- PostgreSQL 16.14; o serviço efêmero do workflow hospedado usa PostgreSQL 18.
  A validação local não substitui a evidência dessa combinação hospedada.
- Bancos exclusivos: `hseos_v4_ci_node20_20260925` e
  `hseos_v4_ci_node22_20260925`, com CONNECT público revogado.
- Bootstrap por Job `hseos-v4-ci-db-20260925`, sem criar outro servidor PostgreSQL.
- Referência no pass: `enterprise-hseos/ci-postgres-reference`; credencial existente
  `platform-shared-dev/postgres-platform`, resolvida somente no processo de teste.
  Nenhum segredo é incluído nos recibos ou no repositório.
- As migrações criaram os três papéis NOLOGIN `hseos_governance_migrator`,
  `hseos_governance_application` e `hseos_governance_auditor`, previamente ausentes.
  Os objetos da aplicação estão nos bancos de teste; o esquema operacional SQLite
  e os bancos de outros projetos não foram migrados.
- A conexão local usa port-forward temporário. Não é um endpoint permanente.

Os testes seguem o modelo administrativo de migração do CI. Isso não valida uma
credencial de aplicação produtiva. Os bancos são mantidos para repetição; a
referência no pass documenta sua finalidade e localização.

## Matriz

Binários oficiais Node 20.20.2 e 22.23.3, com SHA-256 conferido contra
SHASUMS256.txt. Cada versão usa uma cópia de validação e npm ci próprios, para
não misturar módulos nativos com o checkout Node 24.

O workflow existente mantém Node 20/22 e passa a usar max-parallel: 1 e
fail-fast: false: execução sequencial, com resultado de ambas as versões.
Não houve commit, push, disparo do GitHub Actions ou publicação.

Integração PostgreSQL: 15 testes passaram em cada versão, sem skips.
Após autorização explícita para execução sequencial acima do limiar de carga,
a suíte completa npm test passou em ambas as versões, com prioridade nice 10.
Cada versão reportou 799 testes Node aprovados, zero falhas e zero skips, além
dos checks auxiliares; schemas e lint também passaram.

A primeira tentativa Node 20 falhou no dry-run de proteção de branches porque
o clone de validação tinha um origin local. Corrigida a identidade do remoto
somente nas cópias de teste, a suíte completa foi repetida e passou.

Recibo: `evidence/2026-09-25-postgres-node-matrix/receipt.json`.
A matriz local está validada; não se declara execução do GitHub Actions nem
validação de PostgreSQL 18 a partir desses resultados.
