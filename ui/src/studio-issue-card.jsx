import React from 'react';

import { laneLabel, studioIssueVisualState } from './studio-model.js';

export function StatusPill({ lane }) {
  return (
    <React.Fragment>
      <span className={'pill ' + lane}>{laneLabel(lane)}</span>
    </React.Fragment>
  );
}

export function StudioIssueCard({
  issue,
  index,
  selectedIssuePath,
  onSelect,
}) {
  const run = issue.currentRun;
  const active = issue.planDoc === selectedIssuePath;
  const visual = studioIssueVisualState({ ...issue, active }, index);
  const { lane, latest, className } = visual;

  return (
    <button
      type="button"
      className={className}
      onClick={() => onSelect(issue)}
      data-issue-path={issue.displayPath}
      data-lane={lane}
      data-latest={latest ? 'true' : 'false'}
      data-passive={visual.passive ? 'true' : 'false'}
    >
      <div className="run-head">
        <div className="run-title-wrap">
          {latest ? <span className="latest-badge">Latest</span> : null}
          <div className="run-title">{issue.title}</div>
        </div>
        <StatusPill lane={lane} />
      </div>
      <div className="run-meta-line">
        <span>{run
          ? issue.runs.length + ' ' + (issue.runs.length === 1 ? 'attempt' : 'attempts')
          : (issue.readyWithoutRun ? 'existing plan' : 'not processed')}</span>
        <span>{run
          ? (run.topLevelMode === 'plan' && run.status === 'done'
              ? 'ready to execute'
              : 'step: ' + run.publicPhase)
          : (issue.readyWithoutRun ? 'ready to execute' : issue.displayPath)}</span>
      </div>
    </button>
  );
}
