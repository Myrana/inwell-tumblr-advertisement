# Verlyn CLI And MCP Transition

This guide defines the initial mixed CLI/MCP posture for governed repositories:
the installed public CLI remains the bootstrap, local-control, and fallback path; MCP is
an optional API-backed workflow lane for supported actions.

## Operating Rule

Use **CLI-first, MCP-optional, CLI fallback**.

- The installed public CLI is required for bootstrap and local machine control.
- MCP may be used after OAuth login for supported API-backed workflow actions.
- If MCP auth, connectivity, or parity is missing, fall back to the CLI.
- Both paths use the same Verlyn account and durable API/database records.

## What The CLI Owns

The CLI remains authoritative for work that depends on the operator machine, local
checkout, governance files, or hosted closeout:

- install and update the Verlyn executable
- login/bootstrap local profiles
- clone and bind repositories
- inspect local target state
- local branch, checkout, and git repair
- governance install/refresh
- trust-contract checks
- changed-file review runner orchestration
- prepare-pr, deliver, deploy, and deployment recovery

These remain CLI-only until a later MCP/local-agent design proves equivalent local
control and provenance.

## What MCP Owns In The First Supported Phase

MCP is API-owned and lives with the API server. In the first supported phase it may be
used for explicitly supported remote workflow operations:

- MCP auth status
- context/repository resolution
- changes list/show/create/update/activate. MCP activation is remote workflow-state
  activation only; it must not check out or repair a branch on the API server worktree.
  Use the CLI for local checkout/branch movement.
- change decisions add
- work-items list/show/update
- work-item work-log and linked-evidence append

MCP does not accept username or password tool arguments. MCP clients authenticate through
OAuth over the existing Verlyn login/session identity.

## How A Person Uses Both

1. Install and authenticate the CLI.

```bash
verlyn auth login
verlyn auth status
```

2. Clone or enter a governed checkout with the CLI.

```bash
verlyn repos clone <repo-slug> ./repo --project-id <project-id>
cd ./repo
verlyn target show --json
verlyn workflow assistant-startup --json
```

3. Configure the MCP-capable client or agent with the API server MCP endpoint.

```text
MCP URL: https://api.verlyn-cockpit.net/mcp
Auth: OAuth authorization-code flow
Scope: verlyn.mcp
```

4. Continue using CLI for local/governance/delivery operations.

5. Use MCP for supported API-backed workflow operations.

6. When switching between the two, keep the same durable identifiers in view:
   `repo_slug`, `change_id`, and `task_id`.

## Switching Proof

The minimum acceptance proof for switching is:

1. CLI resolves the repo and shows a change.
2. MCP resolves the same repo and shows the same change.
3. MCP appends a safe work-log or linked-evidence entry to a work item.
4. CLI reads back the same work item and sees the MCP-authored append.
5. CLI performs a safe supported update.
6. MCP reads back the same change/work item and sees the CLI-authored update.

This proves the two clients are different interfaces over the same Verlyn
identity and durable workflow records.

## Skill And Agent Guidance

Assistant skills and repo governance should keep starting with the installed public CLI
until MCP parity is broader and independently verified.

For now:

- Use CLI for startup, target resolution, edit-route assertions, local checkout state,
  governance, review runner orchestration, and delivery.
- Use MCP only for the supported API-backed tool list when the user has configured MCP
  and OAuth succeeds.
- Fall back to CLI when MCP returns auth/connectivity/parity errors.
- Do not expose delivery/deploy/review-runner operations through remote MCP until they
  have a dedicated threat model and review.

After phase 2 parity lands, skills may prefer MCP for API-backed workflow reads and
mutations, while still requiring CLI for local and closeout operations.
