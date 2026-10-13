# W5-LV0 — Spike I1–I3 (sessão Helix, plataforma cambio-real-platforms)

Data: 2026-10-12 (UTC). Executado pela sessão `plano-w3-helix-fundacao` a pedido da sessão `revalidar-core-entregar-w5` e com autorização do owner. Claude Code 2.1.296. Nenhum arquivo de configuração do usuário ou de repositório foi alterado: o I3 rodou em processos `claude -p` descartáveis, em diretório de scratch, com `--setting-sources project,local` (sem os hooks do usuário) e hooks de LOG que só gravam o payload. Evidência bruta: `/tmp/hseos-w5/research/lv0-evidence/`.

## Resumo

| Item | Resultado | Estado |
|---|---|---|
| I1 | O aviso de término de uma tarefa em segundo plano NÃO acorda um teammate ocioso. Fica em fila e só é entregue quando outra mensagem o acorda. | PASS (evidência de transcript) |
| I2 | O CronCreate do líder dispara no líder; o teammate ocioso não é acordado por ele. Só `SendMessage` acordou. | PASS (evidência de transcript) |
| I3 SubagentStop | Dispara para subagentes do Agent tool. Traz `agent_id`, `last_assistant_message`, `background_tasks` (com a tarefa ainda rodando), `stop_hook_active`, `session_crons`. | PASS no modo headless; NÃO VERIFICADO no modo interativo com teammates nomeados |
| I3 TeammateIdle | NÃO disparou em nenhuma das 5 execuções. | NÃO VERIFICADO |
| I3 semântica | `decision: block` (JSON), exit 2 com stderr e `additionalContext` fizeram o subagente continuar e executar a instrução recebida. | PASS (n=1 por variante) |

## I1 — o aviso de término não acorda o teammate

Método: teammate `lv0-i1` (Agent tool, Haiku, nomeado, endereçável por SendMessage) lança `sleep 30` com `run_in_background: true` e encerra o turno com `WAITING_ON_BG`.

Linha do tempo (UTC):
- 19:34:31 início; 19:34:32 o teammate encerra o turno (a notificação de ocioso chega ao líder).
- 19:35:02 o `sleep 30` termina (`i1-bg-done.txt`).
- 19:37:15 (2 min 13 s depois do término) o transcript do teammate continua com as mesmas 23 linhas; `i1-woken.txt` não existe; nenhuma linha `queued_command` aparece.
- 19:38:00 o líder envia `SendMessage` de controle; o teammate acorda em 19:38:01 e grava `i1-woken.txt`.
- Só então o transcript registra (linha 26) o anexo `queued_command` com a `<task-notification>` da tarefa `beliog3qb`, com timestamp de 19:35:02, isto é, o aviso ficou ENFILEIRADO por 2 min 59 s e foi entregue no mesmo turno do acordar por mensagem.

Conclusão: o término de uma tarefa em segundo plano não gera turno para o teammate ocioso. Isso reproduz o achado da W5-02b (commit 06:06Z, acordou 16:45Z).

## I2 — cron do líder

Método: `CronCreate` one-shot do líder para 19:37Z, com o teammate `lv0-i1` já ocioso desde 19:34:32.
- 19:37:15 o cron disparou no líder (o prompt agendado chegou ao líder; `i2-tick-leader.txt`).
- O transcript do teammate não recebeu nada entre 19:34:32 e 19:38:00 (única entrada nova: a mensagem de controle).
Conclusão: o cron acorda a sessão que o criou, não o teammate. Dependência: o cron só dispara com o líder ocioso, e morre com a sessão (documentado pelo próprio CronCreate).

## I3 — payloads reais (execução headless, Agent tool síncrono)

Os payloads abaixo vêm de `hooks-A2.jsonl` (subagente com `sleep 25` ainda rodando ao tentar parar).

### SubagentStart
```json
{
  "session_id": "6daf12a8…",
  "transcript_path": "/home/annonymous/.claude/projects/-home-annonymous--claude-jobs-cba2d6cc-tmp-lv0-scratch/6daf12a8-3a77-42a5-bfcb-7e6018427de5.jsonl",
  "cwd": "/home/annonymous/.claude/jobs/cba2d6cc/tmp/lv0/scratch",
  "prompt_id": "3f8bca39…",
  "agent_id": "ac333999dd50884ef",
  "agent_type": "general-purpose",
  "hook_event_name": "SubagentStart"
}
```

### SubagentStop (tarefa em segundo plano ainda ativa)
```json
{
  "session_id": "6daf12a8…",
  "transcript_path": "/home/annonymous/.claude/projects/-home-annonymous--claude-jobs-cba2d6cc-tmp-lv0-scratch/6daf12a8-3a77-42a5-bfcb-7e6018427de5.jsonl",
  "cwd": "/home/annonymous/.claude/jobs/cba2d6cc/tmp/lv0/scratch",
  "prompt_id": "3f8bca39…",
  "permission_mode": "bypassPermissions",
  "agent_id": "ac333999dd50884ef",
  "agent_type": "general-purpose",
  "effort": {
    "level": "medium"
  },
  "hook_event_name": "SubagentStop",
  "stop_hook_active": false,
  "agent_transcript_path": "/home/annonymous/.claude/projects/-home-annonymous--claude-jobs-cba2d6cc-tmp-lv0-scratch/6daf12a8-3a77-42a5-bfcb-7e6018427de5/subagents/agent-ac333999dd50884ef.jsonl",
  "last_assistant_message": "WAITING",
  "background_tasks": [
    {
      "id": "bwy9ktj1s",
      "type": "shell",
      "status": "running",
      "description": "sleep 25",
      "command": "sleep 25"
    }
  ],
  "session_crons": []
}
```

### Stop (líder)
```json
{
  "session_id": "6daf12a8…",
  "transcript_path": "/home/annonymous/.claude/projects/-home-annonymous--claude-jobs-cba2d6cc-tmp-lv0-scratch/6daf12a8-3a77-42a5-bfcb-7e6018427de5.jsonl",
  "cwd": "/home/annonymous/.claude/jobs/cba2d6cc/tmp/lv0/scratch",
  "prompt_id": "3f8bca39…",
  "permission_mode": "bypassPermissions",
  "effort": {
    "level": "medium"
  },
  "hook_event_name": "Stop",
  "stop_hook_active": false,
  "last_assistant_message": "DONE\n\nTexto literal devolvido pelo subagente `lv0-sub`:\n\n```\nWAITING\n```\n\nO `sleep 35` em primeiro plano terminou com `exit=0`, dentro do limite de 50 s.\n\nObservação: pedi ao subagente `run_in_background: false`, então ele não ficou em segundo plano. A resposta `WAITING` veio do relatório final dele, sem sinais de que ele tenha executado o `sleep 25` em background como pedido. Não investiguei isso mais a fundo.\n\n\n[redigido: instrução privada do operador]",
  "background_tasks": [],
  "session_crons": []
}
```

Observações:
- `background_tasks` é uma lista de objetos `{id, type, status, description, command}` e vem PREENCHIDA com a tarefa em execução (`status: running`). No run A (um `echo` que já terminara) veio `[]`. Isso permite ao guard saber que há espera externa pendente sem depender de regex na última mensagem.
- `stop_hook_active` é `false` na primeira tentativa e `true` na tentativa seguinte ao bloqueio.
- `session_crons` veio `[]`.
- Eventos do stream do líder (`--include-hook-events`): `background_tasks_changed` mostra a tarefa com `parent_task_id` igual ao `agent_id` do subagente, ou seja, o harness sabe a quem a tarefa pertence.

### Semântica de bloqueio (SubagentStop)
Mesma situação em 3 execuções (bloqueio na primeira tentativa, passe na segunda):
- `{"decision":"block","reason":"…"}` com exit 0 (run B): o subagente continuou, executou o pedido do `reason` (`block-ran.txt` às 19:38:51) e respondeu `BLOCK-HONORED`. Segunda tentativa: `stop_hook_active: true`.
- exit 2 com texto em stderr (run C): idem (`exit2-ran.txt` às 19:39:39, resposta `EXIT2-HONORED`).
- `{"hookSpecificOutput":{"hookEventName":"SubagentStop","additionalContext":"…"}}` SEM `decision` (run D): o subagente também NÃO parou: continuou e executou o pedido do contexto (`ctx-seen.txt`). Ou seja, `additionalContext` no SubagentStop também manteve o subagente em trabalho nesta versão. Observado uma vez; confirmar antes de depender.
- A tarefa em segundo plano continuou ativa depois do bloqueio (a segunda tentativa ainda lista a mesma tarefa em `running`).

## NÃO VERIFICADO (nunca PASS)
1. `TeammateIdle`: não disparou em nenhuma execução. O modo headless `-p` cria o subagente de forma síncrona (`is_backgrounded: false`), sem o time de teammates nomeados; o evento pode exigir o modo interativo com `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (a variável estava no env do scratch). Para medir, registrar um hook de LOG de `TeammateIdle` nas configurações da própria sessão do orquestrador (decisão do owner: é alteração de configuração).
2. O payload de `SubagentStop` para teammates nomeados e em segundo plano (como os squads reais), fora do modo headless síncrono. Prever o mesmo shape, mas não medido.
3. Teto de bloqueios consecutivos (a documentação cita 8 sem tool call) e `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`: não exercitados.
4. `additionalContext` sem `decision` fazer o subagente continuar: n=1.
5. Se o `queued_command` de término é entregue ao líder em turno próprio quando o líder está ocioso (neste spike os avisos de tarefas em segundo plano do próprio líder chegaram a ele em fila, mas isso não foi cronometrado).
6. Comportamento de `Stop`/`SubagentStop` sob timeout do hook, e com o modelo do subagente diferente de Haiku.

## Implicações para a LV1 (guard)
- Detectar espera pendente por `background_tasks` não vazio (campo estruturado), não por regex.
- Para recusar a parada: `decision: block` com `reason` acionável (ex.: "aguarde em primeiro plano em blocos ≤540 s, ou declare o estado estruturado"); respeitar `stop_hook_active`.
- Como o bloqueio mantém a tarefa em segundo plano viva, o guard pode instruir o subagente a esperá-la em primeiro plano em vez de abandoná-la.
- O reaper externo continua necessário: só `SendMessage` acorda um teammate ocioso (I1/I2), logo o guard só atua quando o subagente tenta parar; se ele já parou ocioso, apenas o orquestrador/watchdog o acorda.

## Reprodução
Scripts em `lv0-evidence/`: `hook-log.sh` (hook de log com modos `log|block-json|exit2|ctx`), `scratch-settings.local.json`, `leader-prompt*.txt`, `run-chain.sh`. Comando-base: `claude -p "$(cat leader-prompt2.txt)" --setting-sources project,local --model haiku --max-turns 14 --max-budget-usd 0.6 --dangerously-skip-permissions --output-format stream-json --verbose --include-hook-events --no-session-persistence` dentro do scratch. Custo total do spike: cerca de US$ 0,03 em execuções headless, mais os dois subagentes de teste.
