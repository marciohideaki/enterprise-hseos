# ADR-0049 — Fork do Code OSS e política de upstream para a IDE da W6

**Status:** Proposed
**Date:** 2026-10-30
**Authors:** Owner (decisão solicitada); redação por executor do dev-squad owner-decisions
**Affects Standards:** `docs/evolution/PLAN.md` (invariantes da IDE; W6; "Pendências antes de abrir a W6"); ADR-0043 (Accepted em 2026-10-30; Decision: IDE Code OSS, upstream fixado, instalador separado, toolchain da IDE separada); ADR-0006 (AGENTS.md canônico, sem dependência de `~/.claude`); ADR-0042 (kernel e capacidades opcionais); `docs/evolution/requirements.json` F25-R1
**Supersedes:** N/A
**Superseded By:** N/A

---

## Context

O plano de evolução (`docs/evolution/PLAN.md`) e o ADR-0043 (Accepted em 2026-10-30) já fixam as premissas da IDE:

- o kernel fica fora do Electron; a IDE Code OSS usa a API do kernel e uma extensão própria, com patches limitados no workbench;
- o upstream é fixado e o build é descartável e reproduzível, gerando um instalador independente;
- o catálogo inicial de extensões só inclui extensões licenciadas para redistribuição;
- o Electron não vira dependência do kernel; alterações externas são reconciliadas;
- Linux primeiro; macOS e Windows exigem execução nativa certificada (W7);
- a W6 entrega editor, terminal, Git, debug, planejamento, revisão, evidências e aprovações; fechar ou atualizar a UI preserva o trabalho; upstream e rollback são reproduzíveis (F25-R1).

O plano também exige, antes de qualquer código da W6, um ADR que fixe a abordagem de fork e o upstream (item 5 de "Pendências antes de abrir a W6"). Hoje não há fork, extensão nem código da IDE. `tools/cli/installers/lib/ide/*` é o instalador para outras IDEs e não conta como W6.

Restrição de superfície: o gate G3 (`test/test-package-surface.js`) está sem folga (tools 393/393, packages 137/137). Um fork do Code OSS tem ordem de grandeza de milhares de arquivos e não cabe no pacote npm. A decisão de onde fica o código é parte deste ADR.

Este ADR é Proposed: o owner o aceita depois de ler. Fatos externos incertos (versão atual do Code OSS, termos exatos do marketplace, política de licença de cada alternativa) não foram verificados aqui e estão listados em "Questões para o aceite".

---

## Decision

Recomendamos as decisões abaixo. Nada vale até o aceite do owner.

### 1. Base

Fork do repositório `microsoft/vscode` (Code OSS) em **tag de release fixada**, com **patches mínimos** no workbench e o grosso da funcionalidade HSEOS numa **extensão própria**. O produto resultante tem `product.json` próprio, marca própria e instalador independente.

Por que as outras não servem:

- **VSCodium como base:** é um build comunitário do mesmo código, com seu próprio ciclo de patches. Adotá-lo põe um segundo upstream entre o HSEOS e o Code OSS, o que enfraquece "upstream fixado" e "build reproduzível por nós": a cadência, a política de patches e a cadeia de build passam a depender de terceiros. Serve como referência de como remover telemetria e marca, não como base.
- **Eclipse Theia:** o ADR-0043 (Accepted em 2026-10-30) registra "Não adotar Theia nesta evolução"; adotá-lo reabriria essa decisão.
- **OpenVSCode Server:** o ADR-0043 não o menciona. Rejeitado aqui por motivo próprio: pelo que se conhece, é orientado a servidor/navegador, enquanto a W6 pede instalador local independente com terminal, debug e Git; essa caracterização é a confirmar no aceite. Não é tratado como contingência.
- **Só extensão sobre VS Code/Code OSS de terceiros:** não cumpre "instalador independente" nem "upstream fixado e rollback reproduzíveis", porque o host da extensão muda sem controle do HSEOS. Continua válido como canal complementar (a extensão própria deve instalar também num Code OSS de terceiros, sem garantias de W6).

### 2. Política de upstream

- **Pin** por tag de release **e** SHA do commit, gravados num arquivo versionado (`UPSTREAM.lock`) no repositório da IDE. O build recusa tag cujo SHA divirja.
- **Patches** mantidos como série versionada (`patches/NNNN-*.patch`), aplicável em CI sobre o pin, com falha se algum patch não aplicar. **Teto de patches no workbench:** a confirmar no aceite (proposta: definir um número pequeno e fixo, medido em arquivos tocados do workbench, e exigir ADR de emenda para ultrapassá-lo). Todo patch tem justificativa de por que não cabe na extensão.
- **Cadência de rebase:** a confirmar no aceite (proposta: janela periódica fixa, mais rebase fora de ciclo por correção de segurança). Cada rebase é uma mudança revisada, com o build reproduzível, os testes da jornada Linux e o relatório de patches rebaseados/descartados.
- **Critério de atualização de segurança:** vulnerabilidade com correção upstream que afete componentes usados pelo produto dispara rebase fora de ciclo; a decisão e o prazo ficam registrados. O prazo exato é questão para o aceite.
- Alterações externas (mudanças de upstream que conflitem com patches) são reconciliadas por rebase da série, nunca por edição direta e não rastreada no fork.

### 3. Build reproduzível e descartável

- Toolchain da IDE **separada** da toolchain do kernel (Node >=22 do kernel não se confunde com a versão de Node/Electron que o upstream exige), cada uma com ciclo próprio, conforme ADR-0043.
- Versões de Node, Electron (via upstream), compiladores nativos e gerenciador de pacotes fixadas em arquivo versionado; instalação por lockfile.
- Build em ambiente descartável (container ou diretório de scratch efêmero, removido ao fim), sem depender de estado da máquina do desenvolvedor.
- Cada artefato publica seu **hash** (SHA-256) e a lista de insumos (pin, série de patches, toolchain). Verificação: reconstruir a partir dos mesmos insumos e comparar o hash. Se o upstream não permitir bit-a-bit idêntico, a verificação cai para comparação de conteúdo normalizado e isso é registrado como limite conhecido (ver riscos). A viabilidade bit-a-bit é questão para o aceite.
- O build roda um por vez e contido, conforme a diretriz de throttling do ambiente.

### 4. Marketplace, licenças e marca

- Galeria de extensões: **Open VSX** (ou instância equivalente aberta), a confirmar no aceite (disponibilidade, termos e se haverá instância própria). O marketplace da Microsoft não é usado por premissa do plano de manter o produto independente; se seus termos de uso restringem esse uso, é a confirmar no aceite.
- Catálogo inicial só com extensões cuja licença permita redistribuição, com lista explícita (allowlist) versionada e licença registrada por extensão. Extensão fora da lista não vem pré-instalada.
- Remoção de telemetria e da marca da Microsoft por meio de `product.json` e patches mínimos, com verificação automática no build (nenhum endpoint de telemetria ou de atualização da Microsoft no artefato final).
- Os avisos de licença do código do Code OSS e de terceiros acompanham o instalador; qual é a licença do Code OSS e o conjunto de avisos exigidos é a confirmar no aceite.

### 5. Fronteira com o kernel

- A IDE fala com o kernel **somente** pela API versionada, local e autenticada, com a mesma autoridade de CLI/API/SDK. Nenhum caminho privilegiado para a UI.
- **Sem SQLite compartilhado:** a IDE nunca abre o banco de estado do kernel.
- O Electron e qualquer código do workbench **não entram** no kernel nem em suas dependências. O processo do kernel tem ciclo de vida independente da UI.
- A extensão consome contratos da API versionada; incompatibilidade de versão falha de forma explícita e visível.

### 6. Onde fica o código

**Repositório separado** para o fork, a série de patches, a extensão e o pipeline de build da IDE. Justificativa: o G3 não comporta o código no pacote (393/393 e 137/137), e a alternativa de manter uma pasta no repositório principal excluída do pacote npm via `files` deixa o fork acoplado ao ciclo de CI, ao lint e à cobertura do kernel, além de inflar clones e o disparo de testes. O repositório da IDE consome o kernel apenas pela API versionada (ou pelo SDK publicado), o que reforça a fronteira do item 5.

No repositório principal ficam somente este ADR, o plano, os contratos da API e o registro de requisitos. Nome, organização e visibilidade do repositório são questões para o aceite.

### 7. Rollback e preservação do trabalho

- Fechar, travar ou atualizar a UI **não perde trabalho**: o estado vive no kernel (ledger e API); a UI reconecta e retoma. Isso é verificado na jornada Linux de F25-R1.
- A atualização instala a nova versão ao lado da anterior e mantém a anterior até a nova ser confirmada. **Rollback** reinstala o par anterior (artefato + extensão) verificando o hash; rollback também é reproduzível.
- Atualização da IDE não migra estado do kernel; migrações do kernel seguem sua própria política.

### 8. Plataformas

Linux primeiro. macOS e Windows só entram com execução nativa certificada, na W7; não se alega suporte por build cruzado ou emulação. Formatos de pacote Linux (por exemplo, AppImage, deb, rpm) são questão para o aceite.

### 9. Riscos e mitigação

Ver "Consequences / Risks".

---

## Consequences

### Positive

- Controle total do pin, dos patches e do ciclo de segurança, sem segundo upstream.
- Fronteira nítida: kernel intocado pelo Electron; UI substituível.
- Pacote npm e G3 preservados; o ciclo da IDE não trava o do kernel.
- Rollback e atualização reproduzíveis, como exige F25-R1.

### Negative / Trade-offs

- Manter um fork de um projeto grande e de ritmo rápido exige rebase recorrente e capacidade de build dedicada.
- Um segundo repositório aumenta a coordenação de versões (kernel, API, extensão, IDE).
- Sem o marketplace da Microsoft, algumas extensões populares não estarão disponíveis.

### Risks

- **Deriva do upstream e conflitos de rebase:** teto de patches, série versionada aplicável em CI, rebase em cadência fixa.
- **Vulnerabilidade upstream sem correção rápida:** rebase fora de ciclo e critério de severidade documentado; possibilidade de desabilitar o componente afetado.
- **Build não reprodutível bit-a-bit:** comparação de conteúdo normalizado como fallback e registro do limite.
- **Licença ou termos de extensão/marketplace:** allowlist com licença registrada e revisão jurídica antes do primeiro lançamento.
- **Marca e telemetria remanescentes:** verificação automática no build contra endpoints e marcas proibidos.
- **Custo de manutenção maior que a capacidade:** definir dono, cadência e orçamento no aceite; se inviável, voltar à alternativa "só extensão" como entrega reduzida, o que exigiria emendar o plano.
- **Acoplamento acidental à API privada do kernel:** testes de contrato e proibição de acesso ao banco de estado.

---

## Mitigations

- Deriva do upstream: série de patches versionada, aplicada em CI, com teto no workbench e rebase em cadência fixa.
- Segurança: rebase fora de ciclo com critério e prazo registrados.
- Reprodutibilidade: toolchain fixada, ambiente descartável, hash do artefato; fallback de comparação normalizada com limite registrado.
- Licenças, marca e telemetria: lista fixa de extensões com licença registrada, verificação automática no build e revisão jurídica antes do primeiro lançamento.
- Acoplamento ao kernel: somente API versionada, testes de contrato, sem acesso ao banco de estado.
- Capacidade de manutenção: dono, cadência e orçamento definidos no aceite.

---

## References

- `docs/evolution/PLAN.md` (invariantes da IDE, W6, "Pendências antes de abrir a W6")
- ADR-0043 — Evolução do harness e IDE Code OSS (Accepted em 2026-10-30)
- ADR-0006 — HSEOS Standalone Architecture
- ADR-0042 — Kernel v4 e capacidades opcionais
- `docs/evolution/requirements.json`, família F25 (F25-R1)
- `test/test-package-surface.js` (gate G3)
- `.enterprise/policies/adr-policy.md`

---

## Affected Standards

| Standard                           | Section / Rule                                                                          | Change                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `docs/evolution/PLAN.md`           | Invariantes da IDE; W6; "Pendências antes de abrir a W6", item 5                        | Clarifies: o item passa a citar este ADR (Proposed)                           |
| ADR-0043                           | Decision: IDE Code OSS, upstream fixado, instalador separado, toolchain da IDE separada | Extends: detalha a abordagem de fork, o upstream e o local do código          |
| ADR-0006                           | AGENTS.md canônico, sem dependência de `~/.claude`                                      | Clarifies: a IDE não cria dependência de configuração de usuário de terceiros |
| ADR-0042                           | Kernel e capacidades opcionais                                                          | Clarifies: kernel sem dependência de Electron                                 |
| `docs/evolution/requirements.json` | F25-R1                                                                                  | Clarifies: critérios de verificação (build, atualização, rollback)            |

---

## Compliance

- [ ] Approved by Engineering Leadership (owner)
- [ ] Affected standards updated to reference this ADR
- [ ] Teams notified
- [ ] Activation date: a definir no aceite
- [ ] Review date: a cada rebase maior do upstream ou ao abrir a W7

---

## Alternatives Considered

| Alternative                                                            | Why Rejected                                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| VSCodium como base                                                     | Segundo upstream intermediário; cadência e patches fora do controle do HSEOS. Útil só como referência   |
| Eclipse Theia                                                          | Já substituído por Code OSS no ADR-0043; reabriria a decisão do plano                                   |
| OpenVSCode Server                                                      | Orientado a servidor/navegador; não entrega o instalador local independente da W6                       |
| Só extensão sobre VS Code/Code OSS de terceiros                        | Não cumpre instalador independente nem upstream/rollback reproduzíveis. Mantida como canal complementar |
| Código da IDE em pasta do repositório principal excluída do pacote npm | Acopla o fork ao CI, lint e cobertura do kernel; infla clones e testes; enfraquece a fronteira pela API |
| Marketplace da Microsoft                                               | Termos de uso restringem produtos não oficiais (a confirmar no aceite)                                  |
| Embutir o kernel no Electron                                           | Rejeitado no ADR-0043: acopla trabalho ao ciclo de vida da UI                                           |

---

## Questões para o aceite

1. Versão/tag do Code OSS a fixar e data da primeira fixação: a confirmar no aceite.
2. Teto de patches no workbench (número e métrica): a confirmar.
3. Cadência de rebase e prazo máximo para correção de segurança: a confirmar.
4. Termos atuais do marketplace da Microsoft e dos termos do Open VSX (inclusive se há instância própria a operar): a confirmar.
5. Reprodutibilidade bit-a-bit é alcançável com o upstream escolhido, ou aceitamos comparação normalizada?
6. Repositório separado: nome, organização, visibilidade, dono e orçamento de manutenção.
7. Allowlist inicial de extensões e revisão jurídica de licenças, marca e ativos.
8. Formatos de pacote Linux e canal de atualização.
9. Mecanismo de ambiente descartável para o build (container ou outro) e capacidade de CI necessária.
10. O owner aceita "só extensão" como entrega reduzida de contingência, ou isso exige emenda do plano?
11. A contingência "só extensão" exige emenda do `docs/evolution/PLAN.md`?
12. O repositório separado muda onde fica a evidência da F25-R1 (jornada Linux, build, atualização, rollback)?
13. Confirmar a licença do Code OSS e os avisos exigidos no instalador.
14. Confirmar a caracterização do OpenVSCode Server (orientação servidor/navegador).
