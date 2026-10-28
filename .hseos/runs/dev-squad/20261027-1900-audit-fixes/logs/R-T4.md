# R-T4 — revisão cética do commit 4c4926ab (base f96c6e9c)

Alvo conferido: HEAD do worktree = 4c4926ab (não se moveu). Revisor reporta; nada foi alterado no repo.

## Veredito: PASS-WITH-NOTES

A entrega cumpre a spec e os gates. Há 2 lacunas de cobertura de redação (ambas já existiam na base, nenhuma regressão), das quais uma contradiz o comentário do código.

## Achados

| # | Sev. | Onde | Descrição / reprodução |
|---|------|------|------------------------|
| F1 | média-baixa | `campaign-evidence-store.js` `SINGLE_LINE_BODY` (lookbehind `(?<![A-Za-z0-9+/_=-])`) | Corpo de chave de uma linha precedido de `=`, `-`, `_` ou `/` NÃO é redigido: `clipText('key=' + der_ed25519_b64)`, `data=`, `blob=`, `?k=`, `/`, `k-`, `k_` vazam inteiros (também OpenSSH `data=b3Blbn…`). O comentário do código (`key=MIIE…` "é substituído no lugar") está errado. `containsCredential('key=…')` é false, então nada mais pega. Na base também vazava (sem regressão). `x: <corpo>` e `"<corpo>"` são redigidos. |
| F2 | baixa | `redactLines`/`classify` | Última linha curta de um corpo multilinha vazia quando está na mesma linha de texto/JSON: `JSON.stringify({stderr: pem_body_multilinha})` ou `corpo + ' trailing'` deixa a linha final (RSA-4096 pkcs8: 32 chars; pkcs1: 60 chars; EC-521 sec1: 44 chars) em claro, com `"}` ou texto colado. Corpo com texto à esquerda não vaza. Também vazava na base. A variante "dentro de JSON" pedida na spec tem teste só com chave de linha única/`\n` literal em JSON, não com a cauda grudada. |
| F3 | informativa | `redactKeyBodies` | Se algo é redigido, TODO `\n` literal do texto vira quebra de linha real (ex.: caminho `C:\new` junto de um corpo). Cosmético. |
| F4 | informativa | teste | O caso OpenSSH usa cabeçalho + `row(180)` sintético, não chave real do `ssh-keygen`. Verifiquei eu mesmo com `ssh-keygen` (ed25519 e rsa RFC4716 em dir descartável, apagado): multilinha, linha única, `\n` literal, prefixo `[stderr] `, CRLF, aspas: todos redigidos. |

## Resultados por item

1. Sonda própria (ed25519, x25519, rsa 2048/3072/4096 pkcs8+pkcs1, ec P-256/384/521 pkcs8+sec1; multilinha 64, linha única, `\n` literal, prefixo `[stderr] `, JSON, CRLF, indentado, com END solto, `x: `, aspas): 168 formas x `sanitizeDiagnostic`/`clipText`. Base: 184 vazamentos; novo: 20, todos da forma "JSON de corpo multilinha" (F2). `kv` com `secret=` é pego por `containsCredential`. `safeStderr`/`probeStderr`/`evidenceMessage` têm testes próprios que passam; não refiz a sonda extensiva neles (usam a mesma função `redactDiagnosticText`).
2. Sobre-redação: sha256-b64, `integrity sha512-…`, linha b64 de 64, hex, UUID, b64 de 48 bytes, stack trace, `fatal: not a git repository`, caminhos, SPKI ed25519 (DER b64), PEM público RSA, cert-like `MIIC…`, `C:\new\folder`, JSON de log, linha de lockfile: saída idêntica à base. Única mudança é pré-existente (3 digests em linhas viram `<withheld … 3 lines>`, igual à base). Prefixo de chave pública RSA (`MIIBIjANBgkq…`) é mantido.
3. `containsCredential` inalterada (diff só adiciona exports). `test-campaign-evidence.js` 17/17 no cgroup.
4. Desempenho: 1 MB de ~16 mil linhas b64, linha única, `\n` literal, cabeçalhos repetidos, quase-acertos, 1 MB de `-`/`A`/`MIGA`: 9–136 ms, no mesmo patamar da base. Sem ReDoS nas regexes novas (classes sem aninhamento ambíguo; lookbehind de 1 char).
5. Ciclo de require: `platform-bindings`, `engineering-task-runtime`, `provider-campaign-process` carregam sem erro.
6. Mutações próprias (cópias em /build/tmp/rev-t4, removidas): (m1) KEY_HEADER desativado -> 16 falhas; (m2) `safeStderr` sem redação -> 1 falha; (m3) `probeStderr` sem redação -> 1 falha; (m4) sem normalização de `\n` literal -> 13 falhas. Todas mortas.
7. Diff de teste: só 2 linhas removidas (import de `createHash` reescrito e título do teste "single long base64 line" renomeado, com assert extra adicionado). Nenhuma asserção enfraquecida; controles negativos `sha512-<86>` e `row(64)` intactos.
8. eslint 9.39 (`node_modules/.bin/eslint`) e prettier limpos nos 5 arquivos. `test-package-surface.js` 1/1.
9. c8 (`engineering-task-runtime.js`, só `test-engineering-task-runtime.js`, mesmo comando base x novo): base 89,98 L / 77,24 B / 91,17 F; novo 89,77 L / 77,24 B / 88,57 F. Queda de 0,21 pt em linhas e 2,6 pt em funções nessa seleção estreita, por causa da nova `probeStderr` (coberta apenas pelo teste de redação, que não faz parte desta seleção). Branches iguais. O gate oficial usa a suíte `test:kernel` completa (não medida; `test-engineering-task-runtime.js` está nela, o teste de redação não verifiquei). Risco de ficar abaixo de 90/80 existe mas não foi medido; o executor reporta 90,04/78,17 numa seleção maior.
10. Mensagem do commit sem `Co-Authored-By`/menção a IA (0 ocorrências).

Testes (valores literais, no worktree): key-body-redaction 39/39; campaign-evidence 17/17 (cgroup); platform-bindings 1/1; -command 36/36; -downgrade 22/22; provider-campaign-adapters 18/18, -control 32/32, -runner 5/5 (cgroup; fora dele falham 5, 22 e 3, é o ambiente); engineering-task-runtime 49/49 (cgroup); package-surface 1/1.

## Alegação -> veredito (passagem 2)

| Alegação do executor | Resultado |
|---|---|
| `containsCredential` intacta | Confirmada |
| Regra de linha única cobre os tipos listados, `\n` literal tratado | Confirmada (com F1, F2 como limites não declarados) |
| "Cabeçalho no meio da linha é substituído no lugar" | Refutada em parte: não vale após `=`, `-`, `_`, `/` (F1) |
| `clipText` usa `redactDiagnosticText` | Confirmada |
| `probeStderr` e `evidenceMessage` redigem | Confirmada |
| `safeStderr` nos 5 sites | Confirmada (diff) |
| 39 testes, 13 tipos, controles negativos mantidos | Confirmada (39/39) |
| Mutações mortas (16/13/1/1/1) | Confirmada para as 4 que repliquei (16/13/1/1 contra mutações minhas); a 5ª não reproduzida |
| c8 `engineering-task-runtime.js` 90,04/78,17 vs base 89,98/78,27 | Não reproduzida (seleção diferente); minha seleção mostra queda leve (item 9) |
| Lotes não refeitos após `eslint --fix` | Eu refiz no commit final: todos verdes |
| `test-campaign-evidence.js` só passa no cgroup | Confirmada (travou fora; verde no cgroup) |

## Não verificado

Cobertura c8 da suíte `test:kernel` completa (pesada, não solicitada); os 3 usos reais de `evidenceMessage`/`probeStderr` fora dos testes unitários; sonda extensiva de variantes diretamente em `safeStderr`/`probeStderr` (mesma função de base); chaves cifradas (PKCS8 encrypted) e formatos fora da lista, que o próprio código declara como limite.

LIVENESS: {"state":"DONE","reason":"review T4","evidence":"logs/R-T4.md"}
