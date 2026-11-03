#!/usr/bin/env python3
"""Projects the memory events and the approval rows of the campaign database copy (read-only), without the note text.
usage: extract-ledger.py <project.db copy> <events-output.json> <approvals-output.json> [<operation-id> ...]
The optional operation ids (the ids a client received) add the execution events of those operations, to link the client call to the ledger."""
import json, sqlite3, sys
db, events_out, approvals_out = sys.argv[1:4]
operation_ids = sys.argv[4:]
c = sqlite3.connect('file:%s?mode=ro' % db, uri=True)
cols = [r[1] for r in c.execute('pragma table_info(execution_events)')]
events = []
for row in c.execute("select * from execution_events where aggregate_type like '%memory%' order by position"):
    d = dict(zip(cols, row)); p = json.loads(d['payload_json']); e = p.get('entry') or {}
    events.append({'position': d['position'], 'event_type': d['event_type'], 'aggregate_type': d['aggregate_type'], 'aggregate_id': d['aggregate_id'],
        'memory_id': p.get('memory_id') or e.get('memory_id'), 'project_id': (e.get('scope') or {}).get('project_id'), 'origin': e.get('origin'),
        'trust': e.get('trust'), 'authority': e.get('authority'), 'write_policy_ref': e.get('write_policy_ref'), 'supersedes': e.get('supersedes'),
        'created_at': e.get('created_at'), 'recorded_at': d.get('occurred_at') or d.get('created_at') or d.get('recorded_at'),
        'source_digest': e.get('source_digest'), 'source_ref': e.get('source_ref'), 'promotion': p.get('promotion') or None})
operations = []
for op in operation_ids:
    for row in c.execute("select * from execution_events where aggregate_id = ? order by position", (op,)):
        d = dict(zip(cols, row))
        operations.append({'position': d['position'], 'aggregate_type': d['aggregate_type'], 'aggregate_id': d['aggregate_id'], 'event_type': d['event_type'],
            'recorded_at': d.get('occurred_at') or d.get('created_at') or d.get('recorded_at')})
events = {'memory_events': events, 'client_operations': operations}
json.dump(events, open(events_out, 'w'), indent=2, ensure_ascii=False); open(events_out, 'a').write('\n')
acols = [r[1] for r in c.execute('pragma table_info(execution_approvals)')]
approvals = [dict(zip(acols, r)) for r in c.execute('select * from execution_approvals')]
ucols = [r[1] for r in c.execute('pragma table_info(execution_approval_uses)')]
uses = [dict(zip(ucols, r)) for r in c.execute('select * from execution_approval_uses')]
json.dump({'execution_approvals': approvals, 'execution_approval_uses': uses}, open(approvals_out, 'w'), indent=2, default=str); open(approvals_out, 'a').write('\n')
print([(e['position'], e['event_type'], e['memory_id'], e['created_at']) for e in events['memory_events']], [(o['position'], o['event_type']) for o in operations])
