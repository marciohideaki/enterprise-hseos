#!/usr/bin/env python3
"""Campaign artifact scan: literal credential values, token patterns and leftover client processes. Values are never written."""
import json, os, re, subprocess, sys, datetime
campaign, versioned, auth_json, pass_group, ps_pattern, out = sys.argv[1:7]
def strings(o):
    if isinstance(o, dict):
        for v in o.values(): yield from strings(v)
    elif isinstance(o, list):
        for v in o: yield from strings(v)
    elif isinstance(o, str) and len(o) > 20: yield o
vals = []
for f in [x for x in auth_json.split(',') if x and os.path.exists(os.path.expanduser(x))]:
    try: vals += list(strings(json.load(open(os.path.expanduser(f)))))
    except Exception: pass
ls = subprocess.run(['pass', 'ls', 'enterprise-hseos'], capture_output=True, text=True).stdout
for name in re.findall(re.escape(pass_group) + r'[0-9a-f-]+', ls):
    vals.append(subprocess.run(['pass', 'show', 'enterprise-hseos/' + name], capture_output=True, text=True).stdout.strip())
vals = [v for v in vals if v]
hits = 0
for t in (campaign, versioned):
    for v in vals:
        if subprocess.run(['grep', '-rlF', '--', v, t], capture_output=True, text=True).stdout.strip(): hits += 1
pat = re.compile(r'sk-[A-Za-z0-9]{20}|eyJ[A-Za-z0-9_-]{20}|Bearer [A-Za-z0-9]')
pattern_hits = 0
for base, _, files in os.walk(versioned):
    for f in files:
        if pat.search(open(os.path.join(base, f), errors='ignore').read()): pattern_hits += 1
def cwd_of(pid):
    try: return os.readlink('/proc/%s/cwd' % pid)
    except OSError: return ''
ps = []
for line in subprocess.run(['ps', '-eo', 'pid,args'], capture_output=True, text=True).stdout.splitlines()[1:]:
    pid, _, args = line.strip().partition(' ')
    if os.path.basename(__file__) in args: continue
    if cwd_of(pid).startswith(campaign) or (ps_pattern != '-' and re.search(ps_pattern, args)): ps.append(line)
res = {"schema_version": 1, "scanned_at_utc": datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
       "scanned_paths": [campaign, versioned], "literal_values_checked": len(vals), "literal_hits": hits,
       "pattern_hits_in_versioned_artifacts": pattern_hits, "patterns": "sk-..., JWT eyJ..., Bearer ...",
       "process_rule": "cwd under the campaign directory" + ("" if ps_pattern == "-" else " or command line matching: " + ps_pattern), "matching_processes_after_campaign": len(ps), "matching_process_lines": [re.sub(r'\s+', ' ', l)[:200] for l in ps],
       "note": "Values are never written. Literal values come from the client credential files listed and from the campaign control credential in pass. Does not inspect patterns inside the control state."}
json.dump(res, open(out, 'w'), indent=2); open(out, 'a').write('\n'); print({k: res[k] for k in ('literal_values_checked', 'literal_hits', 'pattern_hits_in_versioned_artifacts', 'matching_processes_after_campaign')})
