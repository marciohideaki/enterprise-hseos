# W4-06b — distribuição offline de plugins de execução

Tipo: contrato de implementação; base `d85ee1ee`; FR01/02/07; extensão do
catálogo v3 e de [extensions.md](extensions.md).

## Intake de capacidade

O catálogo e o comando `plugin install` são superfícies existentes do controle
HSEOS. O grafo local registra `capability.hseos.project-engineering` e
`module.hseos.control`; a instalação estende o mesmo owner, sem pacote ou
contrato paralelo. O descritor de execução é validado por
`readExecutionPluginBundle`; o comando lê dados e bytes, sem importar módulo
externo no host. A projeção semântica e AEW não concedem autoridade de
instalação ou execução.

## Instalação e seleção

`hseos plugin install <id> --directory <projeto>` resolve entrada ativa do
registry v3, verifica o pin do manifesto e dependências transitivas, e então
grava cada bundle em `.hseos/plugins/store/<manifest_sha256>` via staging e
rename. Uma instalação existente é verificada antes de ser reutilizada;
conteúdo adulterado bloqueia a operação. Falha de catálogo ou bundle ocorre
antes de criar o store. O diretório aberto é ancorado por file descriptor,
com verificação de owner, permissões e identidade dev/ino; troca por symlink
durante a instalação não redireciona a escrita. `doctor` ignora versões
desabilitadas e exige digest, ID e versão para as ativas. `remove` não apaga o
store, pois jobs já criados podem referenciar a versão anterior.

O operador aponta sua configuração confiável para um diretório do store.
`pinExecutionPluginSelection` fixa digest e configuração por execução;
`restoreExecutionPluginSelection` detecta troca de versão. Upgrade instala
novo digest sem substituir o antigo; rollback do catálogo seleciona o digest
anterior. Instalação não executa conformance nem ativa jobs.

O teste usa diretório temporário fora do checkout, comando CLI real, dependência
transitiva, upgrade/rollback, adulteração, symlink, import e help sem efeito.
Um segundo ensaio instala o tarball W4 com `npm --offline` em outro diretório,
executa seu CLI e comprova upgrade/rollback e seleção preservada. Essas
fixtures não substituem os três consumidores reais exigidos em W4-07b.
