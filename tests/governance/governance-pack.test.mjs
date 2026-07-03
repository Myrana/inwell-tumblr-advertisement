import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const requiredStartupCommands = [
  'verlyn auth status',
  'verlyn workflow assistant-startup --json',
  'verlyn workflow assert-edit-route --json',
  'verlyn target show --json',
  'verlyn changes list',
  'verlyn changes list --owner-scope all --status-scope all',
  'verlyn runs --limit 3 --json',
];

test('runtime context resume commands include edit-route assertion', () => {
  const context = JSON.parse(read('.verlyn/runtime_context.json'));
  const startupCommandText = context.workflow_defaults.join('\n');

  assert.match(
    startupCommandText,
    /verlyn workflow assert-edit-route --json/,
    'runtime context must include edit-route assertion when describing explicit route state',
  );
});

test('authoritative and compact startup guidance stay aligned', () => {
  const context = JSON.parse(read('.verlyn/runtime_context.json'));
  const guidanceSurfaces = {
    'AGENTS.md': read('AGENTS.md'),
    'Documentation/guides/VERLYN_AGENT_WORKFLOW.md': read('Documentation/guides/VERLYN_AGENT_WORKFLOW.md'),
    'Documentation/guides/VERLYN_PUBLIC_CLI.md': read('Documentation/guides/VERLYN_PUBLIC_CLI.md'),
    '.verlyn/agent-skills/verlyn-public-cli.md': read('.verlyn/agent-skills/verlyn-public-cli.md'),
    '.verlyn/.codex/skills/verlyn-public-cli/SKILL.md': read('.verlyn/.codex/skills/verlyn-public-cli/SKILL.md'),
    '.verlyn/runtime_context.json': [
      ...context.startup_read_order,
      ...context.control_path_priority,
      ...context.workflow_defaults,
    ].join('\n'),
  };
  const compactText = [
    ...context.startup_read_order,
    ...context.control_path_priority,
    ...context.workflow_defaults,
  ].join('\n');

  for (const [file, text] of Object.entries(guidanceSurfaces)) {
    for (const command of requiredStartupCommands) {
      assert.match(text, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${file} missing ${command}`);
    }
  }

  assert.match(compactText, /Documentation\/guides\/VERLYN_CLI_MCP_TRANSITION\.md/);
  assert.match(compactText, /CLI-first, MCP-optional, CLI fallback/);
});

test('generated PR gate pins Verlyn and runs both trust profiles', () => {
  const workflow = read('.github/workflows/verlyn-pr-gate.yml');
  const installSpecs = workflow.match(/VERLYN_CLI_INSTALL_SPEC: "verlyn==0\.1\.73"/g) ?? [];

  assert.equal(installSpecs.length, 2, 'both PR gate jobs should pin the Verlyn CLI version');
  assert.match(workflow, /permissions:\s*\n\s+contents: read\s*\n\s+pull-requests: read/);
  assert.match(workflow, /verlyn workflow trust-contract --profile pr/);
  assert.match(workflow, /verlyn workflow trust-contract --profile tester-lane --require-optional/);
});

test('assistant guidance uses independent changed-file review as primary path', () => {
  const guidanceFiles = [
    'Documentation/guides/VERLYN_AGENT_WORKFLOW.md',
    'Documentation/guides/VERLYN_PUBLIC_CLI.md',
    '.verlyn/agent-skills/verlyn-public-cli.md',
    '.verlyn/.codex/skills/verlyn-public-cli/SKILL.md',
  ];
  const unsafeRecordCommand =
    /verlyn reviews record[^\n`]*changed_file_review[^\n`]*--disposition accepted[^\n`]*/g;
  const auditOnlyRecord =
    /(audit-only|audit records?|already-completed independent review)[\s\S]{0,320}(provenance|reviewed-file|reviewed-file scope)[\s\S]{0,320}job status[\s\S]{0,320}cleanup status/i;

  for (const file of guidanceFiles) {
    const text = read(file);
    assert.match(text, /verlyn reviews changed-files <change-id> --run-independent-review/);
    const recordCommands = text.match(unsafeRecordCommand) ?? [];
    for (const command of recordCommands) {
      const index = text.indexOf(command);
      const commandContext = text.slice(Math.max(0, index - 320), index + command.length + 320);
      assert.match(commandContext, auditOnlyRecord, `${file} must frame each changed-file reviews record command as audit-only`);
    }
  }
});

test('workflow pack manifest matches refreshed governance file bytes', () => {
  const pack = JSON.parse(read('.verlyn/workflow_pack.json'));
  const files = pack.governance_pack.files;
  const governedPaths = [
    'AGENTS.md',
    '.verlyn/runtime_context.json',
    '.verlyn/agent-skills/verlyn-public-cli.md',
    '.verlyn/.codex/skills/verlyn-public-cli/SKILL.md',
    '.github/workflows/verlyn-pr-gate.yml',
    'Documentation/guides/VERLYN_AGENT_WORKFLOW.md',
    'Documentation/guides/VERLYN_PUBLIC_CLI.md',
    'Documentation/guides/VERLYN_CLI_MCP_TRANSITION.md',
  ];

  for (const path of governedPaths) {
    assert.ok(files[path], `${path} must be represented in workflow_pack.json`);
    const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
    assert.equal(files[path].sha256, hash, `${path} sha256 must match current file bytes`);
  }
});
