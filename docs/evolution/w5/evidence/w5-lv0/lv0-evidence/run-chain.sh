#!/bin/bash
cd /home/annonymous/.claude/jobs/cba2d6cc/tmp/lv0/scratch
run(){ name=$1; mode=$2
  rm -f /home/annonymous/.claude/jobs/cba2d6cc/tmp/lv0/mark-$name
  LV0_LOG=/home/annonymous/.claude/jobs/cba2d6cc/tmp/lv0/hooks-$name.jsonl LV0_MODE=$mode LV0_MARK=/home/annonymous/.claude/jobs/cba2d6cc/tmp/lv0/mark-$name   claude -p "$(cat /home/annonymous/.claude/jobs/cba2d6cc/tmp/lv0/leader-prompt2.txt)" --setting-sources project,local --model haiku --max-turns 14 --max-budget-usd 0.6 --dangerously-skip-permissions --output-format stream-json --verbose --include-hook-events --no-session-persistence > /home/annonymous/.claude/jobs/cba2d6cc/tmp/lv0/run-$name.stream.jsonl 2> /home/annonymous/.claude/jobs/cba2d6cc/tmp/lv0/run-$name.err
  echo "fim $name $(date -u +%T)" >> /home/annonymous/.claude/jobs/cba2d6cc/tmp/lv0/chain.log
}
rm -f /home/annonymous/.claude/jobs/cba2d6cc/tmp/lv0/chain.log /home/annonymous/.claude/jobs/cba2d6cc/tmp/lv0/block-ran.txt /home/annonymous/.claude/jobs/cba2d6cc/tmp/lv0/exit2-ran.txt /home/annonymous/.claude/jobs/cba2d6cc/tmp/lv0/ctx-seen.txt
run A2 log
run B block-json
run C exit2
run D ctx
echo CHAIN-DONE >> /home/annonymous/.claude/jobs/cba2d6cc/tmp/lv0/chain.log
