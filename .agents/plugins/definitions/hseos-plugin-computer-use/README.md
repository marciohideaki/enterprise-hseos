# `hseos-plugin-computer-use`

> **Status: scaffolded.** The capability is implemented in core (`packages/agent-environment`); this definition registers
> the packaged form generated from the same code. Linux only.

## Purpose

A computer-use session drives one GUI target on a private display: `start` opens the session, each call performs one
action (`screenshot`, `move`, `click`, `double_click`, `type`, `key`, `scroll`) and `stop` closes it. Only one session
runs at a time. Screenshots come back as `data` parts with `origin: display`, `trust: untrusted`, the session, the
sequence number, a UTC time, a SHA-256 digest and the transform that produced them.

## Approval per action

Every action except a screenshot needs an approval bound to that exact action: session, sequence number, action,
arguments and the digest of the last screenshot the approver saw. The approval is used once and expires. There is no
approve-all and the `bypass` and `plan` execution modes do not apply; the approval gate and its policy-lattice check
(`tools/cli/lib/environment-approval.js`) stay in the HSEOS core host.

## Isolation

Xvfb and the target run as one job in the P1 sandbox: own network namespace, own `/tmp`, clean environment. The server
listens on an abstract socket that exists only inside that namespace (a filesystem socket needs a root-owned
`/tmp/.X11-unix`, which the sandbox cannot provide), so the operator's display, `XAUTHORITY`, Wayland and
`XDG_RUNTIME_DIR` are unreachable. The host proves this at start by failing to reach the operator's display, and a
session that can reach it is refused. `stop` and expiry drain every descendant; a session that cannot be proved drained
blocks the next one.

## Input injector

`xdotool` (BSD-3-clause) is a pinned system package with one variant per distro (the development host and the CI
runner): each variant fixes its `.deb` by SHA-256 and its licence text is read inside it. The installed package version
selects the variant; a version that no variant names, or a missing package, reports BLOCKED.

## Packaging

`plugins/computer-use/plugin.json` lists the core files; `tools/lib/environment-plugin-pack.js` copies them at pack time
(no duplicated code, at most 40 entries and 1 MB). No binary enters a tarball and nothing is downloaded at run time.
