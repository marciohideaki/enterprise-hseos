#!/usr/bin/env python3
"""Campaign artifact scan: literal credential values, token patterns and leftover campaign processes.

usage: scan-campaign.py <campaign-dir> <versioned-dir> <sources> <control-pass-prefix> <process-pattern|-> <output.json>
  sources: comma-separated. A path is a JSON credential file (every string value of 40+ characters without spaces is a literal);
           'pass:<entry>' is one secret kept in pass, compared as a whole value.
  control-pass-prefix: every pass entry under enterprise-hseos/ whose name starts with it is a control credential literal.
Values are never written to the output and never passed in argv: they go to a 0600 pattern file that is removed afterwards.
"""
import datetime, json, os, re, subprocess, sys, tempfile

campaign, versioned, sources, control_prefix, ps_pattern, out = sys.argv[1:7]
WORKER_RULE = r'provider-(campaign|claude-account|acp)-worker|antigravity_campaign_worker'
# Credential files also hold public metadata (scope names, plan tiers) that appears inside the installed client binary; scanning
# those produced false positives, so only token-like strings (40+ characters, no spaces) count as literals from a file.
MIN_TOKEN_LENGTH = 40


def strings(o):
    if isinstance(o, dict):
        for v in o.values():
            yield from strings(v)
    elif isinstance(o, list):
        for v in o:
            yield from strings(v)
    elif isinstance(o, str) and len(o) >= MIN_TOKEN_LENGTH and ' ' not in o:
        yield o


def pass_show(entry):
    return subprocess.run(['pass', 'show', entry], capture_output=True, text=True).stdout.strip()


vals, labels = [], []
for src in [x for x in sources.split(',') if x]:
    if src.startswith('pass:'):
        v = pass_show(src[5:])
        labels.append({'source': src, 'values': 1 if v else 0})
        vals += [v] if v else []
    else:
        path = os.path.expanduser(src)
        found = []
        if os.path.exists(path):
            try:
                found = list(strings(json.load(open(path))))
            except Exception:
                found = []
        labels.append({'source': src, 'values': len(found)})
        vals += found
listed = subprocess.run(['pass', 'ls', 'enterprise-hseos'], capture_output=True, text=True)
if listed.returncode != 0:
    sys.exit('scan aborted: pass ls enterprise-hseos failed, so the control credentials cannot be enumerated')
listing = listed.stdout
for name in sorted(set(re.findall(re.escape(control_prefix) + r'[0-9a-f-]+', listing))):
    v = pass_show('enterprise-hseos/' + name)
    labels.append({'source': 'pass:enterprise-hseos/' + name, 'values': 1 if v else 0})
    vals += [v] if v else []
if not any(l['source'].startswith('pass:enterprise-hseos/' + control_prefix) for l in labels):
    sys.exit('scan aborted: no control credential entry starts with ' + control_prefix)
empty_sources = [l['source'] for l in labels if l['values'] == 0]

hits = 0
fd, patfile = tempfile.mkstemp(prefix='scan-patterns-')
try:
    os.chmod(patfile, 0o600)
    with os.fdopen(fd, 'w') as handle:
        handle.write('\n'.join(vals) + '\n')
    if vals:
        for target in (campaign, versioned):
            r = subprocess.run(['grep', '-rlF', '-f', patfile, '--', target], capture_output=True, text=True)
            if r.returncode not in (0, 1):  # 0 = matches, 1 = none, anything else is a read error, never "no hits"
                sys.exit('scan aborted: grep failed on ' + target + ' (exit ' + str(r.returncode) + ')')
            hits += len([x for x in r.stdout.splitlines() if x.strip()])
finally:
    os.unlink(patfile)

pattern = re.compile(r'sk-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{20,}|Bearer [A-Za-z0-9._-]{16,}')  # sk- covers sk-ant-, sk-proj- and the like
KNOWN_PLACEHOLDERS = {'sk-ant-api03-invalid-diagnostic-key-0000000000'}  # deliberately invalid keys used by the no-cost diagnostics
pattern_hits, pattern_hit_files, placeholder_files = 0, [], []
for base, _, files in os.walk(versioned):
    for name in files:
        if os.path.abspath(os.path.join(base, name)) == os.path.abspath(out):
            continue  # never scan the report being rewritten: it names the known placeholders
        found = set(m.group(0) for m in pattern.finditer(open(os.path.join(base, name), errors='ignore').read()))
        if not found:
            continue
        rel = os.path.relpath(os.path.join(base, name), versioned)
        if found <= KNOWN_PLACEHOLDERS:
            placeholder_files.append(rel)
        else:
            pattern_hits += 1
            pattern_hit_files.append(rel)


def cwd_of(pid):
    try:
        return os.readlink('/proc/%s/cwd' % pid)
    except OSError:
        return ''


procs = []
for line in subprocess.run(['ps', '-eo', 'pid,args'], capture_output=True, text=True).stdout.splitlines()[1:]:
    pid, _, args = line.strip().partition(' ')
    if os.path.basename(__file__) in args:
        continue
    if (cwd_of(pid) + '/').startswith(campaign.rstrip('/') + '/') or re.search(WORKER_RULE, args) or (ps_pattern != '-' and re.search(ps_pattern, args)):
        procs.append(re.sub(r'\s+', ' ', line)[:200])

res = {
    'schema_version': 2,
    'scanned_at_utc': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'scanned_paths': [campaign, versioned],
    'literal_values_checked': len(vals),
    'literal_sources': labels,
    'literal_min_length_from_files': MIN_TOKEN_LENGTH,
    'literal_hit_reporting': 'count of files with a literal match; the files are not named, so a literal can never leak through this report',
    'sources_with_no_value': empty_sources,
    'files_with_literal_hits': hits,
    'pattern_hits_in_versioned_artifacts': pattern_hits,
    'pattern_hit_files': pattern_hit_files,
    'known_invalid_placeholder_files': placeholder_files,
    'known_invalid_placeholders': sorted(KNOWN_PLACEHOLDERS),
    'patterns': 'sk-... (letters, digits, hyphen, underscore; covers sk-ant-, sk-proj-), JWT eyJ..., Bearer ... (16+ chars)',
    'process_rule': 'cwd under the campaign directory, or command line matching ' + WORKER_RULE + ('' if ps_pattern == '-' else ' or ' + ps_pattern),
    'matching_processes_after_campaign': len(procs),
    'matching_process_lines': procs,
    'does_not_cover': 'secrets of 20 to 39 characters in a credential file are not searched as literals (floor of ' + str(MIN_TOKEN_LENGTH) + ', accepted because shorter values there are identifiers and public metadata); patterns inside the control state; transcripts the client persists under its own home; truncated or re-encoded values; the raw process listing is not versioned',
}
json.dump(res, open(out, 'w'), indent=2)
open(out, 'a').write('\n')
print({k: res[k] for k in ('literal_values_checked', 'files_with_literal_hits', 'pattern_hits_in_versioned_artifacts', 'matching_processes_after_campaign', 'sources_with_no_value')})
