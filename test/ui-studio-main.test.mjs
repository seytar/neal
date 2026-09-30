import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../ui/src/main.jsx', import.meta.url), 'utf8');

test('Studio exposes Original and current Plan as distinct artifact tabs', () => {
  assert.match(
    source,
    /const BASE_TABS = \['progress', 'original', 'plan', 'review', 'recovery', 'narrative', 'changes', 'usage'\]/,
  );
  assert.match(source, /label: 'Original plan'/);
  assert.match(source, /Immutable snapshot of the plan file as it was supplied when this Neal run started\./);
  assert.match(source, /label: 'Current plan'/);
  assert.match(source, /Original plan snapshot is unavailable for this legacy run\./);
});

test('Studio blocked-run panel makes the reason and recovery actions visible', () => {
  assert.match(source, /const blocker = studioBlockerSummary\(status\)/);
  assert.match(source, /Neal stopped and needs an action/);
  assert.match(source, /<strong>Reason<\/strong>/);
  assert.match(source, /Open recovery/);
  assert.match(source, /Open review/);
  assert.match(source, /Raw Neal status:/);
});


test('Studio exposes the Neal brand mark and favicon asset', async () => {
  assert.match(source, /className="brand-mark"/);
  assert.match(source, /src="\/neal-mark\.svg"/);

  const index = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
  assert.match(index, /rel="icon" href="\/neal-mark\.svg"/);
});


test('Studio exposes run-scoped Ask Neal chat without bypassing existing actions', () => {
  assert.match(source, /function OperatorChatPanel\(/);
  assert.match(source, />\s*Ask Neal\s*</);
  assert.match(
    source,
    /'\/api\/runs\/' \+ encodeURIComponent\(requestRunId\) \+ '\/chat'/,
  );
  assert.match(source, /message\.action === 'resume'/);
  assert.match(source, /status\?\.resumeDecision\?\.kind === 'continue'/);
  assert.match(source, /onAction\('resume'\)/);
  assert.match(source, /message\.action === 'guidance_and_resume'/);
  assert.match(source, /status\?\.resumeDecision\?\.kind === 'needs_message'/);
  assert.match(source, /onAction\('guidance', \{ message: message\.guidanceMessage \}\)/);
  assert.match(source, /operator-chat-observation/);
  assert.match(source, /operator-chat-decision/);
  assert.match(source, /What should I do next, and why\?/);
  assert.match(source, /'\/api\/workspace\/chat'/);
  assert.match(source, /setChatScope\('workspace'\)/);
  assert.match(source, /className="operator-chat-scope"/);
  assert.match(source, /What needs my attention\?/);
  assert.match(source, /operator-chat-focus-runs/);
});


test('Studio config exposes independent Ask Neal provider/model/effort controls', () => {
  assert.match(source, /function ChatConfigCard\(/);
  assert.match(source, /<strong>Ask Neal<\/strong>/);
  assert.match(source, /<option value="">inherit reviewer<\/option>/);
  assert.match(source, /changes\['studio\.chat\.provider'\]/);
  assert.match(source, /changes\['studio\.chat\.model'\]/);
  assert.match(source, /changes\['studio\.chat\.effort'\]/);
  assert.match(source, /config\.chat\?\.inheritReviewer/);
  assert.match(source, /config\.roleOptions\.chat/);
});


test('Studio exposes workspace Ask Neal from the sidebar', () => {
  assert.match(source, /className="sidebar-ask-neal-button"/);
  assert.match(source, /onAskNeal=\{openWorkspaceChat\}/);
  assert.match(source, /onFocusRun=\{focusChatRun\}/);
});


test('Studio centers new task creation on Ask Neal while preserving the direct form fallback', () => {
  assert.match(source, />\+ New Task</);
  assert.match(source, /onClick=\{onNewTask\}/);
  assert.match(source, /Direct issue form/);
  assert.match(source, /const openNewTaskChat = useCallback/);
  assert.match(source, /I want to start a new task\. Help me define it\./);
  assert.match(source, /operator-chat-task-proposal/);
  assert.match(source, /message\.id === actionableMessageId/);
  assert.match(source, /onTaskProposalCreate\(message\.taskProposal\)/);
  assert.match(source, /onTaskProposalEdit\(message\.taskProposal\)/);
  assert.match(source, /const createTaskProposal = useCallback/);
  assert.match(source, /'\/api\/new-run\/plan'/);
  assert.match(source, /preferredExecutionMode: mode/);
});

test('Workspace Ask Neal remains available before any issue or run exists', () => {
  assert.match(source, /chatScope === 'workspace' \|\| selectedRunId/);
  assert.match(source, /onAskNeal=\{openWorkspaceChat\}/);
  assert.match(source, /onNewTask=\{openNewTaskChat\}/);
  assert.match(source, /No issues yet\. Start with/);
});


test('Studio uses Ask Neal as the visual home without replacing classic run controls', () => {
  assert.match(source, /const \[operatorHome, setOperatorHome\] = useState\(true\)/);
  assert.match(source, /className=\{operatorHome \? 'main ask-neal-home-main' : 'main'\}/);
  assert.match(source, /embedded/);
  assert.match(source, /Back to Studio/);
  assert.match(source, /setOperatorHome\(false\)/);
  assert.match(source, /const selectIssue = useCallback/);
  assert.match(source, /<ReadyIssueDetail/);
  assert.match(source, /<UnprocessedIssueDetail/);
  assert.match(source, /<ActionPanel/);
  assert.match(source, />Run Shadow</);
  assert.match(source, />\s*Run Normal\s*</);
  assert.match(source, /Plan issue/);
  assert.match(source, /'\/api\/issues\/plan'/);
  assert.match(source, /'\/api\/issues\/execute'/);
  assert.match(source, /'\/api\/runs\/' \+ encodeURIComponent\(selectedRunId\) \+ '\/actions\/' \+ action/);
});

test('Ask Neal is visually primary while direct issue creation remains available', () => {
  assert.match(source, /className="sidebar-ask-neal-button primary"/);
  assert.match(source, /workspace command center/);
  assert.match(source, />\+ New Task</);
  assert.match(source, />\s*Direct issue\s*</);
});
