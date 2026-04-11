# HSEOS Workflows

Workflow files define reusable delivery flows that coordinate one or more agents.

Each workflow must declare:
- intent and scope
- prerequisites and predecessor artifacts
- ordered phases
- evidence required per phase
- gates: hard-fail, clean-stop, warn
- run-state location and resume rules

Use `hseos workflow list` to inspect registered workflows.
Use `hseos workflow validate <workflow-id> --repo <path> --profile <core|release|runtime|full>` to check readiness.
Use `hseos workflow init <workflow-id> --run-id <id> --repo <path>` to create a stateful run.
Use `hseos workflow status <workflow-id> --run-id <id> --repo <path>` to inspect the current handoff.
Use `hseos workflow sync <workflow-id> --run-id <id> --repo <path>` to rebuild the run-state from BMAD artifacts and sprint tracking.
Use `hseos workflow resume <workflow-id> --run-id <id> --repo <path>` to synchronize and print the recommended handoff for continuation.
Use `hseos workflow advance <workflow-id> --run-id <id> --repo <path> --note "<evidence>"` to complete the current phase and move to the next one.
Use `hseos workflow batch <workflow-id> --run-id <id> --repo <path>` to emit batch handoff packets and logs for long-running phases.
Use `hseos workflow gate <workflow-id> --run-id <id> --gate <name> --gate-status <status>` to record quality or operational gate results.
Use `hseos workflow story-status <workflow-id> --run-id <id> --story-id <story> --story-status <status>` to sync a story with the run-state and BMAD sprint tracker.
Use `hseos workflow story-commit <workflow-id> --run-id <id> --story-id <story> --commit <sha>` to record the implementation commit per story.
