"""Turn raw tee JSONL into committed evidence: bulky tool catalogs collapse to names + count, MRTR state tokens are truncated."""
import json, sys

src, dst = sys.argv[1], sys.argv[2]
out = []
for line in open(src):
    rec = json.loads(line)
    frame = rec['frame']
    res = frame.get('result') if isinstance(frame, dict) else None
    if isinstance(res, dict) and isinstance(res.get('tools'), list):
        res['tools'] = {'count': len(res['tools']), 'names': [t.get('name') for t in res['tools']]}
    if isinstance(res, dict) and isinstance(res.get('content'), list):
        res['content'] = [{'type': c.get('type'), 'text_bytes': len(c.get('text', ''))} for c in res['content']]
        res.pop('structuredContent', None)
    for holder in (res, frame.get('params') if isinstance(frame, dict) else None):
        if isinstance(holder, dict) and isinstance(holder.get('requestState'), str):
            holder['requestState'] = holder['requestState'][:24] + '...(truncated)'
    out.append(rec)
json.dump(out, open(dst, 'w'), indent=2)
open(dst, 'a').write('\n')
