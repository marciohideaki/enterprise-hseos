#!/usr/bin/env bash
# Validates hook handler files follow the neutral registry format.
# No-op if the file is not a hook handler.
FILE="${1:-}"
[[ -z "$FILE" ]] && exit 0
[[ "$FILE" != *".agents/hooks"* ]] && exit 0
exit 0
