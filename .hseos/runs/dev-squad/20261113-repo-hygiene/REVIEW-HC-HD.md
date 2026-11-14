# REVIEW-HC-HD: revisões céticas das ondas HC e HD

Cada onda teve um revisor Sonnet isolado, em duas passagens: cega e confronto. O revisor reporta e não corrige.

## HC: remoção versionada (PR #322)

**Veredito:** APROVADO COM RESSALVAS (0 BLOCKER, 0 MAJOR). Ponta revisada: `9da71c6c`.

O revisor confirmou na passagem cega:
- o diff tem 147 entradas (145 D, 1 A, 1 M), todas nas áreas permitidas, e nenhum `STATUS.md` de run de `dev-squad` saiu (26 antes, 26 depois);
- nenhum dos 145 tem citação real na árvore final, seja por caminho completo, caminho absoluto ou caminho relativo à run;
- os 145 caminhos existem na tag `hseos-hygiene-archive-20261113` e somam 562188 B;
- nenhum código, teste ou CI depende dos removidos (`ado-preflight-gate.sh` é advisory).

Ressalvas e tratamento:

| # | Sev. | Achado | Tratamento |
|---|---|---|---|
| 1 | MINOR | 24 células `undefined` na coluna de citantes do MANIFEST | Corrigido em HC3 (`a69bad75`): candidatos sem citante passam a mostrar `0` |
| 2 | MINOR | Cifras de branches na nota do MAPA sem evidência versionada | Corrigido em HC2 (`46fc5aa4`): `GIT-HYGIENE.md` e `REVIEW-HB.md` foram versionados |
| 3 | MINOR | O MANIFEST não declarava o limite das citações por run-id | Corrigido em HC3: nova seção "Limites" |
| 6 | NOTE | Tag publicada? | Sim, publicada antes da remoção (`git ls-remote --tags origin 'hseos-hygiene*'`) |

## HD: guard contra reacúmulo (PR #323)

**Veredito:** APROVADO (0 BLOCKER, 0 MAJOR). Ponta revisada: `33adb8eb`.

- Foram 20 mutações contra a política e a árvore reais. Todas dispararam a regra esperada, inclusive com caminhos com espaço, caminhos não ASCII, subpastas de run e manifest com CRLF.
- O guard roda na suíte: `test:governance` → `test/test-governance-scripts.js`.
- Os arquivos novos ficam fora do pacote, e `ci-test-shards verify` passa.
- `GATE_CODE_MODE: 'full'` no teste existente apenas repete o padrão de `quality-gates.sh` (`${GATE_CODE_MODE:-full}`). Torna o teste hermético e não afrouxa nenhum gate.

Ressalvas e tratamento:

| # | Sev. | Achado | Tratamento |
|---|---|---|---|
| 1 | MINOR | Um manifest de remoção vazio desligava R5 sem aviso | Corrigido em HD2 (`c62f49a4`): manifest vazio falha fechado, com teste |
| 2 | MINOR | O manifest só reconhece caminhos exatos de arquivo | Registrado; hoje os 145 itens são arquivos |
| N1–N3 | NOTE | O guard vê só o índice git; R4 cobre só o 1º nível; `.hseos/**` empacotado não mudou | Declarados no `docs/hygiene/README.md` |
