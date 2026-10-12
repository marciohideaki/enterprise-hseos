# REVIEW2 C4 (rodada 2) - testes 230/230 e 79/79 (rodados)
Veredito: APROVAR. C4-1 FECHADO (nenhum caminho leva a allow); C4-2..C4-5 FECHADOS/PARCIAL (residuos baixos).

## C4-1 guard real (CLI `platform-bindings guard` + hook capability-intake-guard.sh com tools/cli apontando ao worktree)
Cenarios: deps `constructor`/`__proto__`/`toString`/`hasOwnProperty`/`valueOf`; package.json raiz malformado, de pacote malformado, `null`, `[]`; deps de tipos estranhos; tsconfig.json 000; packages/a/package.json 000; packages/a 000; pnpm-workspace com `../../etc/*`, 5, null; workspaces nao-string. Em cada um, 3 modos.
- platform: CLI exit 2 (deny) em 11/11; hook exit 2 em 11/11 (o hook repassa o 2 com saida). 
- hybrid e local: CLI exit 0 (allow legitimo: nenhuma implementacao stable / local nunca nega) em 11/11, mesmo valor da base; nenhuma excecao escapa (exit 1 nao ocorreu).
- Correcoes verificadas: DEPENDENCY_STACKS e Map; `decide` envolve detectStacksForFile em try/catch e, se falhar, usa stacks=[] (= qualquer stack, stackSet(empty)=null) com nota - fail-closed. Hook: exit 0 ou 2 com saida sao respeitados; qualquer outro exit/ausencia de saida cai na decisao legada (platform), nao em allow - mas a legada so cobre globs fixos (apps/ seria allow), por isso importa que o CLI nunca saia 1.
- Nao testado por injecao: excecao dentro de loadPlatformBindings->detectStacks (fora do try do decide); nao achei entrada que a provoque (listDirectory/readJsonFile/yaml ja capturam).

## C4-2..C4-5
| ID | Status | Evidencia |
|---|---|---|
| C4-2 | FECHADO (residuo baixo) | "add new user", "create new account", "add a new product", "get the client", "create new client", "add cache", "create the event" => 0 resultados. Positivos mantidos (upload file, auth login, sso login screen, redis cache layer, publish telemetry events...). Residuo: "get data client" => data.query (data + client). Perda de recall: "event create" e "create calendar" agora nao acham calendar.event.create (verbo generico descartado, sobra 1 palavra) |
| C4-3 | FECHADO | projeto react-native: stacks node,react-native (sem react) |
| C4-4 | FECHADO | tsconfig em src/ e tsconfig.app.json profundo => node,react,typescript. Pacote de workspace sem package.json continua herdando so a raiz (node) - aceito |
| C4-5 | FECHADO | `packages/*/pkgs/*`, `*` e `**` entram na uniao (node,react). C4-6 (react em devDep da raiz propaga a scripts/) permanece, documentavel |
