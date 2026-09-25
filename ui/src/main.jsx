import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import './styles.css';

const WRITE_TOKEN = window.__NEAL_UI_TOKEN__ || '';
const POLL_MS = 2500;
const ACTIVITY_POLL_MS = 1000;
const NEW_RUN_POLL_MS = 500;

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

function formatElapsed(elapsedMs) {
  const totalSeconds = Math.max(0, Math.round(Number(elapsedMs || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
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

function CommandLine({ command, label = 'Command' }) {
  if (!command) {
    return null;
  }
  return (
    <div className="command-line">
      <span>{label}</span>
      <code title={command}>{command}</code>
      <CopyPathButton path={command} />
    </div>
  );
}

function CommandsPanel({ catalog, open, onClose }) {
  if (!open) {
    return null;
  }

  return (
    <div className="commands-backdrop" onClick={onClose}>
      <aside className="commands-panel" onClick={(event) => event.stopPropagation()}>
        <div className="commands-head">
          <div>
            <strong>Neal commands</strong>
            <span>v{catalog?.version || '?'}</span>
          </div>
          <button type="button" className="panel-close" onClick={onClose}>×</button>
        </div>

        <div className="command-catalog">
          {(catalog?.commands || []).map((command) => (
            <div className="catalog-command" key={command}>
              <code>{command}</code>
              <CopyPathButton path={command} />
            </div>
          ))}
        </div>

        <details className="help-details">
          <summary>Full neal help</summary>
          <pre>{catalog?.helpText || 'Loading...'}</pre>
        </details>
      </aside>
    </div>
  );
}


function configSourceLabel(source) {
  if (!source) return 'unknown';
  if (source.kind === 'repo') return 'repo';
  if (source.kind === 'user') return 'user';
  if (source.kind === 'environment') return 'env';
  if (source.kind === 'inherited') return 'inherited';
  return 'default';
}

function ConfigSourceBadge({ source }) {
  if (!source) return null;
  const detail = source.note || (source.path ? source.path + ' · ' + source.key : source.key);
  return (
    <span className="config-source-wrap">
      <span className={'config-source ' + source.kind} title={detail}>
        {configSourceLabel(source)}
      </span>
      <InfoTip text={detail} />
    </span>
  );
}

function configDraftFromSnapshot(config) {
  if (!config) return null;
  return {
    planner: {
      provider: config.roles.planner.provider || '',
      model: config.roles.planner.model || '',
      effort: config.roles.planner.effort || '',
    },
    coder: {
      provider: config.roles.coder.provider || '',
      model: config.roles.coder.model || '',
      effort: config.roles.coder.effort || '',
    },
    reviewer: {
      provider: config.roles.reviewer.provider || '',
      model: config.roles.reviewer.model || '',
      effort: config.roles.reviewer.effort || '',
    },
    reviewLevel: config.runtime.review_level.value || 'moderate',
    openaiCompatible: {
      baseUrl: config.openaiCompatible.baseUrl || '',
      apiKeyEnv: config.openaiCompatible.apiKeyEnv || '',
      defaultModel: config.openaiCompatible.defaultModel || '',
      structuredOutputMode: config.openaiCompatible.structuredOutputMode || '',
    },
  };
}

function configChanges(config, draft) {
  if (!config || !draft) return {};
  const changes = {};

  for (const role of ['planner', 'coder', 'reviewer']) {
    const current = config.roles[role];
    if (draft[role].provider !== (current.provider || '')) {
      changes['agent.' + role + '.provider'] = draft[role].provider || null;
    }
    if (draft[role].model !== (current.model || '')) {
      changes['agent.' + role + '.model'] = draft[role].model || null;
    }
    if (draft[role].effort !== (current.effort || '')) {
      changes['agent.' + role + '.effort'] = draft[role].effort || null;
    }
  }

  if (draft.reviewLevel !== config.runtime.review_level.value) {
    changes['neal.review_level'] = draft.reviewLevel;
  }

  const openai = config.openaiCompatible;
  if (draft.openaiCompatible.baseUrl !== (openai.baseUrl || '')) {
    changes['providers.openai_compatible.base_url'] = draft.openaiCompatible.baseUrl || null;
  }
  if (draft.openaiCompatible.apiKeyEnv !== (openai.apiKeyEnv || '')) {
    changes['providers.openai_compatible.api_key_env'] = draft.openaiCompatible.apiKeyEnv || null;
  }
  if (draft.openaiCompatible.defaultModel !== (openai.defaultModel || '')) {
    changes['providers.openai_compatible.default_model'] = draft.openaiCompatible.defaultModel || null;
  }
  if (draft.openaiCompatible.structuredOutputMode !== (openai.structuredOutputMode || '')) {
    changes['providers.openai_compatible.structured_output_mode'] =
      draft.openaiCompatible.structuredOutputMode || null;
  }

  return changes;
}

function ConfigField({ label, source, children, hint }) {
  return (
    <label className="config-field">
      <span className="config-field-head">
        <span>{label}</span>
        <ConfigSourceBadge source={source} />
      </span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function RoleConfigCard({ role, config, draft, setDraft }) {
  const roleConfig = config.roles[role];
  const provider = draft[role].provider;
  const effortOptions = config.providerEfforts[provider] || [];
  const roleOptions = config.roleOptions[role] || [];

  function setField(field, value) {
    setDraft((current) => ({
      ...current,
      [role]: { ...current[role], [field]: value },
    }));
  }

  return (
    <section className="config-role-card">
      <div className="config-role-head">
        <strong>{role}</strong>
        <span>{modelLabel(roleConfig)}</span>
      </div>

      <ConfigField label="Provider" source={roleConfig.sources.provider}>
        <select value={provider} onChange={(event) => setField('provider', event.target.value)}>
          {role === 'planner' ? <option value="">inherit coder</option> : null}
          {roleOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </ConfigField>

      <ConfigField
        label="Model"
        source={roleConfig.sources.model}
        hint="Blank means provider default."
      >
        <input
          className="text-input"
          value={draft[role].model}
          onChange={(event) => setField('model', event.target.value)}
          placeholder="provider default"
        />
      </ConfigField>

      <ConfigField
        label="Effort"
        source={roleConfig.sources.effort}
        hint={effortOptions.length ? 'Provider-supported reasoning depth.' : 'This provider has no configurable effort.'}
      >
        <select
          value={draft[role].effort}
          onChange={(event) => setField('effort', event.target.value)}
          disabled={effortOptions.length === 0}
        >
          <option value="">provider default</option>
          {effortOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </ConfigField>
    </section>
  );
}

function ConfigPanel({ open, onClose, config, loading, onReload }) {
  const [target, setTarget] = useState('user');
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(configDraftFromSnapshot(config));
    setSaveError(null);
    setSaved(false);
  }, [config]);

  if (!open) return null;

  const changes = configChanges(config, draft);
  const changeCount = Object.keys(changes).length;

  async function save() {
    if (!changeCount) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await api('/api/config', {
        method: 'POST',
        body: JSON.stringify({ target, changes }),
      });
      await onReload();
      setSaved(true);
    } catch (error) {
      setSaveError(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="commands-backdrop" onClick={onClose}>
      <aside className="config-panel" onClick={(event) => event.stopPropagation()}>
        <div className="commands-head">
          <div>
            <strong>Neal config</strong>
            <span>effective values + sources</span>
          </div>
          <button type="button" className="panel-close" onClick={onClose}>×</button>
        </div>

        {loading || !config || !draft ? (
          <div className="empty-inline">Loading config…</div>
        ) : (
          <>
            <SourceStrip
              sources={[
                {
                  label: config.sources.repo.exists ? 'Repo config' : 'Repo config · missing',
                  path: config.sources.repo.path,
                  info: 'Highest-precedence project config. Values here override the user config.',
                },
                {
                  label: config.sources.user.exists ? 'User config' : 'User config · missing',
                  path: config.sources.user.path,
                  info: 'User-level config written by neal setup. Repo neal.yml wins when both define the same key.',
                },
              ]}
            />

            <div className="config-precedence">
              precedence: repo <strong>›</strong> user <strong>›</strong> built-in defaults
            </div>

            <section className="config-section">
              <div className="config-section-title">Agents</div>
              <div className="config-role-grid">
                {['planner', 'coder', 'reviewer'].map((role) => (
                  <RoleConfigCard
                    key={role}
                    role={role}
                    config={config}
                    draft={draft}
                    setDraft={setDraft}
                  />
                ))}
              </div>
            </section>

            <section className="config-section">
              <div className="config-section-title">Review</div>
              <ConfigField label="Review level" source={config.runtime.review_level.source}>
                <select
                  value={draft.reviewLevel}
                  onChange={(event) => setDraft((current) => ({ ...current, reviewLevel: event.target.value }))}
                >
                  <option value="strict">strict</option>
                  <option value="moderate">moderate</option>
                  <option value="lenient">lenient</option>
                </select>
              </ConfigField>
            </section>

            <section className="config-section">
              <div className="config-section-head">
                <div className="config-section-title">OpenAI-compatible</div>
                <span className={'readiness ' + (config.openaiCompatible.apiKeyConfigured ? 'ok' : 'missing')}>
                  {config.openaiCompatible.apiKeyConfigured ? 'API key configured' : 'API key missing'}
                </span>
              </div>

              <div className="config-readiness-line">
                <span>Credential env</span>
                <code>{config.openaiCompatible.apiKeyEnv}</code>
                <ConfigSourceBadge source={config.openaiCompatible.credentialSource} />
              </div>
              <div className="config-secret-note">
                Secret values are never returned to the browser or written by this panel. Set <code>{config.openaiCompatible.apiKeyEnv}</code> in the Neal process environment or project <code>.env</code>.
              </div>

              <div className="config-two-col">
                <ConfigField label="Base URL" source={config.openaiCompatible.sources.baseUrl}>
                  <input
                    className="text-input"
                    value={draft.openaiCompatible.baseUrl}
                    onChange={(event) => setDraft((current) => ({
                      ...current,
                      openaiCompatible: { ...current.openaiCompatible, baseUrl: event.target.value },
                    }))}
                    placeholder="https://api.example.com/v1"
                  />
                </ConfigField>
                <ConfigField label="API key env" source={config.openaiCompatible.sources.apiKeyEnv}>
                  <input
                    className="text-input"
                    value={draft.openaiCompatible.apiKeyEnv}
                    onChange={(event) => setDraft((current) => ({
                      ...current,
                      openaiCompatible: { ...current.openaiCompatible, apiKeyEnv: event.target.value },
                    }))}
                  />
                </ConfigField>
                <ConfigField label="Default model" source={config.openaiCompatible.sources.defaultModel}>
                  <input
                    className="text-input"
                    value={draft.openaiCompatible.defaultModel}
                    onChange={(event) => setDraft((current) => ({
                      ...current,
                      openaiCompatible: { ...current.openaiCompatible, defaultModel: event.target.value },
                    }))}
                    placeholder="optional"
                  />
                </ConfigField>
                <ConfigField label="Structured output" source={config.openaiCompatible.sources.structuredOutputMode}>
                  <select
                    value={draft.openaiCompatible.structuredOutputMode}
                    onChange={(event) => setDraft((current) => ({
                      ...current,
                      openaiCompatible: { ...current.openaiCompatible, structuredOutputMode: event.target.value },
                    }))}
                  >
                    <option value="">adapter default</option>
                    <option value="json_schema">json_schema</option>
                    <option value="json_object">json_object</option>
                  </select>
                </ConfigField>
              </div>
            </section>

            <details className="config-advanced">
              <summary>Advanced Neal runtime</summary>
              <div className="runtime-grid">
                {Object.entries(config.runtime)
                  .filter(([key]) => key !== 'review_level')
                  .map(([key, item]) => (
                    <div className="runtime-row" key={key}>
                      <code>{key}</code>
                      <strong>{String(item.value)}</strong>
                      <ConfigSourceBadge source={item.source} />
                    </div>
                  ))}
              </div>
            </details>

            <div className="config-save-bar">
              <div className="config-target">
                <span>Save to</span>
                <div className="mode-buttons">
                  <button
                    type="button"
                    className={target === 'repo' ? 'active' : ''}
                    onClick={() => setTarget('repo')}
                  >
                    Repo
                  </button>
                  <button
                    type="button"
                    className={target === 'user' ? 'active' : ''}
                    onClick={() => setTarget('user')}
                  >
                    User
                  </button>
                </div>
              </div>

              <div className="config-save-actions">
                {saved ? <span className="save-ok">saved</span> : null}
                <span>{changeCount} change{changeCount === 1 ? '' : 's'}</span>
                <button
                  type="button"
                  className="button primary"
                  disabled={!changeCount || saving}
                  onClick={save}
                >
                  {saving ? 'Saving…' : 'Save config'}
                </button>
              </div>
            </div>

            {target === 'user' && Object.values(config.roles).some((role) =>
              Object.values(role.sources).some((source) => source.kind === 'repo')
            ) ? (
              <div className="notice">
                Some effective agent values come from repo <code>neal.yml</code>. Saving the same keys to User config will not override those repo values.
              </div>
            ) : null}

            {saveError ? <div className="error-box">{saveError}</div> : null}
          </>
        )}
      </aside>
    </div>
  );
}

function TerminalStatusLine({ line, loading }) {
  return (
    <div className="terminal-status-line" title={line || ''}>
      <span className="terminal-prompt">›</span>
      <code>{line || (loading ? '[neal] loading status…' : '[neal] status unavailable')}</code>
    </div>
  );
}

function LiveActivity({ activity, loading }) {
  const running = activity?.action?.status === 'running' || activity?.status === 'running';
  const events = activity?.events || [];
  const recent = events.slice(-8).reverse();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!running) {
      return undefined;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const sampledAt = Number(activity?.sampledAt || now);
  const baseElapsed = Number(activity?.phaseElapsedMs || 0);
  const elapsed = running ? baseElapsed + Math.max(0, now - sampledAt) : baseElapsed;

  return (
    <section className="live-strip">
      <TerminalStatusLine line={activity?.terminalFooterLine} loading={loading} />

      <div className="live-primary">
        <div className="live-state">
          {running || loading ? <span className="pulse" /> : <span className="live-dot" />}
          <div>
            <span>Current</span>
            <strong>{activity?.phase || (loading ? 'Loading…' : 'n/a')}</strong>
            <small>elapsed {formatElapsed(elapsed)}</small>
          </div>
        </div>

        <div className="live-item">
          <span>Last event</span>
          <strong>{activity?.lastMeaningfulEvent?.summary || recent[0]?.summary || 'No recent event'}</strong>
        </div>

        <div className="live-item next-live">
          <span>Next</span>
          <strong>{activity?.nextAction || 'Waiting for run state…'}</strong>
        </div>
      </div>

      {activity?.action?.command ? (
        <CommandLine command={activity.action.command} label={activity.action.status === 'running' ? 'Running' : 'Last command'} />
      ) : null}

      {recent.length ? (
        <details className="activity-events">
          <summary>Recent activity ({events.length})</summary>
          <div className="event-list">
            {recent.map((event, index) => (
              <div className="event-row" key={(event.ts || '') + event.type + index}>
                <time>{event.ts ? new Date(event.ts).toLocaleTimeString() : '--:--:--'}</time>
                <code>{event.type}</code>
                <span>{event.summary}</span>
              </div>
            ))}
          </div>
          <SourceStrip
            sources={[{
              label: 'Activity source',
              path: activity.path,
              info: 'Live activity is tailed directly from this run events.ndjson file.',
            }]}
          />
        </details>
      ) : null}
    </section>
  );
}

function NewRunModal({
  open,
  onClose,
  title,
  setTitle,
  description,
  setDescription,
  mode,
  setMode,
  planId,
  action,
  onStart,
}) {
  const busy = action?.status === 'running';
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!open || !busy) {
      return undefined;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open, busy]);

  if (!open) {
    return null;
  }

  const actionElapsed = busy && action?.startedAt
    ? Math.max(0, now - Date.parse(action.startedAt))
    : 0;
  const previewPath = '.neal/ui-plans/' + planId + '.md';
  const previewCommand = "neal plan '" + previewPath + "'";

  return (
    <div className="commands-backdrop" onClick={busy ? undefined : onClose}>
      <section className="new-run-modal" onClick={(event) => event.stopPropagation()}>
        <div className="commands-head">
          <div>
            <strong>New Run</strong>
            <span>plan first, then execute</span>
          </div>
          <button type="button" className="panel-close" onClick={onClose} disabled={busy}>×</button>
        </div>

        <label className="field-label" htmlFor="new-run-title">Title</label>
        <input
          id="new-run-title"
          className="text-input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add body camera locations to map"
          disabled={busy}
        />

        <label className="field-label" htmlFor="new-run-description">Task</label>
        <textarea
          id="new-run-description"
          className="new-run-task"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Describe what you want Neal to implement, constraints, expected behavior and anything it should preserve..."
          disabled={busy}
        />

        <div className="new-run-mode">
          <span>Execution after planning</span>
          <div className="mode-buttons">
            <button
              type="button"
              className={mode === 'shadow' ? 'active' : ''}
              onClick={() => setMode('shadow')}
              disabled={busy}
            >
              Shadow
            </button>
            <button
              type="button"
              className={mode === 'normal' ? 'active' : ''}
              onClick={() => setMode('normal')}
              disabled={busy}
            >
              Normal
            </button>
          </div>
        </div>

        <div className="new-run-note">
          Neal will create the seed Markdown under <code>.neal/ui-plans/</code>, then refine it in place.
        </div>

        {action?.command ? (
          <CommandLine
            command={action.command}
            label={action.status === 'running' ? 'Running' : 'Last command'}
          />
        ) : (
          <CommandLine command={previewCommand} label="Will run" />
        )}

        {busy ? (
          <div className="new-run-progress">
            <span className="pulse" />
            <div>
              <strong>Planning... · elapsed {formatElapsed(actionElapsed)}</strong>
              <span>Creating the run now. As soon as RUN_STATE.json exists, this modal closes and live monitoring takes over.</span>
            </div>
          </div>
        ) : null}

        {action?.status === 'failed' ? (
          <div className="error-box">{action.error}</div>
        ) : null}

        <div className="actions new-run-actions">
          <ActionButton
            kind="primary"
            disabled={!description.trim() || busy}
            onClick={onStart}
          >
            {busy ? 'Planning…' : 'Start planning'}
          </ActionButton>
          {!busy ? <ActionButton onClick={onClose}>Cancel</ActionButton> : null}
        </div>
      </section>
    </div>
  );
}

function StatusPill({ lane }) {
  return <span className={'pill ' + lane}>{laneLabel(lane)}</span>;
}

function RunList({ runs, selectedRunId, onSelect, onCommands, onConfig, onNewRun }) {
  return (
    <aside className="sidebar">
      <div className="brand-row">
        <div className="brand">neal</div>
        <span className="brand-tag">control</span>
        <div className="sidebar-mini-actions">
          <button type="button" className="sidebar-command-button" onClick={onConfig}>config</button>
          <button type="button" className="sidebar-command-button" onClick={onCommands}>commands</button>
        </div>
      </div>
      <button type="button" className="new-run-button" onClick={onNewRun}>+ New Run</button>

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
  preferredExecutionMode,
}) {
  const status = detail.status;
  const runningAction = detail.action?.status === 'running';
  const runId = status.runId;

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
        <CommandLine command={detail.action?.command} label="Running" />
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

        <CommandLine
          command={'neal shadow accept --run ' + runId + ' --note ' + JSON.stringify(validationNote.trim() || 'private validation passed via Neal UI')}
          label="Will run"
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
        <CommandLine
          command={'neal shadow feedback --run ' + runId + ' --file <temporary-sanitized-feedback-file>'}
          label="Will run"
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

        <CommandLine command={status.manualGate.resumeCommand} label="Will run" />
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
        <CommandLine
          command={guidance.trim()
            ? 'neal resume --run ' + runId + ' --message ' + JSON.stringify(guidance.trim())
            : 'neal resume --run ' + runId + ' --message "..."'}
          label="Will run"
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
        <CommandLine command={'neal resume --run ' + runId} label="Will run" />
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
        <CommandLine command={status.resumeDecision.resumeCommand || ('neal resume --run ' + runId)} label="Will run" />
        <ActionButton kind="primary" onClick={() => onAction('resume')}>
          Resume
        </ActionButton>
      </section>
    );
  }

  if (status.status === 'done' && status.topLevelMode === 'plan') {
    return (
      <section className="card success-card">
        <div className="eyebrow">Plan ready</div>
        <h2>Planning complete</h2>
        <p className="body-copy">
          The refined plan is ready for execution. Shadow is the safer default for the sanitized checkout workflow.
        </p>
        <CommandLine
          command={preferredExecutionMode === 'normal'
            ? detail.executionCommands?.normal
            : detail.executionCommands?.shadow}
          label={preferredExecutionMode === 'normal' ? 'Normal will run' : 'Shadow will run'}
        />
        <div className="actions">
          <ActionButton
            kind={preferredExecutionMode === 'normal' ? 'default' : 'primary'}
            onClick={() => onAction('execute-shadow')}
          >
            Execute Shadow
          </ActionButton>
          <ActionButton
            kind={preferredExecutionMode === 'normal' ? 'primary' : 'default'}
            onClick={() => onAction('execute-normal')}
          >
            Execute Normal
          </ActionButton>
        </div>
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
  const [commandCatalog, setCommandCatalog] = useState(null);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [configData, setConfigData] = useState(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [activity, setActivity] = useState(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [newRunOpen, setNewRunOpen] = useState(false);
  const [newRunTitle, setNewRunTitle] = useState('');
  const [newRunDescription, setNewRunDescription] = useState('');
  const [newRunMode, setNewRunMode] = useState('shadow');
  const [newRunPlanId, setNewRunPlanId] = useState('');
  const [newRunAction, setNewRunAction] = useState(null);

  const selectedExists = useMemo(
    () => runs.some((run) => run.runId === selectedRunId),
    [runs, selectedRunId],
  );

  const refreshConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      const data = await api('/api/config');
      setConfigData(data);
      setError(null);
      return data;
    } catch (nextError) {
      setError(nextError.message);
      return null;
    } finally {
      setConfigLoading(false);
    }
  }, []);

  const openConfig = useCallback(() => {
    setConfigOpen(true);
    void refreshConfig();
  }, [refreshConfig]);

  const refreshRuns = useCallback(async () => {
    try {
      const data = await api('/api/runs');
      const nextRuns = data.runs || [];
      setRuns(nextRuns);
      setError(null);
      return nextRuns;
    } catch (nextError) {
      setError(nextError.message);
      return [];
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
    void api('/api/commands')
      .then(setCommandCatalog)
      .catch((nextError) => setError(nextError.message));
  }, []);

  useEffect(() => {
    if (newRunAction?.status !== 'running') {
      return undefined;
    }

    let cancelled = false;
    const refreshNewRun = async () => {
      try {
        const data = await api('/api/new-run/status');
        if (cancelled || !data) {
          return;
        }
        setNewRunAction(data);
        if (data.resultRunId) {
          await refreshRuns();
          setSelectedRunId(data.resultRunId);
          setNewRunOpen(false);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError.message);
        }
      }
    };

    void refreshNewRun();
    const timer = setInterval(() => void refreshNewRun(), NEW_RUN_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [newRunAction?.status, refreshRuns]);

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
    if (!selectedRunId) {
      setActivity(null);
      return undefined;
    }

    let cancelled = false;
    const refreshActivity = async () => {
      setActivityLoading(true);
      try {
        const data = await api('/api/runs/' + encodeURIComponent(selectedRunId) + '/activity');
        if (!cancelled) {
          setActivity(data);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError.message);
        }
      } finally {
        if (!cancelled) {
          setActivityLoading(false);
        }
      }
    };

    void refreshActivity();
    const timer = setInterval(() => void refreshActivity(), ACTIVITY_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selectedRunId]);


  useEffect(() => {
    if (selectedRunId) {
      void loadArtifact(selectedTab);
    }
  }, [selectedRunId, selectedTab, loadArtifact]);

  useEffect(() => {
    const resultRunId = detail?.action?.status === 'succeeded'
      ? detail.action.resultRunId
      : null;
    if (resultRunId && resultRunId !== selectedRunId) {
      void (async () => {
        await refreshRuns();
        setSelectedRunId(resultRunId);
      })();
    }
  }, [detail?.action?.status, detail?.action?.resultRunId, selectedRunId, refreshRuns]);


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

  const openNewRun = useCallback(() => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = window.crypto.randomUUID().slice(0, 8);
    setNewRunTitle('');
    setNewRunDescription('');
    setNewRunMode('shadow');
    setNewRunPlanId(stamp + '-' + random);
    setNewRunAction(null);
    setNewRunOpen(true);
  }, []);

  const startNewRun = useCallback(async () => {
    if (!newRunDescription.trim()) {
      return;
    }
    try {
      const data = await api('/api/new-run/plan', {
        method: 'POST',
        body: JSON.stringify({
          title: newRunTitle.trim() || null,
          description: newRunDescription.trim(),
          planId: newRunPlanId,
          preferredExecutionMode: newRunMode,
        }),
      });
      setNewRunAction(data);
      await refreshRuns();
    } catch (nextError) {
      setError(nextError.message);
    }
  }, [newRunDescription, newRunTitle, newRunPlanId, newRunMode, refreshRuns]);

  const selectTab = useCallback((tab) => {
    setSelectedTab(tab);
    setArtifactViewMode('preview');
  }, []);

  if (!selectedRunId && runs.length === 0 && !error) {
    return (
      <div className="layout">
        <RunList
          runs={runs}
          selectedRunId={selectedRunId}
          onSelect={setSelectedRunId}
          onCommands={() => setCommandsOpen(true)}
          onConfig={openConfig}
          onNewRun={openNewRun}
        />
        <CommandsPanel
          catalog={commandCatalog}
          open={commandsOpen}
          onClose={() => setCommandsOpen(false)}
        />

        <ConfigPanel
          open={configOpen}
          onClose={() => setConfigOpen(false)}
          config={configData}
          loading={configLoading}
          onReload={refreshConfig}
        />

      <NewRunModal
        open={newRunOpen}
        onClose={() => setNewRunOpen(false)}
        title={newRunTitle}
        setTitle={setNewRunTitle}
        description={newRunDescription}
        setDescription={setNewRunDescription}
        mode={newRunMode}
        setMode={setNewRunMode}
        planId={newRunPlanId}
        action={newRunAction}
        onStart={startNewRun}
      />

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
        onCommands={() => setCommandsOpen(true)}
        onConfig={openConfig}
        onNewRun={openNewRun}
      />

      <CommandsPanel
        catalog={commandCatalog}
        open={commandsOpen}
        onClose={() => setCommandsOpen(false)}
      />

      <ConfigPanel
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        config={configData}
        loading={configLoading}
        onReload={refreshConfig}
      />

      <NewRunModal
        open={newRunOpen}
        onClose={() => setNewRunOpen(false)}
        title={newRunTitle}
        setTitle={setNewRunTitle}
        description={newRunDescription}
        setDescription={setNewRunDescription}
        mode={newRunMode}
        setMode={setNewRunMode}
        planId={newRunPlanId}
        action={newRunAction}
        onStart={startNewRun}
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
              <div className="top-actions">
                <button type="button" className="button compact" onClick={openConfig}>
                  Config
                </button>
                <button type="button" className="button compact" onClick={() => setCommandsOpen(true)}>
                  Commands
                </button>
                <StatusPill lane={detail.uiLane} />
              </div>
            </header>

            {detail.action?.status === 'failed' ? (
              <div className="global-error">
                Last UI action failed: {detail.action.error}
              </div>
            ) : null}

            <LiveActivity activity={activity} loading={activityLoading} />

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
                preferredExecutionMode={newRunMode}
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
