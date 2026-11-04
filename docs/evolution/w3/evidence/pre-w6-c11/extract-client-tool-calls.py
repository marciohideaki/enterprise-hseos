#!/usr/bin/env python3
"""Projects the tool calls of one or more Claude Code sessions out of the client's own transcript files (~/.claude/projects/*/<session>.jsonl).
usage: extract-client-tool-calls.py <output.json> <session-id> [<session-id> ...]
Keeps only: tool name, input arguments, the first 400 characters of the tool result, timestamps and the transcript file name. No credential is read."""
import glob, json, os, sys
out, sessions = sys.argv[1], sys.argv[2:]
result = []
for sid in sessions:
    files = glob.glob(os.path.expanduser('~/.claude/projects/*/%s.jsonl' % sid))
    entry = {'session_id': sid, 'transcript_file': [os.path.basename(f) for f in files], 'tool_calls': []}
    uses = {}
    for f in files:
        for line in open(f):
            try: d = json.loads(line)
            except Exception: continue
            msg = d.get('message') or {}
            content = msg.get('content')
            if not isinstance(content, list): continue
            for block in content:
                if block.get('type') == 'tool_use':
                    uses[block['id']] = {'timestamp': d.get('timestamp'), 'tool': block.get('name'), 'input': block.get('input')}
                elif block.get('type') == 'tool_result' and block.get('tool_use_id') in uses:
                    r = block.get('content')
                    text = r if isinstance(r, str) else json.dumps(r)
                    uses[block['tool_use_id']]['result_prefix'] = text[:400]
                    uses[block['tool_use_id']]['result_timestamp'] = d.get('timestamp')
    entry['tool_calls'] = list(uses.values())
    result.append(entry)
json.dump(result, open(out, 'w'), indent=2, ensure_ascii=False); open(out, 'a').write('\n')
print([(e['session_id'][:8], len(e['transcript_file']), [c['tool'] for c in e['tool_calls']]) for e in result])
