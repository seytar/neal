export const DEFAULT_SIDEBAR_WIDTH = 340;
export const MIN_SIDEBAR_WIDTH = 280;
export const MAX_SIDEBAR_WIDTH = 560;

export function clampSidebarWidth(value) {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, value));
}

export function studioSidebarStorageKey(workspaceRoot) {
  return 'neal.studio.sidebarWidth:' + workspaceRoot;
}

export function issueLane(run) {
  if (run?.topLevelMode === 'plan') {
    if (run.status === 'done') {
      return 'ready';
    }
    if (run.uiLane === 'running') {
      return 'planning';
    }
  }
  return run?.uiLane || 'running';
}

export function laneLabel(lane) {
  return {
    planning: 'Planning',
    ready: 'Ready',
    running: 'Running',
    needs_you: 'Needs you',
    private_validation: 'Validation',
    unprocessed: 'Unprocessed',
    failed: 'Failed',
    done: 'Done',
  }[lane] || lane;
}

export function studioIssueVisualState(issue, index) {
  const run = issue.currentRun;
  const lane = run ? issueLane(run) : (issue.readyWithoutRun ? 'ready' : 'unprocessed');
  const latest = index === 0;
  const attention = ['planning', 'running', 'needs_you', 'private_validation', 'failed'].includes(lane);
  const passive = !latest && Boolean(issue.processed) && !attention;

  return {
    lane,
    latest,
    attention,
    passive,
    className: [
      'run-item',
      'status-' + lane,
      issue.active ? 'active' : '',
      latest ? 'latest' : '',
      passive ? 'passive' : '',
    ].filter(Boolean).join(' '),
  };
}
