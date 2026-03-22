# Install-State Lifecycle

## Purpose

Make HSEOS installation state explicit, inspectable, and repairable through a canonical install-state backend.

## When To Use

Use this capability when:

- planning a selective installation before mutation
- applying module or IDE changes through a controlled plan
- checking drift between recorded install-state and live manifest
- repairing a managed installation after local damage or mismatch

## Use Cases

- preview a selective install for one module before changing project state
- apply an install plan and capture managed ownership in canonical state
- run doctor after repository drift or manual edits
- repair the recorded install-state after a broken or partial install

## Commands

```bash
hseos ops install plan --modules hsm
hseos ops install apply --modules hsm
hseos ops install doctor
hseos ops install repair
hseos ops install inspect
hseos ops install summary
```

## Example Operator Flow

```bash
hseos ops install plan --modules hsm --tools vscode
hseos ops install apply --modules hsm --tools vscode
hseos ops install doctor
```

## Limits

- install-state is local-first and file-backed under `.hseos/data/install`
- legacy `hseos install` still exists for compatibility, but the canonical state backend is shared
- this capability records state and drift; it is not a multi-tenant installer platform

## Troubleshooting

- if `plan` rejects modules or tools, inspect the currently discoverable HSEOS module and IDE catalogs
- if `doctor` reports missing install-state, run `ops install apply` or a compatibility install first
- if `repair` cannot rehydrate state, verify `.hseos/_config/manifest.yaml` still exists
