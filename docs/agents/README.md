# Agents

> One page per agent — what it does, when to activate, what it cannot do.

---

## By role

### Discovery & planning
| Agent | File | When to reach for it |
|---|---|---|
| NYX — Intelligence Broker | [nyx.md](nyx.md) | Research, domain analysis, requirements elicitation |
| VECTOR — Mission Architect | [vector.md](vector.md) | PRD creation, epics, stories, scope definition |
| PRISM — Interface Weaver | [prism.md](prism.md) | UX design, interaction flows, design systems |
| CIPHER — Systems Architect | [cipher.md](cipher.md) | Architecture design, ADR drafting, boundary checks |

### Execution
| Agent | File | When to reach for it |
|---|---|---|
| RAZOR — Sprint Commander | [razor.md](razor.md) | Sprint planning, story preparation, backlog management |
| GHOST — Code Executor | [ghost.md](ghost.md) | Story implementation with TDD |
| BLITZ — Solo Protocol | [blitz.md](blitz.md) | Compressed solo delivery (small scope, fast iteration) |
| GLITCH — Chaos Engineer | [glitch.md](glitch.md) | Test generation, quality gates, adversarial review |
| QUILL — Knowledge Scribe | [quill.md](quill.md) | Technical documentation, API docs, developer guides |

### Delivery & operations
| Agent | File | When to reach for it |
|---|---|---|
| ORBIT — Flow Conductor | [orbit.md](orbit.md) | Full epic delivery orchestration, delivery readiness |
| FORGE — Release Engineer | [forge.md](forge.md) | Artifact publication, CI/CD, release evidence |
| KUBE — Kubernetes Operator | [kube.md](kube.md) | GitOps manifest updates, ArgoCD deploys |
| SABLE — Runtime Operator | [sable.md](sable.md) | Runtime verification, smoke tests, AI governance audits |

### Parallel execution
| Agent | File | When to reach for it |
|---|---|---|
| SWARM — Parallel Execution Commander | [swarm.md](swarm.md) | Heterogeneous batch (3+ independent tasks) executed as parallel waves under worktree isolation |

---

## Authority boundaries at a glance

| Can do | Cannot do |
|---|---|
| NYX: requirements elicitation, gap analysis | Approve PRDs, define architecture, choose solutions |
| VECTOR: PRD, epics, stories, scope ADRs | Define architecture, override NFRs, approve arch ADRs |
| CIPHER: architecture, ADR drafts, boundary checks | Approve ADRs, alter security/compliance standards, change stack |
| PRISM: UX flows, wireframes, design system | Scope decisions, architecture changes |
| RAZOR: stories, sprint planning, retrospectives | Change scope, define architecture, approve ADRs |
| GHOST: implementation, TDD, code commits | Modify story scope, change architecture, bypass tests |
| BLITZ: compressed full-stack delivery | Change governance, alter security baselines, approve ADRs |
| GLITCH: tests, quality gates, coverage | Scope changes, architecture changes, approve releases |
| QUILL: documentation, API docs, guides | Requirement changes, architectural decisions |
| ORBIT: workflow orchestration, phase gating | Approve ADRs/releases, invent requirements, skip gates |
| FORGE: artifact publication, CI validation | Bypass gates, update manifests, deploy to runtime |
| KUBE: manifest updates, GitOps PRs, ArgoCD | Build images, verify runtime, modify infra manifests |
| SABLE: runtime verification, governance audits | Re-trigger deploys, update manifests, approve exceptions |
| SWARM: heterogeneous batch decomposition, parallel dispatch under worktree isolation, handoff extraction | Open or merge PRs, push to protected branches, write its own handoffs from inside subagents, override agent authority, bypass G2 plan approval |

---

## The golden rule

Every agent operates within its defined authority. When any agent encounters a decision or action outside its scope, it **stops** and escalates to the responsible agent or human. No agent guesses, fills in gaps, or absorbs another agent's authority.

If you see an agent stopping with an escalation report, that is correct behavior — not a failure.
