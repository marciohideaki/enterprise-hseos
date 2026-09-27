# Contrato de extensões W4

Tipo: contrato de design; FR01/02/07, ADR-0045 Proposed.

## Manifesto e admissão

Registry schema 3.0 admite entradas compilation (v2 existente) e execution.
Descritor execution v1 declara id, version SemVer exata, kind (tool, model-provider,
runtime-provider, context-source), compatibilidade por versões exatas de contrato
e majors Node suportados, entrypoint relativo, mapa files caminho→SHA256,
capabilities, limits, dependencies fixadas por id/version/digest e conformance.
Paths são relativos POSIX, sem traversal, links simbólicos, hardlinks ou duplicatas.
Entrada e testes precisam constar no mapa; bytes totais e número de arquivos são
limitados. Versões desconhecidas, conteúdo divergente, dependência ausente/cíclica,
colisão ou autoridade não concedida falham antes de lançar processo.

Inspecionar somente JSON/YAML e bytes de arquivos. Não require/import de plugin no
host. Dependências são resolvidas pelo catálogo de dados. O registro admitido fixa
manifest digest e content digest. Instalação usa staging e rename atômico em store
por digest; versões antigas permanecem disponíveis para jobs pinados. Antes de cada
launch validar bytes novamente e executar snapshot privado readonly para eliminar
a janela entre hash e execução. O código não recebe path do ledger ou segredo.

## Execução isolada

O adapter confiável reutiliza executeIsolatedCommand/createIsolationPolicy e drain
cgroup, com rede negada, ambiente allowlist e workspace readonly. O host monta o
snapshot do plugin, não o checkout principal. Entrada/saída usa envelope JSON v1
limitado: request_id, plugin identity/digest, method e payload. Resposta repete
identidade/request_id e inclui result validado pelo contrato de destino. Saída
malformada, extra, timeout, limite excedido ou drain não comprovado falham fechados.
Conformance usa o mesmo executor; verifyActivePluginConformance do compilador não
é superfície de admissão de código externo.

Ferramenta registra handler confiável no ToolRuntime antes de selar registro;
apenas o handler possui capacidade de invocar o executor admitido. Provider adapta
ModelProvider/RuntimeProvider, com controle de campanha antes do dispatch e sem
credenciais entregues ao plugin. Acesso externo, quando necessário, usa broker
existente com capacidade limitada; recusar provider cujo protocolo não possa
ser mediado. Fonte de contexto entrega itens validados ao ContextAssembler,
identificados por plugin/version/digest; nunca promove texto a autoridade.

Configuração fixa seleção por execução; plugin não pode descobrir/registrar outro
plugin em runtime. Cancelamento do pai aborta operação e drena descendants. Se não
for possível provar término, job/campanha conservam incerteza e reserva.

## Aceite

Consumidores externos reais de tool/provider/contexto são pacotes fora do checkout,
com recibos de instalação e jornada usando contratos públicos. Fixtures adversariais
não contam como consumidor real. Perfil não selecionado não importa módulo nem
inicializa processo. Atualização/rollback não altera seleção de execução já criada.
