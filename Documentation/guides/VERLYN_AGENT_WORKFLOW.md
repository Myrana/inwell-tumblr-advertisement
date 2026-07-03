# Verlyn Agent Workflow

Use this guide when an assistant or agent is working inside this repository.
`AGENTS.md` is authoritative for policy, `CONTRIBUTING.md` is authoritative for
commit protocol, and `RULES.md` contains repo-owned guidance. Use
`Documentation/guides/VERLYN_PUBLIC_CLI.md` as the detailed command reference.
This is the single assistant-facing workflow guide for Verlyn-governed repo
sessions.

## Reload Order

Read, in order:

1. `AGENTS.md`
2. `CONTRIBUTING.md`
3. `RULES.md`
4. `.verlyn/runtime_context.json` when present
5. `Documentation/AI_USAGE_POLICY.md`
6. this guide
7. `Documentation/guides/VERLYN_PUBLIC_CLI.md`
8. `Documentation/guides/VERLYN_CLI_MCP_TRANSITION.md` when present
9. active change details from Verlyn when work already exists

After compaction, compressed-summary recovery, or any stale-context resume,
reread the governed files and visibly tell the operator:

> Governance was reloaded and required repo rules were reread.

## Required Startup

Run these before suggesting edits or changing files:

```bash
verlyn auth status
verlyn workflow assistant-startup --json
verlyn workflow assert-edit-route --json
verlyn target show --json
verlyn changes list
verlyn changes list --owner-scope all --status-scope all
verlyn runs --limit 3 --json
```

These commands verify CLI auth, repo binding, current branch, active change
route, visible work, and recent run context. If auth, target binding, or edit
routing fails, repair that public Verlyn path before editing.

Inspect `workflow_hint` first when present. It is the canonical chain-aware
resolver payload shared by `workflow assistant-startup --json`,
`workflow inbox --json`, and `changes next --json`. Use
`selected_change`, `recommended_action`, `recommended_command`, `safe_to_edit`,
`reason_code`, `chain_context`, `blocked_changes`, `ready_roots`,
`current_branch_context`, `resolver_status`, and `degraded_reason` before
guessing from flat lists. Product hints such as `recommended_next_action`,
`next_action`, `recommended_next_command`, `review_context`, `task_rollup`,
`workflow_gate`, `repair_status`, and `next_step` guide the next command but
never bypass repo policy.

## Control Path

Public CLI first, API-backed workflow state, and no private bypasses.

1. Installed public `verlyn` CLI commands.
2. MCP for explicitly supported API-backed workflow actions when the user has
   configured MCP and OAuth succeeds.
3. Web UI workflow surfaces for run creation, onboarding, and settings.
4. Stop and record a Verlyn workflow blocker when the product path is missing
   or blocked.

The initial mixed CLI/MCP posture is **CLI-first, MCP-optional, CLI fallback**.
Use `Documentation/guides/VERLYN_CLI_MCP_TRANSITION.md` for the supported MCP
tool list and switching rules. Keep using the CLI for bootstrap, local checkout
state, governance files, review-runner orchestration, trust checks, and hosted
delivery/deploy until those surfaces have explicit MCP parity and review.

Do not use private Verlyn maintenance commands, direct database access, direct
workflow-record edits, provider-secret handling, or shell provider tools such
as `gh` as substitutes for Verlyn's installed product workflow.

Normal Verlyn commands are repo-scoped from the current checkout plus the saved
CLI login profile. Avoid `--profile`, `--server`, `--repo-slug`, and `--target`
unless bootstrapping, diagnosing, automating outside a checkout, or performing
explicit recovery. If normal repo work needs an override to pass, treat it as
auth, repo binding, or checkout drift to repair through Verlyn.

Normal commands are repo-scoped from the current governed checkout. Optional overrides such as `--profile`, `--server`, `--repo-slug`, `--target`, `--source-ref`, and `--commit-sha` are diagnostics, bootstrap, automation, or recovery controls, not routine workflow inputs.

For vendor-specific delivery changes, query
`/api/repos/{repo_slug}/delivery/providers` before changing provider behavior.
Railway is the first concrete provider slice using Verlyn's shared provider
plugin core and manifest-backed provider contract.

## Auth And Repo Binding

Normal login:

```bash
verlyn auth login --server <verlyn-api-url> --username <user>
verlyn auth status
```

When login runs from a repository checkout, inspect any `governance_status`
payload and follow its `recommended_next_command`.

For first checkout of a repo already attached to a Verlyn project:

```bash
verlyn repos clone <repo-slug> ./local-folder --project-id <project-id>
```

CLI auth is user/profile scoped. Entity, project, repository, workflow, and
provider credential resolution stay in Verlyn's backend. Local checkout paths
are user-machine preferences, not repository identity.

## Change And Work-Item Flow

Use installed `verlyn` commands for tracked work:

```bash
verlyn changes list
verlyn changes show <change-id> --json
verlyn changes create --title "..." --change-type <type> --effort-band <small|medium|large>
verlyn changes update <change-id> --proposal-summary "..." --proposal-scope "..."
verlyn changes activate <change-id>
verlyn changes refresh-branch <change-id>
verlyn work-items list <change-id>
verlyn work-items update <change-id> --creates-json '[{"title":"Add validation"}]'
verlyn work-items update <change-id> --updates-json '[{"task_id":"<starter-work-item-id>","notes":"Concrete scope and acceptance for this change."}]'
verlyn work-items update <change-id> --updates-json '[{"task_id":"<work-item-id>","status":"done"}]'
verlyn workflow gate <change-id> --scope delivery
```

Creation and activation are separate. Draft means planning only: agents may
inspect files and flesh out change/work-item records, but must not write files,
run write-formatters, generate source artifacts, or apply patches until
`verlyn changes activate <change-id>` has bound the branch and
`verlyn workflow assert-edit-route --json` returning `allowed: true` confirms
the edit route for that change.

`verlyn changes create` seeds required starter work items. Update those
starters in place with concrete scope, acceptance, notes, and validation
guidance before implementation. `Review findings` is the required code/task
review ticket when no separate human review applies. Use it to check scope,
unrelated edits, hallucination risk, and verification before closeout.

Changed-file review evidence for `prepare-pr`, `deliver`, and `deploy` must
come from an independent reviewer. If the operator is working inside an AI
agent, that agent must request an independent review agent or another
independent AI path to review the full contents of every changed file and record
that independent provenance, for example:

```bash
verlyn reviews changed-files <change-id> --independent-local-agent --reviewer <agent-name>
```

Use the first-class runner/request path when the CLI should manage this step:

```bash
verlyn reviews changed-files <change-id> --run-independent-review
```

If a supported local AI launcher is not available, the command fails closed and
returns the whole-file prompt, spawn instructions, and exact follow-up record
command instead of recording accepted evidence. The spawn instructions require
inherited tool defaults and tell the agent to retry without explicit model or
agent-type overrides when launch rejects them.
For unattended local review launches, configure `VERLYN_REVIEW_RUNNER_COMMAND`
to a command that reads the prompt from stdin and returns strict JSON on stdout.
The public CLI also accepts `--review-runner-command` for a one-off command.
When that command is missing or not executable, the CLI must report structured
launcher diagnostics and remain fail-closed.

The independent reviewer must use the generated changed-file review
instructions from the CLI/API review result. That versioned rubric requires
whole-file inspection, not diff-only inspection, and explicitly checks large
files/functions, branch and nesting complexity, parameter count, broad exception
handling, security/auth ordering, state and route ownership, critical-path
tests, analyzer hotspots, and runtime/deployment risk. If a separate review
agent or job is spawned, record its review job id, agent/session id, terminal
status, and cleanup status; closeout fails when a recorded review job is still
running, failed, stale, or not cleaned up.
Use the `--review-job-id`, `--agent-id`, `--review-job-status`, and
`--agent-cleanup-status` options on `verlyn reviews changed-files` or
`verlyn reviews record` when the wrapper has spawned and monitored an
independent reviewer.
Use `verlyn reviews record` for changed-file review only as audit records from
an already-completed independent review when provenance, reviewed-file scope,
review job status, and cleanup status are all known.
When the independent reviewer returns structured `blocking_findings`,
`code_quality_findings`, or `test_gaps`, the review-record path creates or
updates review-finding work items tied to that review entry, review job,
severity, file, rubric check, and line where available. Closeout keeps the same
creation/update path as a backstop for older review evidence. Score-relevant
quality issues for a touched file must be actionable work items rather than
accepted residual-risk prose.

Treat review-generated remediation work items as complete structural work
orders, not narrow patch prompts. Work the full intent of the reviewer finding:
split or reduce the named domain/subdomain when size or complexity is called
out, clean the full testing lane or matrix when critical-path tests are called
out, and repair the complete exception/security/failure path when broad
handling or authorization boundaries are called out. If the generated ticket
contains several examples, those examples describe the breadth of the work; do
not complete only one example and rerun review. Complete or explicitly
disposition every review-created work item from that review batch, then run a
fresh independent/configured-AI changed-file review before retrying `deliver`
or `deploy`.

A resident/local self-review, deterministic fallback review, or configured-AI
record without required usage evidence may be stored for audit, but it does not
satisfy the closeout gate and cannot be bypassed with
`--allow-review-findings`. Use `--allow-review-findings` only for accepted risk
on findings produced by an independent review.

The public CLI profile also carries an explicit changed-file review gate mode.
Use `verlyn repos review-mode show` before closeout when mode is unclear, and
use `verlyn repos review-mode set full|changed-surface|bypass --reason "..."`
only when the change record and operator intent support that posture. Missing
profile state defaults to `full`. `bypass` reports warning metadata through
`prepare-pr`, `deliver`, `deploy`, and `workflow gate`, and it suppresses
automatic PR package review evidence recording; do not summarize bypass mode as
accepted independent review evidence. Backend routes honor non-full modes only
with authorized public CLI client checkout context, so do not handcraft bare
API payloads to bypass review gates.

## Governance Pack

Use API-backed governance commands:

```bash
verlyn governance install --target <repo>
verlyn governance refresh --target <repo>
verlyn governance refresh --target <repo> --dry-run --json
```

Verlyn owns installed governance pack files except repo-owned `RULES.md`.
Refresh preserves `RULES.md` and overwrites generated files so stale local
guidance returns to the current contract.

Generated PR gates run the CI trust suites through the packaged public CLI, not
through repo-local support scripts:

```bash
verlyn workflow trust-contract --profile pr
verlyn workflow trust-contract --profile tester-lane --require-optional
```

Verlyn source checkouts may run the source-specific profiles
`verlyn-source-pr` and `verlyn-source-tester-lane`; generated governance for
other repositories must stay on the standalone profiles.

## Source Of Truth

Durable Verlyn truth is managed by Verlyn and scoped by entity, project, and
repository:

- repo binding
- changes and work items
- reviews, decisions, and handoffs
- runs and evidence records
- delivery state

Repo-local files are source code, governance policy, templates, or temporary
artifacts. Do not reconstruct durable workflow truth from local JSON, old
`workstream/` files, direct database queries, generated scratch paths, or chat
summaries.

## Closeout

Use the installed hosted closeout path:

```bash
verlyn changes deliver <change-id> --merge-method squash
verlyn changes deploy <change-id> --merge-method squash
```

`deliver` creates or updates the PR, merges it, records source-control
closeout, and repairs the local checkout when safe. It does not deploy.
`deploy` runs the same closeout and then triggers or monitors the configured
provider. Pass `--source-ref` and optional `--commit-sha` only for explicit
deployment recovery of an already delivered source ref.
If checkout restoration or branch cleanup is unsafe, the command fails closed
with the reported repair command instead of claiming local cleanup succeeded.
For multi-target deployment groups, inspect normalized `deployment_targets`
evidence before summarizing closeout or status. Each target entry carries the
operator label, required flag, provider service identity, deployment id/status,
commit/ref match state, URL, and target-specific reason when stale or failed.
Single-target output remains compact.

Use `verlyn runs abort <run-id>` only for controlled recovery of a stuck,
mis-scoped, or superseded active run, and record the reason on the relevant
change, work item, or handoff.

## Completion

Work is not complete until acceptance criteria are satisfied, applicable
verification passes, Verlyn work items and review records are current, and any
remaining risks or skipped checks are recorded.
