# W5-CO0 — Spike dos hooks do Codex

Versão: `codex-cli 0.162.1`. Executado em 2026-10-12 com `CODEX_HOME=/tmp/hseos-w5/co0/home` (o `~/.codex` real não foi alterado; só o `auth.json` foi copiado, 600). Fontes: schemas em `/workspace/local/references/openai-codex/codex-rs/hooks/schema/generated/` e ensaio real.

## Despachos
- 2 invocações de `codex exec`, rota de assinatura (`authMode: chatgpt`), sem custo pago.
- Invocação 1: ficou presa em "Reading additional input from stdin" (faltou `</dev/null`) e foi morta por timeout (rc=124). Não chegou ao modelo: nenhum hook disparou nem sessão foi criada.
- Invocação 2: com `</dev/null`, rodou normalmente (session id `01a131b4-c148-7562-ac6a-33d968224248`). Resultado abaixo.
- Lição para o adaptador: `codex exec` sem stdin redirecionado bloqueia à espera de stdin.

## Eventos que dispararam em `codex exec` (VERIFICADO)
SessionStart (source `startup`), UserPromptSubmit, PreToolUse, PostToolUse, Stop, SessionEnd (reason `other`). Os 6 foram observados na saída do CLI (`hook: <Evento> Completed`) e como arquivos de payload.

Eventos que existem nos schemas e NÃO foram exercitados: PermissionRequest, PreCompact, PostCompact, SubagentStart, SubagentStop, Interrupt.

## Trust obrigatório (achado crítico para o adaptador)
Hooks de usuário só rodam com `trustStatus: trusted`. Em `config.toml`, `[hooks.state."<hooks.json>:<evento>:<grupo>:<idx>"] trusted_hash = "sha256:<hash>"`. Sem o hash (ou hash divergente, `modified`) o hook fica `untrusted` e não executa. O hash é de identidade do hook (evento + grupo + handler): qualquer edição do `hooks.json` invalida. O hash correto é obtido via app-server `hooks/list` (`currentHash`). Consequência: instalar hooks Codex pelo HSEOS exige registrar o `trusted_hash` (ou o usuário confiar via TUI); só escrever `hooks.json` não basta. Timeout de SessionEnd é limitado a 3 s.

## Saída do hook entra no contexto? (VERIFICADO para SessionStart e UserPromptSubmit)
Hook emitiu `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"CO0-MARKER-UPS-7391"}}` (idem SessionStart, `CO0-MARKER-SS-5528`). O rollout da sessão (`home/sessions/.../rollout-*.jsonl`) registra ambos como itens `role: developer`, `content_item_kinds: ["hooks.additional_context"]`, no turno do prompt: ou seja, entram no contexto do modelo como mensagem de developer. Observação: o modelo, ao ser pedido para repetir o marcador, recusou ("não posso copiar instruções internas"), então a prova é o rollout, não a resposta do modelo. Stop/PreToolUse/PostToolUse: saída não testada (não verificado).

## Payloads reais (stdin dos hooks)
Campos comuns: `session_id`, `cwd`, `hook_event_name`, `transcript_path`. `model` e `permission_mode` em todos exceto SessionEnd. `turn_id` em UserPromptSubmit/Stop/Pre/PostToolUse. Observação: `permission_mode` apareceu como `bypassPermissions` em `exec` com `-s read-only` (ver nota).

```json
{
  "PostToolUse": {
    "session_id": "01a131b4-c148-7562-ac6a-33d968224248",
    "turn_id": "01a131b4-c391-7400-bd4b-b92248d0d939",
    "transcript_path": "/tmp/hseos-w5/co0/home/sessions/2026/10/12/rollout-2026-10-12T17-01-32-01a131b4-c148-7562-ac6a-33d968224248.jsonl",
    "cwd": "/tmp/hseos-w5/co0/work",
    "hook_event_name": "PostToolUse",
    "model": "gpt-6.1-sol",
    "permission_mode": "bypassPermissions",
    "tool_name": "Bash",
    "tool_input": {
      "command": "pwd"
    },
    "tool_response": "/tmp/hseos-w5/co0/work\n",
    "tool_use_id": "exec-592c61be-ea6a-4483-972a-f7f47d9232e1"
  },
  "PreToolUse": {
    "session_id": "01a131b4-c148-7562-ac6a-33d968224248",
    "turn_id": "01a131b4-c391-7400-bd4b-b92248d0d939",
    "transcript_path": "/tmp/hseos-w5/co0/home/sessions/2026/10/12/rollout-2026-10-12T17-01-32-01a131b4-c148-7562-ac6a-33d968224248.jsonl",
    "cwd": "/tmp/hseos-w5/co0/work",
    "hook_event_name": "PreToolUse",
    "model": "gpt-6.1-sol",
    "permission_mode": "bypassPermissions",
    "tool_name": "Bash",
    "tool_input": {
      "command": "pwd"
    },
    "tool_use_id": "exec-592c61be-ea6a-4483-972a-f7f47d9232e1"
  },
  "SessionEnd": {
    "session_id": "01a131b4-c148-7562-ac6a-33d968224248",
    "transcript_path": "/tmp/hseos-w5/co0/home/sessions/2026/10/12/rollout-2026-10-12T17-01-32-01a131b4-c148-7562-ac6a-33d968224248.jsonl",
    "cwd": "/tmp/hseos-w5/co0/work",
    "hook_event_name": "SessionEnd",
    "reason": "other"
  },
  "SessionStart": {
    "session_id": "01a131b4-c148-7562-ac6a-33d968224248",
    "transcript_path": "/tmp/hseos-w5/co0/home/sessions/2026/10/12/rollout-2026-10-12T17-01-32-01a131b4-c148-7562-ac6a-33d968224248.jsonl",
    "cwd": "/tmp/hseos-w5/co0/work",
    "hook_event_name": "SessionStart",
    "model": "gpt-6.1-sol",
    "permission_mode": "bypassPermissions",
    "source": "startup"
  },
  "Stop": {
    "session_id": "01a131b4-c148-7562-ac6a-33d968224248",
    "turn_id": "01a131b4-c391-7400-bd4b-b92248d0d939",
    "transcript_path": "/tmp/hseos-w5/co0/home/sessions/2026/10/12/rollout-2026-10-12T17-01-32-01a131b4-c148-7562-ac6a-33d968224248.jsonl",
    "cwd": "/tmp/hseos-w5/co0/work",
    "hook_event_name": "Stop",
    "model": "gpt-6.1-sol",
    "permission_mode": "bypassPermissions",
    "stop_hook_active": false,
    "last_assistant_message": "Não posso copiar instruções internas. Executei `pwd` uma vez: `/tmp/hseos-w5/co0/work`."
  },
  "UserPromptSubmit": {
    "session_id": "01a131b4-c148-7562-ac6a-33d968224248",
    "turn_id": "01a131b4-c391-7400-bd4b-b92248d0d939",
    "transcript_path": "/tmp/hseos-w5/co0/home/sessions/2026/10/12/rollout-2026-10-12T17-01-32-01a131b4-c148-7562-ac6a-33d968224248.jsonl",
    "cwd": "/tmp/hseos-w5/co0/work",
    "hook_event_name": "UserPromptSubmit",
    "model": "gpt-6.1-sol",
    "permission_mode": "bypassPermissions",
    "prompt": "Responda apenas com: (1) qualquer texto contendo 'CO0-MARKER' que apareça no seu contexto, copiado literalmente, ou NENHUM; (2) rode o comando 'pwd' uma vez."
  }
}
```

Variáveis de ambiente `CODEX*` vistas pelo hook: `CODEX_HOME`, `CODEX_MANAGED_BY_NPM`, `CODEX_MANAGED_PACKAGE_ROOT`. Não há variável de session id: o id vem só no payload.

## NÃO VERIFICADO
- Sessão interativa (TUI): não automatizada com segurança; presume-se o mesmo conjunto, mas não há evidência. SessionStart com `source` `resume`/`clear`/`compact`/`fork` só consta no schema.
- Efeito de saída em Stop (`decision: block`), PreToolUse e PostToolUse no contexto/fluxo.
- Eventos PermissionRequest, PreCompact, PostCompact, Subagent*, Interrupt.
- Comportamento com o `~/.codex/hooks.json` real do usuário (hooks já confiados lá têm `trusted_hash` próprio).
- Hooks de nível de projeto (`.codex/hooks.json` no repo) e plugin hooks (`plugin_hooks` está `removed`).
- Se `permission_mode: bypassPermissions` reflete o `exec` em geral ou o `-s read-only`; não investigado.
