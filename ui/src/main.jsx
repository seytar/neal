import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

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

function StatusPill({ lane }) {
  return <span className={'pill ' + lane}>{laneLabel(lane)}</span>;
}

function RunList({ runs, selectedRunId, onSelect }) {
  return (
    <aside className="sidebar">
      <div className="brand">Neal Control Center</div>
      <div className="subtitle">State machine visual controller</div>

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
            <div className="run-title">{basename(run.planDoc)}</div>
            <div className="run-row">
              <StatusPill lane={run.uiLane} />
              <span className="muted">scope {run.currentScopeNumber}</span>
            </div>
            <div className="run-phase">{run.publicPhase}</div>
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

  return (
    <section className="card">
      <h2>Run</h2>
      <dl className="facts">
        <dt>Status</dt><dd>{status.publicStatus}</dd>
        <dt>Step</dt><dd>{status.publicPhase}</dd>
        <dt>Scope</dt><dd>{status.currentScopeNumber}</dd>
        <dt>Health</dt><dd>{status.health?.classification} · {status.health?.reason}</dd>
        <dt>Findings</dt>
        <dd>
          {status.findings?.openBlocking} blocking, {status.findings?.openNonBlocking} non-blocking
        </dd>
      </dl>

      <h2 className="section-heading">Models</h2>
      <div className="model-list">
        <div><span>Planner</span><strong>{modelLabel(config.planner)}</strong></div>
        <div><span>Coder</span><strong>{modelLabel(config.coder)}</strong></div>
        <div><span>Reviewer</span><strong>{modelLabel(config.reviewer)}</strong></div>
      </div>

      <h2 className="section-heading">Next action</h2>
      <p className="body-copy">{status.nextAction}</p>
    </section>
  );
}

const BASE_TABS = ['progress', 'plan', 'review', 'recovery', 'narrative', 'changes', 'usage'];

function ArtifactPanel({ detail, selectedTab, onSelectTab, artifact, artifactLoading }) {
  const tabs = detail.status.manualGate
    ? ['manual-gate', ...BASE_TABS]
    : BASE_TABS;

  return (
    <>
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
      <section className="card artifact-card">
        <pre>{artifactLoading ? 'Loading...' : artifact}</pre>
      </section>
    </>
  );
}

function App() {
  const [runs, setRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [selectedTab, setSelectedTab] = useState('progress');
  const [artifact, setArtifact] = useState('');
  const [artifactLoading, setArtifactLoading] = useState(false);
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
        setArtifact(JSON.stringify(data, null, 2));
      } else {
        const data = await api(
          '/api/runs/' + encodeURIComponent(selectedRunId) +
          '/artifacts/' + encodeURIComponent(tab),
        );
        setArtifact(data.content || '(empty)');
      }
    } catch (nextError) {
      setArtifact(nextError.message);
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
              <div>
                <h1>{basename(detail.status.planDoc)}</h1>
                <div className="subtitle">{detail.status.runId}</div>
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
