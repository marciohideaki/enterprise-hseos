# Correct the isolated provider consumer probe

The first validation-only distribution run sealed a package from the reviewed
release source135d9c8, then its clean Node22 consumer failed because the probe
passed full-installer switches to the guarded minimal profile. The profile
correctly refused them. No tag, draft or release was created. Artifact uploads
were after that step without an always condition, so this attempt's ephemeral
sealed bytes were not exported and are NOT VALIDATED or retrievable evidence.

This control-only correction centralizes the supported minimal argv, exercises
it through the actual CLI in an isolated temporary project, and checks zero
hooks, skills and MCP servers. The production installer guard remains unchanged.
Successful sealing now causes artifact escrow even if subsequent consumer
validation fails; unsuccessful/partial sealing is not treated as a sealed set.

Definition of done: focused caller/escrow positive and negative regressions,
enforced source code gates, independent review and protected CI before merge;
then validate one reviewable candidate from the original source135d9c8. The
controller scripts/workflow are excluded from the npm runtime payload. Preserve
that release source and all four original SDK archives; no SDK rebuild/repack,
provider inference, package publication or global activation belongs to this fix.

The draft job also checks out the exact workflow controller revision, rather than
the frozen runtime source, so its downloaded-draft probe uses the same corrected
caller. Staging still receives the sealed source and manifest outputs unchanged;
a focused workflow regression binds both independent revisions explicitly.
