# HSEOS CLI Tool

## Installing external repo HSEOS official modules

For external official modules to be discoverable during install, ensure an entry for the external repo is added to external-official-modules.yaml.

For community modules - this will be handled in a different way. This file is only for registration of modules under the hseos-code-org.

## Post-Install Notes

Modules can display setup guidance to users after configuration is collected during `npx hseos install`. Notes are defined in the module's own `module.yaml` — no changes to the installer are needed.

### Simple Format

Always displayed after the module is configured:

```yaml
post-install-notes: |
  Thank you for choosing the XYZ Cool Module
  For Support about this Module call 555-1212
```

### Conditional Format

Display different messages based on a config question's answer:

```yaml
post-install-notes:
  config_key_name:
    value1: |
      Instructions for value1...
    value2: |
      Instructions for value2...
```

Values without an entry (e.g., `none`) display nothing. Multiple config keys can each have their own conditional notes.

### Example: TEA Module

The TEA module uses the conditional format keyed on `tea_browser_automation`:

```yaml
post-install-notes:
  tea_browser_automation:
    cli: |
      Playwright CLI Setup:
        npm install -g @playwright/cli@latest
        playwright-cli install --skills
    mcp: |
      Playwright MCP Setup (two servers):
        1. playwright    — npx @playwright/mcp@latest
        2. playwright-test — npx playwright run-test-mcp-server
    auto: |
      Playwright CLI Setup:
        ...
      Playwright MCP Setup (two servers):
        ...
```

When a user selects `auto`, they see both CLI and MCP instructions. When they select `none`, nothing is shown.

## Structural Execution Governance

HSEOS can validate and explain execution policy packs before installer mutation occurs.

Examples:

```bash
hseos policy validate .enterprise/policies/execution/foundation.policy.yaml
hseos policy explain .enterprise/policies/execution/foundation.policy.yaml
hseos policy explain --project-dir /path/to/project --request-file /path/to/request.yaml
```

## Mission Execution Runtime

HSEOS can claim queued work items into a native runtime state layer:

```bash
hseos run work-item path/to/work-item.yaml
hseos run reconcile
hseos run status mission-id
```
