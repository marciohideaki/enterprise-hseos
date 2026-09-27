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

## Protocolo do executor candidato (W4-02b)

Entrada CJS/ESM exporta função default assíncrona ({method,input}) → JSON. O runner
confiável roda dentro do sandbox e sela schema_version/request_id/plugin_id/digest
na resposta; o host valida bytes, shape e identidade. Snapshot inclui somente
bytes verificados, em plugins/<id>/, com dependências pinadas disponíveis por path
relativo. Conflitos de versão transitivos falham antes do launch. Rede é negada.

Diagnósticos fornecidos pelo plugin também exportam função default e retornam
{passed:true}; seu resultado é explicitamente plugin-self-test, certified:false.
Eles não substituem a conformance dos ports verificada pelo host em W4-02c nem
a certificação do consumidor real. Código de teste externo nunca roda no host.
O executor atual aplica 256 MiB/32 processos, limites menores ou iguais aos tetos
admitidos. O recibo informa os limites efetivos, sem anunciar alocação maior.

## Ports de ferramenta e contexto (W4-02c1)

O host fornece contrato e definição; o plugin não define autoridade ou schemas
executáveis. A capacidade e o nome devem estar admitidos. Nesta fronteira readonly,
mutação, falha permissiva ou cancelamento não cooperativo são recusados. O bundle
é registrado antes de selar ToolRuntime, preservando política, ledger e idempotência.
Fontes de contexto também são operações governadas; retornam items id/content,
validados no host e transformados em ContextSourceSchema, classificação internal e
source_ref plugin://id/version/digest/item. O assembler recebe runtime_context;
nenhum item externo entra nas camadas de instrução.
O owner drena o conjunto de operações em andamento antes de confirmar término;
incerteza de teardown permanece latched mesmo após acabar a Promise.

## Binding local de provider (W4-02c2a)

Manifesto ProviderControl v1 preservado. v2 identifica vendor execution-plugin,
route local, tipo model/runtime e execution_plugin id/version/manifest_sha256.
Não representa nova família remota nem declara fonte oficial de fornecedor.
Identidade local é o hash da seleção admitida; credencial null, custo monetário zero,
quota externa not_applicable. Rede permanece negada. Uma futura mediação remota
precisa do broker/binding elegível próprio e da reserva correspondente.

A ponte exige instância de ProviderCampaignControl e adapter registrado por identidade.
Antes do efeito, grava intenção por command_id, sequência original de despacho e hash do payload, pede reserva à
campanha e exige seu recibo persistido antes de lançar plugin. Depois valida saída,
registra resultado e hash antes do recibo de campanha. Mesma chamada e hash podem
ler resultado confirmado após reinício; payload divergente é rejeitado. Reserva
sem recibo confirmado permanece incerta, sem executar novamente. Nenhum saldo novo.
Contagem local conservadora reutiliza ConservativeUtf8TokenCounter e os limites do
binding; não declara tokens faturados por um modelo remoto. Cancelamento confirmado
só produz recibo cancelled após drain; falha/saída inválida conservam incerteza.
