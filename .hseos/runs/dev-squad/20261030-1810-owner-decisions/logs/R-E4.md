# R-E4 — revisão cética da E4 (commit a9a0676d, branch task/od-e4-redaction-short, base 0efe5698)

Veredito: PASS-WITH-NOTES. Nenhum FAIL. Revisor só reportou; worktree intocado. Sondas e cópias em /build/tmp/rev-e4/ (base via git archive, mutações em cópia).

## (1) Vazamento: sonda própria (chaves em memória, nunca em disco)
- Chaves: ed25519, x25519, rsa2048 pkcs8/pkcs1, rsa4096 pkcs8, ec P-256/384/521 pkcs8 e sec1, openssh-key-v1 (montado à mão), PKCS8 cifrado (aes-256/128/192-cbc, des-ede3-cbc) sobre ed25519, ec256, rsa2048, rsa4096.
- Formas: 2/3/4 linhas e 16/20/24/32/40/64 colunas. Contextos: puro, CRLF, indentado, YAML, prefixo ISO, `[stderr] `, `stderr: `, `ERROR: `, prefixo só na 1a linha, após texto, com `\n` literal em JSON (2 variantes), JSON.stringify com `\n` real, palavra solta após o bloco. Sinks: sanitizeDiagnostic, safeStderr, retainOutput (output_text ausente = retido nao ocorre).
- Resultado alvo: 10 500 combinações, 0 vazamentos de janela de 12 chars. Base na mesma sonda: milhares (5 843 de 8 250 na primeira rodada). Cifrado e 2–4 linhas: confirmados corrigidos nos 3 sinks e na retenção.
- Fora da sonda limpa (ver achados): prefixo `ISO + ERROR ` sem dois-pontos; array JSON de linhas serializado; quebras <16 colunas (12/15; resíduo declarado).

## (2) Sobre-redação
- Corpus de 714 textos legítimos (SPKI ed25519/x25519/rsa/ec em 6 larguras, pseudo-certs X.509 `MIIC…`/`30 82` em 5 larguras, base64 aleatório 2–4 linhas em 6 larguras x30, `sha512-…` 1 e 2 linhas, UUIDs, base64url, JWT, stack trace, saída de git, ssh pública, texto com prefixo de cabeçalho no meio). Saídas (sanitize, safeStderr, retenção) comparadas com a base: 0 diferenças. Nada que a base mantinha passou a ser redigido; o que é redigido (3+ linhas sem cabeçalho, heurística antiga) é idêntico.
- "Palavra solta após bloco ancorado": confirmada e é maior que o declarado (achado N3).

## (3) Desempenho / ReDoS (1 MB, base -> alvo, redactDiagnosticText)
lines64 29->101 ms; lines16 85->159; alt15/16 74->135; header15+16 54->129; headerSplitMany 102->193; headerDanglingBody 72->132; litNL 60->152; oneLine 26->58; headerRepeatNoSpace 19->62. Pior caso 0,23 s, sem comportamento quadrático observado (teste de linearidade existente passa). Custo ~2–3x, aceitável.
- `'a-'.repeat(n)` quadrático: CONFIRMADO NA BASE e não é da E4. Causa é containsCredential/CREDENTIAL_PATTERNS (redactKeyBodies leva 0–4 ms). Base vs alvo: 4096 chars 10 vs 14 ms; 20k 221 vs 268; 40k 901 vs 1195; 65k 2616 vs 2944 (diferença = ruído de carga, host em modo pinned). E4 não piorou.
- Exposição real: stderr do processo de campanha é cortado em 4096 chars antes do clipText (14 ms, ok); retenção limitada a 65 536 bytes (~2,7 s no pior caso, igual à base); mas safeStderr/engineering-task-runtime recebem stderr de git com maxBuffer de 1–4 MB sem teto antes de containsCredential: 80k chars = 3,8 s, extrapolando 1 MB = minutos. Pré-existente (N4), fora do escopo da E4, vale registrar.

## (4) Testes
- diff de test/: 91 inserções, 0 remoções; controles antigos intactos. G3: só 2 arquivos existentes (M). containsCredential/CREDENTIAL_PATTERNS sem diff (só a menção no comentário).
- Mutações próprias (cópia, arquivo de teste da E4, 77 testes): (a) HEADER_LOOKAHEAD=0: 20 falhas; (b) sem o prefixo cifrado `30 82`: 4 falhas; (c) retenção sem hasAnchoredBlock: 18 falhas; (d) sem a captura de "palavra solta": 17 falhas; (e) sem JSON_CLOSED_TAIL: 6 falhas; (f) sem o prefixo cifrado `30 81`: 2 falhas. Todas derrubam teste.

## (5) Verdes
- cg.sh, os 5 arquivos juntos (--test-concurrency=1): tests 141, pass 141, fail 0, cancelled 0, skipped 0. test-campaign-key-body-redaction.js isolado: 77/77 (confere o 77/77).
- c8 (campaign-evidence-store.js, esses 5 arquivos): 95,84% linhas / 92,08% branch (executor: 95,79/89,47; conjunto diferente). >=90/80.
- eslint limpo, prettier limpo nos 2 arquivos. Commit: assunto de 90 chars, sem atribuição de IA.
- Não rodei package-surface (fora do que o brief pede para provar além de "eslint/prettier/G3"); não verificado.

## Passagem 2 — confronto com o executor
- 77/77 e vermelho 56/77: 77/77 confirmado; vermelho 56/77 não reproduzido literalmente, mas minhas mutações dão 2–20 falhas (a executor: 20 e 6 batem com (a)/(e)-classe). Confirmado em substância.
- 8000 combinações sem vazamento: confirmado e superado (10 500 na minha sonda, incl. cifrados de 4 ciphers).
- Linearidade: confirmada.
- Resíduos: quebras <16 colunas (confirmado vaza), cifrado com comprimento de 3 bytes (não verificável com o node; não testado), última linha <16 colada a texto não-JSON (confirmado: vazam os últimos ~4 chars `Pl46` em `…Pl46 failed`).

## Achados
- N1 (Média, pré-existente, não declarado): prefixo `AAAA-MM-DDTHH:MM:SSZ ERROR <linha>` (nível sem dois-pontos) faz o corpo inteiro vazar em todas as formas, inclusive as já "cobertas" (3+ linhas, 64 colunas). LINE_PREFIX (campaign-evidence-store.js:111) só tira o timestamp e deixa `ERROR`. Reprodução: probe.js ctx prefixLevel, 629 de 750 combinações vazam no alvo (693 na base). Não é regressão; formato de log comum, vale registrar como resíduo ou corrigir depois.
- N2 (Baixa, pré-existente): array de linhas serializado (`["row1","row2"]`) vaza (cada elemento entre aspas; regras de linha única só pegam >=20 após cabeçalho). Via sanitizeDiagnostic sobre array real o tratamento é por elemento (não testado como fluxo real).
- N3 (Baixa, nova): após o bloco ancorado, a regra come mais que "uma palavra solta": linha de 16+ chars base64-like (UUID, sha hex de 40) é absorvida como continuação e, em seguida, qualquer token <=15 chars/<= linha anterior também (`…rows\n123e4567-…\nnext` -> `<withheld: key body, 5 lines>` e o `next` some). Falha fechada, perda de diagnóstico limitada a 2 linhas, mas o comentário de limites fala só de "one bare word". Repro: clipText(rows24 + '\n' + uuid + '\nnext').
- N4 (Média, pré-existente, fora de escopo): quadrático em containsCredential; ver (3).
- N5 (Info): glue de última linha <16 com texto não-JSON vaza ~4–15 chars do fim do corpo (resíduo aceito, ok).

## Reconferência a77337f6
Veredito: PASS-WITH-NOTES.
- (1) Risco da cauda REFUTADO: `redactDiagnosticTail` devolve só `redactKeyBodies(text).slice(-cap)`, ou seja, o que foi varrido é exatamente o que é devolvido. Com valores sintéticos em memória (ghp_, sk-, password=, Bearer, PEM completo) no início, no meio e no fim de 1 MB: nunca aparecem na saída de safeStderr/probeStderr (início/meio: cortados fora da cauda; fim: `[redacted: credential-like content]`). Corpos de chave são redigidos no texto inteiro antes do corte.
- Nota N6 (Baixa-Média, regressão só para safeStderr/probeStderr): segredo com marcador CAVALGANDO o limite dos 4096 chars volta como sufixo sem marcador (ghp_/sk-/password: sufixo vaza; bearer/PEM não, pois a cauda ainda os pega). Antes (varredura total) não vazava. Correção barata: descartar a primeira linha parcial da cauda ou cortar com folga e varrer. Repro: /build/tmp/rev-e4/tail.js caso `straddle`.
- (2) Sonda anterior + prefixos novos (`ISO ERROR`, `[pid]`, `stderr |`) + arrays JSON: 12 000 combinações, 0 vazamentos (N1 e N2 corrigidos). Corpus legítimo de 714 casos: 0 diferenças vs base.
- (3) 1 MB adversarial (lines64/16, alt15/16, header split, `a-`, `\n` literal, linhas/array entre aspas, prefixos repetidos, glued): safeStderr e probeStderr 12–257 ms. sanitizeDiagnostic sobre string não limitada continua quadrático em containsCredential (`a-` x 200k = 22,9 s; pré-existente, não coberto pelo tail; no fluxo real o stderr de campanha é cortado em 4096 antes).
- (4) cg.sh, 5 arquivos anteriores + test-platform-bindings*.js + test-engineering-task-runtime.js: 253 testes, 251 pass, 2 fail ("files that change during the protected review / final verification…"). Os mesmos 2 falham na BASE 0efe5698 (0 pass) -> pré-existentes/ambiente, não regressão (no alvo, uma das rodadas passou 1 de 2: instável). eslint e prettier limpos, worktree limpo, commit sem atribuição.
