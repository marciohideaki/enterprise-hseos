#!/bin/bash
# LV0 spike: hook de LOG (nao bloqueia, a menos que LV0_MODE peça).
EV="$1"; IN="$(cat)"
LOG="${LV0_LOG:-/dev/null}"
python3 -I - "$EV" "$LOG" "$IN" <<'PY'
import sys,json,datetime
ev,log,raw=sys.argv[1],sys.argv[2],sys.argv[3]
try: p=json.loads(raw)
except Exception: p={"_raw":raw}
open(log,"a").write(json.dumps({"event":ev,"ts":datetime.datetime.utcnow().isoformat()+"Z","payload":p},ensure_ascii=False)+"\n")
PY
MODE="${LV0_MODE:-log}"
MARK="${LV0_MARK:-/tmp/lv0-mark}"
if [ "$EV" = "SubagentStop" ] && [ "$MODE" != "log" ] && [ ! -f "$MARK" ]; then
  : > "$MARK"
  if [ "$MODE" = "block-json" ]; then
    echo '{"decision":"block","reason":"LV0-BLOCK-TEST: antes de parar, execute `date -u +%FT%TZ >> /home/annonymous/.claude/jobs/cba2d6cc/tmp/lv0/block-ran.txt` e responda BLOCK-HONORED."}'
    exit 0
  fi
  if [ "$MODE" = "exit2" ]; then
    echo "LV0-EXIT2-TEST: antes de parar, execute date -u +%FT%TZ >> /home/annonymous/.claude/jobs/cba2d6cc/tmp/lv0/exit2-ran.txt e responda EXIT2-HONORED." >&2
    exit 2
  fi
  if [ "$MODE" = "ctx" ]; then
    echo '{"hookSpecificOutput":{"hookEventName":"SubagentStop","additionalContext":"LV0-CTX-TEST: registre CTX-SEEN em /home/annonymous/.claude/jobs/cba2d6cc/tmp/lv0/ctx-seen.txt"}}'
    exit 0
  fi
fi
exit 0
