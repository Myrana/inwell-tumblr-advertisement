# Project Rules

This file is for project-specific rules set by the repository owner.

Rules in this file must not override `CONTRIBUTING.md` or `AGENTS.md`. Add only
guidance that is specific to this repository, team, product, stack, or workflow.

## Rules

- Frontend code must stay segmented by domain. Keep `App.tsx` focused on
  application orchestration, routing/view selection, top-level state wiring,
  and composition. Build substantial UI as named reusable components in
  domain-appropriate files instead of adding more feature detail directly to
  `App.tsx`.
- Extract common behavior into reusable functions or modules when it appears in
  more than one place or is likely to be shared. Parsing, normalization,
  validation, date/time formatting, queue payload shaping, and storage helpers
  should live outside React components unless the logic is truly component-local.
- Organize new code by ownership and domain, such as editor, queue, runner,
  submit targets, tags, persistence, and shared utilities. Avoid creating broad
  catch-all files for unrelated helpers.
