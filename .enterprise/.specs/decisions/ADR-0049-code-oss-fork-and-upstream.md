# ADR-0049 — Fork do Code OSS e política de upstream para a IDE da W6

**Status:** Accepted — 2026-10-31
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

O owner aceitou este ADR em 2026-10-31, com as respostas às 14 questões e os fatos verificados na fonte, registrados em "Respostas do aceite" e em "Fatos verificados na fonte". **Aceitar o ADR não cria o repositório `hseos-code` nem inicia o fork**; isso depende das condições de execução abaixo e de decisão de abertura da W6.

---

## Decision

Decisões aceitas pelo owner em 2026-10-31.

### 1. Base

Fork do repositório `microsoft/vscode` (Code OSS) na **última tag estável no momento da criação do fork** (a tag exata é verificada no upstream nesse momento, com a data registrada), com **patches mínimos** no workbench e o grosso da funcionalidade HSEOS numa **extensão própria**. O produto resultante tem `product.json` próprio, marca própria e instalador independente.

Por que as outras não servem:

- **VSCodium como base:** é um build comunitário do mesmo código, com seu próprio ciclo de patches. Adotá-lo põe um segundo upstream entre o HSEOS e o Code OSS, o que enfraquece "upstream fixado" e "build reproduzível por nós": a cadência, a política de patches e a cadeia de build passam a depender de terceiros. Serve como referência de como remover telemetria e marca, não como base.
- **Eclipse Theia:** o ADR-0043 (Accepted em 2026-10-30) registra "Não adotar Theia nesta evolução"; adotá-lo reabriria essa decisão.
- **OpenVSCode Server:** o ADR-0043 não o menciona. Rejeitado aqui por motivo próprio: verificado em 2026-10-31 (https://github.com/gitpod-io/openvscode-server), "runs a server on a remote machine and allows access through a modern web browser", sob licença MIT; o último release é `openvscode-server-v1.109.5` (2026-02-20), com último push em 2026-09-24 e sem arquivamento. É um projeto vivo, mas orientado a servidor remoto com acesso por navegador, enquanto a W6 pede instalador local independente com terminal, debug e Git. Não é tratado como contingência.
- **Só extensão sobre VS Code/Code OSS de terceiros:** não cumpre "instalador independente" nem "upstream fixado e rollback reproduzíveis", porque o host da extensão muda sem controle do HSEOS. Continua válido como canal complementar (a extensão própria deve instalar também num Code OSS de terceiros, sem garantias de W6).

### 2. Política de upstream

- **Pin** por tag de release **e** SHA do commit, gravados num arquivo versionado (`UPSTREAM.lock`) no repositório da IDE. O build recusa tag cujo SHA divirja.
- **Patches** mantidos como série versionada (`patches/NNNN-*.patch`), aplicável em CI sobre o pin, com falha se algum patch não aplicar. **Teto de patches (Q2):** no máximo **10 arquivos de patch** e **1.500 linhas alteradas** fora de `extensions/`, medidos pelo diff contra a tag fixada; passar disso exige ADR novo. Todo patch tem justificativa de por que não cabe na extensão.
- **Cadência de rebase (Q1/Q3):** **mensal**, mais rebase fora de ciclo por correção de segurança. Cada rebase é uma mudança revisada, com o build reproduzível, os testes da jornada Linux e o relatório de patches rebaseados/descartados.
- **Critério de atualização de segurança:** vulnerabilidade com correção upstream que afete componentes usados pelo produto dispara rebase fora de ciclo; correções de segurança do upstream entram em até **7 dias** (Q3); a decisão fica registrada.
- Alterações externas (mudanças de upstream que conflitem com patches) são reconciliadas por rebase da série, nunca por edição direta e não rastreada no fork.

### 3. Build reproduzível e descartável

- Toolchain da IDE **separada** da toolchain do kernel (Node >=22 do kernel não se confunde com a versão de Node/Electron que o upstream exige), cada uma com ciclo próprio, conforme ADR-0043.
- Versões de Node, Electron (via upstream), compiladores nativos e gerenciador de pacotes fixadas em arquivo versionado; instalação por lockfile.
- Build em **container descartável fixado por digest** (Q9), no GitHub Actions ou localmente via `heavy-run`, removido ao fim, sem depender de estado da máquina do desenvolvedor.
- Cada artefato publica seu **hash** (SHA-256) e a lista de insumos (pin, série de patches, toolchain). Verificação: reconstruir a partir dos mesmos insumos e comparar o hash. A comparação é **normalizada** (timestamps, ordem e assinaturas normalizados, mais SBOM e hashes por arquivo) (Q5); o bit a bit fica como meta e não bloqueia. O limite é registrado (ver riscos).
- O build roda um por vez e contido, conforme a diretriz de throttling do ambiente.

### 4. Marketplace, licenças e marca

- Galeria de extensões (Q4/Q7): **Open VSX público** (open-vsx.org), sem instância própria por enquanto. Verificado em 2026-10-31 (https://github.com/eclipse-openvsx/openvsx): "a vendor-neutral open-source alternative to the Visual Studio Marketplace", projeto Eclipse com instância pública em open-vsx.org. **Não verificado:** os termos de uso de publicação e consumo do open-vsx.org; ler antes do primeiro uso (condição de execução).
- O marketplace da Microsoft **não é usado**. Verificado em 2026-10-31 (https://aka.ms/vsmarketplace-ToU, "Last Updated September 2025"): "Marketplace Offerings are intended for use only with In-Scope Products and Services and you may not install, reverse-engineer, import or use Marketplace Offerings in products and services except for the In-Scope Products and Services"; os In-Scope são VS, VS Code, GitHub Codespaces, Azure DevOps e Azure DevOps Server. Um produto derivado do Code OSS não está entre eles.
- Catálogo inicial só com extensões de **licença OSI revisada**, com lista explícita (allowlist) versionada e licença registrada por extensão. Extensão fora da lista não vem pré-instalada.
- Remoção de telemetria e da marca da Microsoft por meio de `product.json` e patches mínimos, com verificação automática no build (nenhum endpoint de telemetria ou de atualização da Microsoft no artefato final).
- Os avisos de licença do código do Code OSS e de terceiros acompanham o instalador; verificado em 2026-10-31: o Code OSS é **MIT License**, "Copyright (c) 2015 - present Microsoft Corporation" (https://github.com/microsoft/vscode/blob/main/LICENSE.txt); o `ThirdPartyNotices.txt` lista componentes de terceiros com as respectivas licenças, e a redistribuição precisa manter os avisos de copyright e de permissão de cada um (https://github.com/microsoft/vscode/blob/main/ThirdPartyNotices.txt). O produto Visual Studio Code usa "a traditional Microsoft product license"; logos e nomes são marcas e ficam fora do repositório (https://github.com/microsoft/vscode/wiki/Differences-between-the-repository-and-Visual-Studio-Code), logo o produto HSEOS não usa nome nem logos da Microsoft.

### 5. Fronteira com o kernel

- A IDE fala com o kernel **somente** pela API versionada, local e autenticada, com a mesma autoridade de CLI/API/SDK. Nenhum caminho privilegiado para a UI.
- **Sem SQLite compartilhado:** a IDE nunca abre o banco de estado do kernel.
- O Electron e qualquer código do workbench **não entram** no kernel nem em suas dependências. O processo do kernel tem ciclo de vida independente da UI.
- A extensão consome contratos da API versionada; incompatibilidade de versão falha de forma explícita e visível.

### 6. Onde fica o código

**Repositório separado** (`marciohideaki/hseos-code`, privado, com o owner como dono; Q6) para o fork, a série de patches, a extensão e o pipeline de build da IDE. Justificativa: o G3 não comporta o código no pacote (393/393 e 137/137), e a alternativa de manter uma pasta no repositório principal excluída do pacote npm via `files` deixa o fork acoplado ao ciclo de CI, ao lint e à cobertura do kernel, além de inflar clones e o disparo de testes. O repositório da IDE consome o kernel apenas pela API versionada (ou pelo SDK publicado), o que reforça a fronteira do item 5.

No repositório principal ficam somente este ADR, o plano, os contratos da API e o registro de requisitos. A evidência da F25-R1 (jornada Linux, build, atualização, rollback) é gerada no `hseos-code` e **espelhada aqui por recibo com hash** em `docs/evolution/` (Q12); o enterprise-hseos continua sendo a fonte da verificação.

### 7. Rollback e preservação do trabalho

- Fechar, travar ou atualizar a UI **não perde trabalho**: o estado vive no kernel (ledger e API); a UI reconecta e retoma. Isso é verificado na jornada Linux de F25-R1.
- A atualização instala a nova versão ao lado da anterior e mantém a anterior até a nova ser confirmada. **Rollback** reinstala o par anterior (artefato + extensão) verificando o hash; rollback também é reproduzível.
- Atualização da IDE não migra estado do kernel; migrações do kernel seguem sua própria política.

### 8. Plataformas

Linux primeiro. macOS e Windows só entram com execução nativa certificada, na W7; não se alega suporte por build cruzado ou emulação. Formatos de pacote Linux (Q8): **tar.gz e .deb**; atualização por canal de releases do GitHub, com checagem de assinatura.

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
- **Custo de manutenção maior que a capacidade:** dono é o owner, cadência mensal; se inviável, voltar à alternativa "só extensão" como entrega reduzida, **aceita com emenda** do `docs/evolution/PLAN.md`, feita só se e quando for acionada (Q10/Q11).
- **Acoplamento acidental à API privada do kernel:** testes de contrato e proibição de acesso ao banco de estado.

---

## Mitigations

- Deriva do upstream: série de patches versionada, aplicada em CI, com teto no workbench e rebase em cadência fixa.
- Segurança: rebase fora de ciclo com critério e prazo registrados.
- Reprodutibilidade: toolchain fixada, ambiente descartável, hash do artefato; fallback de comparação normalizada com limite registrado.
- Licenças, marca e telemetria: lista fixa de extensões com licença registrada, verificação automática no build e revisão jurídica antes do primeiro lançamento.
- Acoplamento ao kernel: somente API versionada, testes de contrato, sem acesso ao banco de estado.
- Capacidade de manutenção: dono e cadência definidos no aceite; contingência "só extensão" aceita com emenda do plano.

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
| `docs/evolution/PLAN.md`           | Invariantes da IDE; W6; "Pendências antes de abrir a W6", item 5                        | Clarifies: o item passa a citar este ADR (Accepted)                           |
| ADR-0043                           | Decision: IDE Code OSS, upstream fixado, instalador separado, toolchain da IDE separada | Extends: detalha a abordagem de fork, o upstream e o local do código          |
| ADR-0006                           | AGENTS.md canônico, sem dependência de `~/.claude`                                      | Clarifies: a IDE não cria dependência de configuração de usuário de terceiros |
| ADR-0042                           | Kernel e capacidades opcionais                                                          | Clarifies: kernel sem dependência de Electron                                 |
| `docs/evolution/requirements.json` | F25-R1                                                                                  | Clarifies: critérios de verificação (build, atualização, rollback)            |

---

## Compliance

- [x] Approved by Engineering Leadership (owner), 2026-10-31, com as 14 respostas abaixo
- [ ] Affected standards updated to reference this ADR
- [ ] Teams notified
- [ ] Activation date: a definir; o aceite não cria o `hseos-code` nem inicia o fork
- [ ] Review date: a cada rebase maior do upstream ou ao abrir a W7

---

## Alternatives Considered

| Alternative                                                            | Why Rejected                                                                                                           |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| VSCodium como base                                                     | Segundo upstream intermediário; cadência e patches fora do controle do HSEOS. Útil só como referência                  |
| Eclipse Theia                                                          | Já substituído por Code OSS no ADR-0043; reabriria a decisão do plano                                                  |
| OpenVSCode Server                                                      | Servidor remoto com acesso por navegador (verificado em 2026-10-31); não entrega o instalador local independente da W6 |
| Só extensão sobre VS Code/Code OSS de terceiros                        | Não cumpre instalador independente nem upstream/rollback reproduzíveis. Mantida como canal complementar                |
| Código da IDE em pasta do repositório principal excluída do pacote npm | Acopla o fork ao CI, lint e cobertura do kernel; infla clones e testes; enfraquece a fronteira pela API                |
| Marketplace da Microsoft                                               | Termos (setembro de 2025) limitam o uso aos produtos In-Scope; verificado em 2026-10-31                                |
| Embutir o kernel no Electron                                           | Rejeitado no ADR-0043: acopla trabalho ao ciclo de vida da UI                                                          |

---

## Respostas do aceite (owner, 2026-10-31)

1. **Q1/Q3 (tag, cadência, segurança):** fixar a **última tag estável** do Code OSS no momento da criação do fork, com a data registrada. Rebase **mensal**. Correções de segurança do upstream entram em até **7 dias**. A tag exata é verificada no upstream quando o fork for criado, não neste aceite.
2. **Q2 (teto de patches):** no máximo **10 arquivos de patch** e **1.500 linhas alteradas** fora de `extensions/`, medidos pelo diff contra a tag fixada. Passar disso exige ADR novo.
3. **Q4/Q7 (marketplace e allowlist):** extensões do **Open VSX público**, sem o marketplace da Microsoft. Allowlist inicial só com extensões de licença OSI revisada. Sem instância própria por enquanto.
4. **Q5 (reprodutibilidade):** comparação de build **normalizada** (timestamps, ordem e assinaturas normalizados, mais SBOM e hashes por arquivo). Bit a bit fica como meta, sem bloquear.
5. **Q6/Q12 (repositório e evidência):** repositório separado **`marciohideaki/hseos-code`, privado**, com o owner como dono. A evidência da F25-R1 é gerada lá e **espelhada no enterprise-hseos por recibo com hash** em `docs/evolution/`. O enterprise-hseos continua sendo a fonte da verificação.
6. **Q8/Q9 (pacotes e build):** pacotes **tar.gz + .deb**. Atualização por canal de releases do GitHub, com checagem de assinatura. Build em **container descartável fixado por digest**, no GitHub Actions ou localmente via `heavy-run`.
7. **Q10/Q11 (contingência):** a contingência "só extensão" é **aceita, com emenda** do `docs/evolution/PLAN.md`, feita só se e quando for acionada.
8. **Q13/Q14 (licença e OpenVSCode):** verificados na fonte; ver os fatos abaixo.

## Fatos verificados na fonte (2026-10-31)

| Fato                                                                                                                                                                       | Fonte                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Code OSS: MIT License, "Copyright (c) 2015 - present Microsoft Corporation"                                                                                                | https://github.com/microsoft/vscode/blob/main/LICENSE.txt                                          |
| `ThirdPartyNotices.txt` lista componentes de terceiros e licenças; a redistribuição mantém os avisos de copyright e de permissão de cada um                                | https://github.com/microsoft/vscode/blob/main/ThirdPartyNotices.txt                                |
| O produto Visual Studio Code usa "a traditional Microsoft product license"; logos e nomes são marcas e ficam fora do repositório                                           | https://github.com/microsoft/vscode/wiki/Differences-between-the-repository-and-Visual-Studio-Code |
| Termos do VS Marketplace ("Last Updated September 2025"): uso só com os In-Scope Products and Services (VS, VS Code, GitHub Codespaces, Azure DevOps, Azure DevOps Server) | https://aka.ms/vsmarketplace-ToU                                                                   |
| Open VSX: "a vendor-neutral open-source alternative to the Visual Studio Marketplace", projeto Eclipse com instância pública em open-vsx.org                               | https://github.com/eclipse-openvsx/openvsx                                                         |
| OpenVSCode Server: servidor remoto com acesso por navegador; MIT; último release `openvscode-server-v1.109.5` (2026-02-20); último push 2026-09-24; não arquivado          | https://github.com/gitpod-io/openvscode-server                                                     |

**Não verificado:** os termos de uso de publicação e consumo do open-vsx.org.

## Condições de execução

Antes de abrir a W6 ou criar o `hseos-code`:

1. Ler os termos de uso do open-vsx.org antes do primeiro uso (não verificados no aceite).
2. Verificar no upstream a tag estável exata e registrar a data, no momento da criação do fork.
3. Revisão jurídica de licenças, marca e ativos antes do primeiro lançamento.

O aceite **não** cria o repositório nem inicia o fork.
