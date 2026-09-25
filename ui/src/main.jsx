import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import './styles.css';

const WRITE_TOKEN = window.__NEAL_UI_TOKEN__ || '';
const POLL_MS = 2500;

async function api(path, options = {}) {
  const headers = {
    Accept: 'application/json',
    ...(options.headers || {}),
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if ((options.method || 'GET') !== 'GET') {
    headers['X-Neal-UI-Token'] = WRITE_TOKEN;
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Request failed with HTTP ' + response.status);
  }
  return data;
}

function basename(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  return parts.at(-1) || String(path || 'Unknown plan');
}

function laneLabel(lane) {
  return {
    running: 'Running',
    needs_you: 'Needs you',
    private_validation: 'Validation',
    failed: 'Failed',
    done: 'Done',
  }[lane] || lane;
}

function modelLabel(config) {
  if (!config) {
    return 'n/a';
  }
  const model = config.model || 'default';
  return config.provider + ' / ' + model + (config.effort ? ' / ' + config.effort : '');
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function formatCost(value) {
  return typeof value === 'number' ? '$' + value.toFixed(4) : 'n/a';
}

function InfoTip({ text }) {
  return (
    <span className="info-tip" title={text} aria-label={text}>
      i
    </span>
  );
}

function CopyPathButton({ path }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button type="button" className="path-copy" onClick={copy}>
      {copied ? 'copied' : 'copy'}
    </button>
  );
}

function SourceStrip({ sources }) {
  return (
    <div className="source-strip">
      {sources.map((source) => (
        <div className="source-row" key={source.label + source.path}>
          <span className="source-label">
            {source.label}
            <InfoTip text={source.info} />
          </span>
          <code title={source.path}>{source.path}</code>
          <CopyPathButton path={source.path} />
        </div>
      ))}
    </div>
  );
}

function StatusPill({ lane }) {
  return <span className={'pill ' + lane}>{laneLabel(lane)}</span>;
}

function RunList({ runs, selectedRunId, onSelect }) {
  return (
    <aside className="sidebar">
      <div className="brand-row">
        <div className="brand">neal</div>
        <span className="brand-tag">control</span>
      </div>

      <div className="run-list">
        {runs.length === 0 ? (
          <div className="muted">No Neal runs found.</div>
        ) : runs.map((run) => (
          <button
            type="button"
            className={'run-item ' + (run.runId === selectedRunId ? 'active' : '')}
            key={run.runId}
            onClick={() => onSelect(run.runId)}
          >
            <div className="run-head">
              <div className="run-title">{basename(run.planDoc)}</div>
              <StatusPill lane={run.uiLane} />
            </div>
            <div className="run-meta-line">
              <span>S{run.currentScopeNumber}</span>
              <span>{run.publicPhase}</span>
            </div>
          </button>
        ))}
      </div>
    </aside>
  );
}

function ActionButton({ children, onClick, kind = 'default', disabled = false }) {
  return (
    <button
      type="button"
      className={'button ' + kind}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function ActionPanel({
  detail,
  guidance,
  setGuidance,
  feedback,
  setFeedback,
  validationNote,
  setValidationNote,
  onAction,
  onArtifactTab,
}) {
  const status = detail.status;
  const runningAction = detail.action?.status === 'running';

  if (runningAction) {
    return (
      <section className="card attention">
        <h2>Neal is working</h2>
        <p className="body-copy">
          {detail.action.label} is running. This screen refreshes automatically.
        </p>
        <div className="activity">
          <span className="pulse" />
          Writer action in progress
        </div>
      </section>
    );
  }

  if (status.phase === 'awaiting_private_validation') {
    return (
      <section className="card validation-card">
        <h2>Private validation required</h2>
        <p className="body-copy">
          Static implementation and review are complete. Apply or map the changes
          to the private project and run the real build, tests and runtime checks.
        </p>

        <label className="field-label" htmlFor="validation-note">Pass note</label>
        <input
          id="validation-note"
          className="text-input"
          value={validationNote}
          onChange={(event) => setValidationNote(event.target.value)}
          placeholder="private build and tests passed"
        />

        <div className="actions">
          <ActionButton
            kind="success"
            disabled={runningAction}
            onClick={() => onAction('shadow-accept', {
              note: validationNote.trim() || 'private validation passed via Neal UI',
            })}
          >
            Validation passed
          </ActionButton>
        </div>

        <div className="divider" />

        <label className="field-label" htmlFor="feedback">
          Validation failed? Paste sanitized feedback only
        </label>
        <textarea
          id="feedback"
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
          placeholder="Sanitized private validation failure..."
        />
        <div className="actions">
          <ActionButton
            kind="danger"
            disabled={!feedback.trim() || runningAction}
            onClick={() => onAction('shadow-feedback', { feedback: feedback.trim() })}
          >
            Send failure back to Neal
          </ActionButton>
        </div>
      </section>
    );
  }

  if (status.manualGate) {
    return (
      <section className="card attention">
        <div className="eyebrow">Manual gate</div>
        <h2>{status.manualGate.title}</h2>
        <p className="body-copy">{status.manualGate.reason}</p>

        {status.manualGate.lastFailure ? (
          <div className="error-box">
            Last check failed: {status.manualGate.lastFailure.checkName}
          </div>
        ) : null}

        <div className="actions">
          <ActionButton
            kind="primary"
            disabled={runningAction}
            onClick={() => onAction('resume')}
          >
            Check again & continue
          </ActionButton>
          <ActionButton onClick={() => onArtifactTab('manual-gate')}>
            View instructions
          </ActionButton>
        </div>
      </section>
    );
  }

  if (status.waitingForOperatorGuidance) {
    const blocked = status.blockedGuidance;
    return (
      <section className="card attention">
        <div className="eyebrow">Decision required</div>
        <h2>Neal needs your input</h2>
        <p className="body-copy">
          {blocked?.summary || status.resumeDecision?.blocker || 'Operator guidance is required.'}
        </p>

        {blocked?.reason ? <div className="notice">{blocked.reason}</div> : null}

        {detail.guidanceOptions?.length ? (
          <div className="option-list">
            {detail.guidanceOptions.map((option, index) => (
              <div className="guidance-option" key={option.label + index}>
                <div className="option-title">{option.label}</div>
                <div className="option-description">{option.description}</div>
                <ActionButton
                  onClick={() => setGuidance(option.message || option.description)}
                >
                  Use this option
                </ActionButton>
              </div>
            ))}
          </div>
        ) : null}

        <label className="field-label" htmlFor="guidance">Your decision</label>
        <textarea
          id="guidance"
          value={guidance}
          onChange={(event) => setGuidance(event.target.value)}
          placeholder="Tell Neal what decision to apply..."
        />
        <div className="actions">
          <ActionButton
            kind="primary"
            disabled={!guidance.trim() || runningAction}
            onClick={() => onAction('guidance', { message: guidance.trim() })}
          >
            Send & continue
          </ActionButton>
        </div>
      </section>
    );
  }

  if (status.pendingOperatorGuidance) {
    return (
      <section className="card attention">
        <h2>Guidance recorded</h2>
        <p className="body-copy">
          Neal has operator guidance ready to process.
        </p>
        <ActionButton kind="primary" onClick={() => onAction('resume')}>
          Continue
        </ActionButton>
      </section>
    );
  }

  if (status.resumeDecision?.kind === 'continue') {
    return (
      <section className="card">
        <h2>Run can continue</h2>
        <p className="body-copy">{status.resumeDecision.reason}</p>
        <ActionButton kind="primary" onClick={() => onAction('resume')}>
          Resume
        </ActionButton>
      </section>
    );
  }

  if (status.status === 'done') {
    return (
      <section className="card success-card">
        <h2>Done</h2>
        <p className="body-copy">No operator action is required.</p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>Current state</h2>
      <p className="body-copy">{status.nextAction}</p>
    </section>
  );
}

function RunFacts({ detail }) {
  const status = detail.status;
  const config = status.build?.agentConfig || {};
  const statePath = status.artifacts.runStatePath;
  const eventsPath = status.artifacts.eventsPath;

  return (
    <section className="card run-facts">
      <div className="fact-strip">
        <div>
          <span>Status <InfoTip text={'Persisted/public lifecycle derived primarily from ' + statePath} /></span>
          <strong>{status.publicStatus}</strong>
        </div>
        <div>
          <span>Step <InfoTip text={'Current orchestration phase from ' + statePath} /></span>
          <strong>{status.publicPhase}</strong>
        </div>
        <div>
          <span>Scope <InfoTip text={'Current scope number from ' + statePath} /></span>
          <strong>{status.currentScopeNumber}</strong>
        </div>
        <div>
          <span>Findings <InfoTip text={'Reviewer finding state from ' + statePath} /></span>
          <strong>{status.findings?.openBlocking} / {status.findings?.openNonBlocking}</strong>
        </div>
      </div>

      <div className="model-compact">
        <div><span>P</span><strong title={modelLabel(config.planner)}>{modelLabel(config.planner)}</strong></div>
        <div><span>C</span><strong title={modelLabel(config.coder)}>{modelLabel(config.coder)}</strong></div>
        <div><span>R</span><strong title={modelLabel(config.reviewer)}>{modelLabel(config.reviewer)}</strong></div>
      </div>

      <div className="next-compact">
        <span>
          Next
          <InfoTip text={'Derived from run state, resume decision, locks and recent events. Main files: ' + statePath + ' and ' + eventsPath} />
        </span>
        <p>{status.nextAction}</p>
      </div>

      <SourceStrip
        sources={[
          {
            label: 'Run state',
            path: statePath,
            info: 'Canonical persisted writer-run ledger. Status, phase, scope, findings and agent configuration ultimately resolve from this run.',
          },
          {
            label: 'Events',
            path: eventsPath,
            info: 'Append-only event stream used for recent activity, provider errors, health and some derived status information.',
          },
        ]}
      />
    </section>
  );
}

const BASE_TABS = ['progress', 'plan', 'review', 'recovery', 'narrative', 'changes', 'usage'];

function ViewToggle({ mode, onChange, rawLabel = 'Raw' }) {
  return (
    <div className="view-toggle">
      <button
        type="button"
        className={mode === 'preview' ? 'active' : ''}
        onClick={() => onChange('preview')}
      >
        Preview
      </button>
      <button
        type="button"
        className={mode === 'raw' ? 'active' : ''}
        onClick={() => onChange('raw')}
      >
        {rawLabel}
      </button>
    </div>
  );
}

function Metric({ label, value, info }) {
  return (
    <div className="metric">
      <span>{label} <InfoTip text={info} /></span>
      <strong>{value}</strong>
    </div>
  );
}

function MarkdownPreview({ content }) {
  return (
    <div className="markdown-preview">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content || '(empty)'}</ReactMarkdown>
    </div>
  );
}

function ChangesPreview({ data }) {
  const currentFiles = [...new Set([
    ...(data.currentScope?.files || []),
    ...(data.worktree?.files || []),
  ])].sort();
  return (
    <div className="structured-preview">
      <div className="metric-grid">
        <Metric
          label="Changed"
          value={data.changed === null ? 'unknown' : data.changed ? 'yes' : 'no'}
          info="Combined committed scope changes plus filtered uncommitted worktree changes."
        />
        <Metric
          label="Scope commits"
          value={formatNumber(data.currentScope?.commits?.length)}
          info="Commits between the recorded scope base and current HEAD."
        />
        <Metric
          label="Scope files"
          value={formatNumber(data.currentScope?.files?.length)}
          info="Files changed in the committed scope range."
        />
        <Metric
          label="Worktree"
          value={data.worktree?.changed ? formatNumber(data.worktree.files.length) + ' files' : 'clean'}
          info="Live uncommitted worktree after Neal-owned and admitted dirty paths are filtered."
        />
        <Metric
          label="Run total"
          value={formatNumber(data.runTotal?.commits?.length) + ' commits'}
          info="Full run range from the initial recorded base commit to current HEAD."
        />
        <Metric
          label="Scope"
          value={data.scopeLabel || 'n/a'}
          info="Current Neal scope label from the persisted run state."
        />
      </div>

      <div className="structured-section">
        <div className="section-title">Changed files <span>{currentFiles.length}</span></div>
        {currentFiles.length ? (
          <div className="file-chips">
            {currentFiles.map((file) => <code key={file}>{file}</code>)}
          </div>
        ) : <div className="empty-inline">No changed files in the current view.</div>}
      </div>

      {data.worktree?.status?.length ? (
        <div className="structured-section">
          <div className="section-title">Worktree status</div>
          <pre className="mini-pre">{data.worktree.status.join('\n')}</pre>
        </div>
      ) : null}
    </div>
  );
}

function UsagePreview({ data }) {
  const providers = data.metrics?.providers || [];
  const totalTokens = providers.reduce(
    (sum, provider) => sum + Number(provider.usage?.totalTokens || 0),
    0,
  );
  return (
    <div className="structured-preview">
      <div className="metric-grid">
        <Metric
          label="Provider turns"
          value={formatNumber(data.metrics?.providerTurns)}
          info="Counted provider turns observed in the run event stream."
        />
        <Metric
          label="Total tokens"
          value={formatNumber(totalTokens)}
          info="Sum of provider-bucket totalTokens. Provider token semantics can differ."
        />
        <Metric
          label="Cost telemetry"
          value={formatCost(data.metrics?.totalCostUsd)}
          info="Telemetry only. May be provider-reported or rate-estimated and is not authoritative account billing."
        />
        <Metric
          label="Cost coverage"
          value={data.metrics?.costCoverage || 'none'}
          info="Whether every usage-bearing provider bucket had cost telemetry."
        />
        <Metric
          label="Commands"
          value={formatNumber(data.metrics?.commandCount)}
          info="Command events observed during the run. Shadow coder turns normally do not execute shell commands."
        />
        <Metric
          label="File changes"
          value={formatNumber(data.metrics?.fileChangeEventCount)}
          info="File-change events recorded in the run event stream."
        />
      </div>

      <div className="provider-table">
        <div className="provider-row provider-head">
          <span>Role / provider</span><span>Turns</span><span>Input</span><span>Output</span><span>Total</span><span>Cost</span>
        </div>
        {providers.map((provider, index) => (
          <div className="provider-row" key={provider.provider + provider.role + index}>
            <span>
              <strong>{provider.label || provider.role}</strong>
              <small>{provider.provider}</small>
            </span>
            <span>{formatNumber(provider.turns)}</span>
            <span>{formatNumber(provider.usage?.inputTokens)}</span>
            <span>{formatNumber(provider.usage?.outputTokens)}</span>
            <span>{formatNumber(provider.usage?.totalTokens)}</span>
            <span>{formatCost(provider.costUsd)}</span>
          </div>
        ))}
      </div>

      {data.events.malformedLines > 0 ? (
        <div className="notice">Ignored {data.events.malformedLines} malformed events.ndjson line(s).</div>
      ) : null}
    </div>
  );
}

function ArtifactPanel({
  detail,
  selectedTab,
  onSelectTab,
  artifact,
  artifactLoading,
  viewMode,
  onViewModeChange,
}) {
  const tabs = detail.status.manualGate
    ? ['manual-gate', ...BASE_TABS]
    : BASE_TABS;
  const isStructured = selectedTab === 'changes' || selectedTab === 'usage';

  let sources = [];
  if (artifact?.kind === 'markdown') {
    sources = [{
      label: 'File',
      path: artifact.path,
      info: 'Physical Markdown artifact read directly from this file.',
    }];
  } else if (artifact?.kind === 'changes') {
    sources = [
      {
        label: 'Run state',
        path: detail.status.artifacts.runStatePath,
        info: 'Scope base commit, initial base commit and allowed dirty paths are read from RUN_STATE.json.',
      },
      {
        label: 'Git repo',
        path: artifact.data.cwd,
        info: 'Changes is live-derived from repository Git history and worktree. There is no standalone changes.json file.',
      },
    ];
  } else if (artifact?.kind === 'usage') {
    sources = [
      {
        label: 'Events',
        path: artifact.data.events.path,
        info: 'Provider turns, token usage, costs, commands and timing metrics are parsed from events.ndjson.',
      },
      {
        label: 'Run state',
        path: detail.status.artifacts.runStatePath,
        info: 'Agent configuration and run identity used to interpret provider-role usage come from RUN_STATE.json.',
      },
    ];
  }

  return (
    <>
      <div className="artifact-toolbar">
        <div className="tabs">
          {tabs.map((tab) => (
            <button
              type="button"
              className={'tab ' + (selectedTab === tab ? 'active' : '')}
              key={tab}
              onClick={() => onSelectTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        <ViewToggle
          mode={viewMode}
          onChange={onViewModeChange}
          rawLabel={isStructured ? 'Raw JSON' : 'Raw'}
        />
      </div>

      <section className="card artifact-card">
        {artifactLoading ? (
          <div className="empty-inline">Loading...</div>
        ) : artifact?.kind === 'error' ? (
          <div className="error-box">{artifact.content}</div>
        ) : viewMode === 'raw' ? (
          <>
            {sources.length ? <SourceStrip sources={sources} /> : null}
            <pre>{artifact?.kind === 'markdown'
              ? artifact.content
              : JSON.stringify(artifact?.data ?? {}, null, 2)}</pre>
          </>
        ) : artifact?.kind === 'markdown' ? (
          <>
            {sources.length ? <SourceStrip sources={sources} /> : null}
            <MarkdownPreview content={artifact.content} />
          </>
        ) : artifact?.kind === 'changes' ? (
          <>
            {sources.length ? <SourceStrip sources={sources} /> : null}
            <ChangesPreview data={artifact.data} />
          </>
        ) : artifact?.kind === 'usage' ? (
          <>
            {sources.length ? <SourceStrip sources={sources} /> : null}
            <UsagePreview data={artifact.data} />
          </>
        ) : null}
      </section>
    </>
  );
}

function App() {
  const [runs, setRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [selectedTab, setSelectedTab] = useState('progress');
  const [artifact, setArtifact] = useState(null);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [artifactViewMode, setArtifactViewMode] = useState('preview');
  const [guidance, setGuidance] = useState('');
  const [feedback, setFeedback] = useState('');
  const [validationNote, setValidationNote] = useState('');
  const [error, setError] = useState(null);

  const selectedExists = useMemo(
    () => runs.some((run) => run.runId === selectedRunId),
    [runs, selectedRunId],
  );

  const refreshRuns = useCallback(async () => {
    try {
      const data = await api('/api/runs');
      setRuns(data.runs || []);
      setError(null);
    } catch (nextError) {
      setError(nextError.message);
    }
  }, []);

  const refreshDetail = useCallback(async () => {
    if (!selectedRunId) {
      return;
    }
    try {
      const data = await api('/api/runs/' + encodeURIComponent(selectedRunId));
      setDetail(data);
      setError(null);
    } catch (nextError) {
      setError(nextError.message);
    }
  }, [selectedRunId]);

  const loadArtifact = useCallback(async (tab = selectedTab) => {
    if (!selectedRunId) {
      return;
    }
    setArtifactLoading(true);
    try {
      if (tab === 'changes' || tab === 'usage') {
        const data = await api(
          '/api/runs/' + encodeURIComponent(selectedRunId) + '/' + tab,
        );
        setArtifact({ kind: tab, data });
      } else {
        const data = await api(
          '/api/runs/' + encodeURIComponent(selectedRunId) +
          '/artifacts/' + encodeURIComponent(tab),
        );
        setArtifact({
          kind: 'markdown',
          path: data.path,
          content: data.content || '(empty)',
        });
      }
    } catch (nextError) {
      setArtifact({ kind: 'error', content: nextError.message });
    } finally {
      setArtifactLoading(false);
    }
  }, [selectedRunId, selectedTab]);

  useEffect(() => {
    void refreshRuns();
    const timer = setInterval(() => void refreshRuns(), POLL_MS);
    return () => clearInterval(timer);
  }, [refreshRuns]);

  useEffect(() => {
    if (!selectedRunId && runs[0]) {
      setSelectedRunId(runs[0].runId);
      return;
    }
    if (selectedRunId && !selectedExists && runs[0]) {
      setSelectedRunId(runs[0].runId);
    }
  }, [runs, selectedRunId, selectedExists]);

  useEffect(() => {
    if (!selectedRunId) {
      return undefined;
    }
    void refreshDetail();
    const timer = setInterval(() => void refreshDetail(), POLL_MS);
    return () => clearInterval(timer);
  }, [selectedRunId, refreshDetail]);

  useEffect(() => {
    if (selectedRunId) {
      void loadArtifact(selectedTab);
    }
  }, [selectedRunId, selectedTab, loadArtifact]);

  const runAction = useCallback(async (action, body = {}) => {
    if (!selectedRunId) {
      return;
    }
    if (
      action === 'shadow-feedback' &&
      !window.confirm('Send this sanitized feedback back to the Shadow run?')
    ) {
      return;
    }

    try {
      await api(
        '/api/runs/' + encodeURIComponent(selectedRunId) + '/actions/' + action,
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      );
      if (action === 'guidance') {
        setGuidance('');
      }
      if (action === 'shadow-feedback') {
        setFeedback('');
      }
      await refreshDetail();
      await refreshRuns();
    } catch (nextError) {
      setError(nextError.message);
    }
  }, [selectedRunId, refreshDetail, refreshRuns]);

  const selectTab = useCallback((tab) => {
    setSelectedTab(tab);
    setArtifactViewMode('preview');
  }, []);

  if (!selectedRunId && runs.length === 0 && !error) {
    return (
      <div className="layout">
        <RunList runs={runs} selectedRunId={selectedRunId} onSelect={setSelectedRunId} />
        <main className="main"><div className="empty">No Neal runs found in this project.</div></main>
      </div>
    );
  }

  return (
    <div className="layout">
      <RunList
        runs={runs}
        selectedRunId={selectedRunId}
        onSelect={setSelectedRunId}
      />

      <main className="main">
        {error ? <div className="global-error">{error}</div> : null}

        {!detail ? (
          <div className="empty">Loading run...</div>
        ) : (
          <>
            <header className="topbar">
              <div className="title-line">
                <h1>{basename(detail.status.planDoc)}</h1>
                <span className="run-id">{detail.status.runId}</span>
              </div>
              <StatusPill lane={detail.uiLane} />
            </header>

            {detail.action?.status === 'failed' ? (
              <div className="global-error">
                Last UI action failed: {detail.action.error}
              </div>
            ) : null}

            <div className="detail-grid">
              <ActionPanel
                detail={detail}
                guidance={guidance}
                setGuidance={setGuidance}
                feedback={feedback}
                setFeedback={setFeedback}
                validationNote={validationNote}
                setValidationNote={setValidationNote}
                onAction={runAction}
                onArtifactTab={selectTab}
              />
              <RunFacts detail={detail} />
            </div>

            <ArtifactPanel
              detail={detail}
              selectedTab={selectedTab}
              onSelectTab={selectTab}
              artifact={artifact}
              artifactLoading={artifactLoading}
              viewMode={artifactViewMode}
              onViewModeChange={setArtifactViewMode}
            />
          </>
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
