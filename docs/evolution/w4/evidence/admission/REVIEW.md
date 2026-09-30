# Revisão adversarial da admissão

Tipo: revisão W4-02a. FR01/FR07, Constituição §§2.6/7; ADR-0045 Proposed.

- Import com efeito: entrypoint e conformance adversariais permanecem inertes ao inspecionar/admitir/resolver. Teste verifica ausência de marcador externo.
- Drift após admissão: bytes e descritor são relidos; objeto forjado não recebe capacidade nominal.
- Autoridade: grant fixa identidade/kind/digest e limita capacidades/recursos. Dotted IDs do kernel agora reutilizam IdentifierSchema; teste rejeita grant insuficiente.
- Grafo com dependência compartilhada: deepFreeze reutilizado do core e visitas deduplicadas. Teste conta leituras do arquivo, evitando crescimento por número de caminhos.
- Catálogo: v2 e compilação v3 mantidos; execução não é emitida como plugin de compilação nem executada pela conformance no host.
- Limite: ainda não existe instalação/execução externa nesta task. Não alegar FR02 ou campanha real satisfeitos.

Gate integral Node24 anterior à revisão passou (full-gate-before-review.log.gz).
Os ajustes de revisão possuem testes Node22/24 e cobertura próprios. O gate do hook
pre-commit deve passar sobre o snapshot final; não reutilizar o gate anterior como
prova do snapshot alterado. Primeira tentativa do gate encontrou manifesto CLI
obsoleto, corrigido por npm run compile:cli.
