# WAVE 2 REPORT - NG-16 BS2 prefix resolution

## Output

- `cerebro` sanitized branch now fails closed for unresolved BS2 payout external-id prefixes.
- Unknown prefixes record audit/alert signals where the schema exists.
- Legacy `envious` resolution is allowed only when the historical check-code exists.
- Runbook added for unresolved BS2 payout prefixes.

## Evidence

- Commits: `a286d5692`, `3c918f11c`.
- Tests: 4 tests, 9 assertions.
- `cambioreal.com` inspected: no equivalent direct BS2 payout resolver was found.

## Handoff

- Keep this contained in `events-engine-sanitized` until PR review.
- Confirm exact formats for any future `TUS`/`PagamentoBr` prefixes before adding them to the explicit map.
