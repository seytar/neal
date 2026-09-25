export function renderNealUiPage(token: string) {
  const serializedToken = JSON.stringify(token);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Neal Control Center</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0b0f14;
      color: #e7edf5;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: #0b0f14; min-height: 100vh; }
    button, textarea, input { font: inherit; }
    button { cursor: pointer; }
    .app { display: grid; grid-template-columns: 310px minmax(0,1fr); min-height: 100vh; }
    .sidebar { border-right: 1px solid #202833; background: #0e131a; padding: 18px; overflow: auto; }
    .brand { font-weight: 750; font-size: 18px; letter-spacing: .01em; }
    .subtle { color: #8d9aaa; font-size: 12px; }
    .runs { display: grid; gap: 8px; margin-top: 18px; }
    .run { width: 100%; text-align: left; border: 1px solid #26313e; background: #121922; color: inherit; padding: 12px; border-radius: 10px; }
    .run:hover { border-color: #3b4b5e; }
    .run.active { border-color: #6d8cff; background: #151e2c; }
    .run-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 650; }
    .run-meta { margin-top: 6px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .pill { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 3px 8px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
    .pill.running { background: #132f28; color: #77e2b6; }
    .pill.needs_you { background: #3b2b11; color: #ffd37a; }
    .pill.private_validation { background: #2d2344; color: #c8a9ff; }
    .pill.failed { background: #3b1c22; color: #ff9ca8; }
    .pill.done { background: #183044; color: #82c9ff; }
    .main { min-width: 0; padding: 24px; overflow: auto; }
    .empty { color: #8d9aaa; display: grid; place-items: center; min-height: 70vh; }
    .topbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 18px; }
    h1 { font-size: 22px; margin: 0; line-height: 1.25; }
    h2 { font-size: 16px; margin: 0 0 12px; }
    .grid { display: grid; grid-template-columns: minmax(0,1.25fr) minmax(280px,.75fr); gap: 16px; }
    .card { border: 1px solid #202a36; background: #101720; border-radius: 12px; padding: 16px; min-width: 0; }
    .attention { border-color: #6f5630; background: #17140f; }
    .validation { border-color: #544074; background: #14111c; }
    .error { border-color: #64333b; background: #1a1114; }
    .kv { display: grid; grid-template-columns: 130px minmax(0,1fr); gap: 7px 12px; font-size: 13px; }
    .kv .k { color: #8d9aaa; }
    .models { display: grid; gap: 9px; }
    .model { display: grid; grid-template-columns: 78px 1fr; gap: 10px; font-size: 13px; }
    .model .role { color: #8d9aaa; }
    .next { font-size: 13px; line-height: 1.55; color: #d4dde8; }
    textarea, input[type=text] {
      width: 100%; border: 1px solid #2a3745; background: #0b1118; color: #e7edf5;
      border-radius: 9px; padding: 10px 11px; outline: none;
    }
    textarea:focus, input[type=text]:focus { border-color: #6d8cff; }
    textarea { min-height: 110px; resize: vertical; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .btn { border: 1px solid #334153; background: #17212d; color: #e7edf5; padding: 8px 11px; border-radius: 8px; }
    .btn:hover { background: #1d2a39; }
    .btn.primary { border-color: #647fe7; background: #536fd3; color: white; }
    .btn.good { border-color: #2f7b5f; background: #205a45; }
    .btn.danger { border-color: #8f4853; background: #65313a; }
    .btn:disabled { opacity: .45; cursor: default; }
    .option { border: 1px solid #2a3542; border-radius: 9px; padding: 10px; margin: 8px 0; background: #101720; }
    .option-title { font-weight: 650; font-size: 13px; }
    .option-desc { color: #a9b5c3; font-size: 12px; margin-top: 4px; line-height: 1.45; }
    .tabs { display: flex; gap: 6px; flex-wrap: wrap; margin: 18px 0 10px; }
    .tab { border: 1px solid #273443; background: #111923; color: #aeb9c7; padding: 7px 10px; border-radius: 8px; }
    .tab.active { color: white; border-color: #5874da; background: #1b2740; }
    pre { white-space: pre-wrap; word-break: break-word; margin: 0; font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #cbd5e1; }
    .artifact { min-height: 260px; max-height: 55vh; overflow: auto; }
    .notice { margin-top: 10px; padding: 9px 11px; border-radius: 8px; background: #121c27; color: #aeb9c7; font-size: 12px; }
    .notice.bad { background: #29171b; color: #ffb0b8; }
    .small { font-size: 12px; color: #98a5b5; }
    code { font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    @media (max-width: 900px) {
      .app { grid-template-columns: 1fr; }
      .sidebar { border-right: 0; border-bottom: 1px solid #202833; max-height: 32vh; }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
<div class="app">
  <aside class="sidebar">
    <div class="brand">Neal Control Center</div>
    <div class="subtle">State machine visual controller</div>
    <div id="runs" class="runs"></div>
  </aside>
  <main id="main" class="main"><div class="empty">Loading Neal runs...</div></main>
</div>
<script>
const TOKEN = ${serializedToken};
let selectedRun = null;
let selectedTab = 'progress';
let detailTimer = null;
let runsTimer = null;
let lastDetailSignature = '';

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
}
async function api(path, options = {}) {
  const headers = {'Accept':'application/json', ...(options.headers || {})};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if ((options.method || 'GET') !== 'GET') headers['X-Neal-UI-Token'] = TOKEN;
  const response = await fetch(path, {...options, headers});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || ('HTTP ' + response.status));
  return data;
}
function laneLabel(lane) {
  return {running:'Running', needs_you:'Needs you', private_validation:'Validation', failed:'Failed', done:'Done'}[lane] || lane;
}
function modelLabel(config) {
  if (!config) return 'n/a';
  const model = config.model || 'default';
  const effort = config.effort ? ' / ' + config.effort : '';
  return esc(config.provider + ' / ' + model + effort);
}
function planName(path) {
  return String(path || '').split('/').filter(Boolean).pop() || path || 'Unknown plan';
}
async function refreshRuns() {
  try {
    const data = await api('/api/runs');
    const runs = data.runs || [];
    const root = document.getElementById('runs');
    root.innerHTML = runs.length ? runs.map(run => `
      <button class="run ${run.runId === selectedRun ? 'active' : ''}" onclick="selectRun('${esc(run.runId)}')">
        <div class="run-title">${esc(planName(run.planDoc))}</div>
        <div class="run-meta">
          <span class="pill ${esc(run.uiLane)}">${esc(laneLabel(run.uiLane))}</span>
          <span class="subtle">scope ${esc(run.currentScopeNumber)}</span>
        </div>
      </button>`).join('') : '<div class="subtle">No Neal runs found.</div>';
    if (!selectedRun && runs[0]) {
      await selectRun(runs[0].runId);
    }
  } catch (error) {
    document.getElementById('runs').innerHTML = '<div class="notice bad">' + esc(error.message) + '</div>';
  }
}
async function selectRun(runId) {
  selectedRun = runId;
  lastDetailSignature = '';
  await refreshRuns();
  await refreshDetail(true);
}
function captureInputs() {
  return {
    guidance: document.getElementById('guidance')?.value || '',
    feedback: document.getElementById('feedback')?.value || '',
    validationNote: document.getElementById('validation-note')?.value || ''
  };
}
function restoreInputs(values) {
  for (const [id, value] of [['guidance',values.guidance],['feedback',values.feedback],['validation-note',values.validationNote]]) {
    const el = document.getElementById(id);
    if (el && value) el.value = value;
  }
}
function signature(detail) {
  const s = detail.status;
  return JSON.stringify([
    s.runId,s.status,s.phase,s.publicStatus,s.publicPhase,s.waitingForOperatorGuidance,
    s.pendingOperatorGuidance,s.currentScopeNumber,s.lastMeaningfulEventAt,
    detail.action?.status,detail.action?.error
  ]);
}
async function refreshDetail(force = false) {
  if (!selectedRun) return;
  try {
    const detail = await api('/api/runs/' + encodeURIComponent(selectedRun));
    const sig = signature(detail);
    if (!force && sig === lastDetailSignature) return;
    const inputs = captureInputs();
    lastDetailSignature = sig;
    renderDetail(detail);
    restoreInputs(inputs);
    if (selectedTab) loadTab(selectedTab, true);
  } catch (error) {
    document.getElementById('main').innerHTML = '<div class="notice bad">' + esc(error.message) + '</div>';
  }
}
function controlPanel(detail) {
  const s = detail.status;
  const action = detail.action;
  if (action?.status === 'running') {
    return `<div class="card attention"><h2>Neal is working</h2><div class="next">${esc(action.label)} is running. This screen refreshes automatically.</div></div>`;
  }
  if (action?.status === 'failed') {
    return `<div class="card error"><h2>Last UI action failed</h2><div class="next">${esc(action.error)}</div></div>`;
  }
  if (s.phase === 'awaiting_private_validation') {
    return `<div class="card validation">
      <h2>Private validation required</h2>
      <div class="next">Static implementation and review are complete. Validate the mapped changes in the private project.</div>
      <div style="margin-top:12px"><input id="validation-note" type="text" placeholder="Optional note, e.g. private build and tests passed"></div>
      <div class="actions"><button class="btn good" onclick="shadowAccept()">Validation passed</button></div>
      <div style="height:14px"></div>
      <div class="small">Validation failed? Paste sanitized feedback only.</div>
      <textarea id="feedback" placeholder="Sanitized private validation failure..."></textarea>
      <div class="actions"><button class="btn danger" onclick="shadowFeedback()">Send failure back to Neal</button></div>
    </div>`;
  }
  if (s.manualGate) {
    return `<div class="card attention">
      <h2>Manual action required</h2>
      <div class="next"><strong>${esc(s.manualGate.title)}</strong><br>${esc(s.manualGate.reason)}</div>
      ${s.manualGate.lastFailure ? '<div class="notice bad">Last check failed: ' + esc(s.manualGate.lastFailure.checkName) + '</div>' : ''}
      <div class="actions">
        <button class="btn primary" onclick="resumeRun()">Check again & continue</button>
        <button class="btn" onclick="loadTab('manual-gate')">View instructions</button>
      </div>
    </div>`;
  }
  if (s.waitingForOperatorGuidance) {
    const g = s.blockedGuidance;
    const options = (detail.guidanceOptions || []).map((o, i) => `
      <div class="option">
        <div class="option-title">${esc(o.label)}</div>
        <div class="option-desc">${esc(o.description)}</div>
        <div class="actions"><button class="btn" onclick="useGuidanceOption(${i})">Use this option</button></div>
      </div>`).join('');
    window.__nealGuidanceOptions = detail.guidanceOptions || [];
    return `<div class="card attention">
      <h2>Neal needs your decision</h2>
      <div class="next">${esc(g?.summary || s.resumeDecision?.blocker || 'Operator guidance is required.')}</div>
      ${g?.reason ? '<div class="notice">' + esc(g.reason) + '</div>' : ''}
      ${options}
      <textarea id="guidance" placeholder="Tell Neal what decision to apply..."></textarea>
      <div class="actions"><button class="btn primary" onclick="sendGuidance()">Send & continue</button></div>
    </div>`;
  }
  if (s.pendingOperatorGuidance) {
    return `<div class="card attention"><h2>Guidance recorded</h2><div class="next">Neal has operator guidance ready to process.</div><div class="actions"><button class="btn primary" onclick="resumeRun()">Continue</button></div></div>`;
  }
  if (s.resumeDecision?.kind === 'continue') {
    return `<div class="card"><h2>Run can continue</h2><div class="next">${esc(s.resumeDecision.reason)}</div><div class="actions"><button class="btn primary" onclick="resumeRun()">Resume</button></div></div>`;
  }
  if (s.status === 'done') {
    return `<div class="card"><h2>Done</h2><div class="next">No operator action is required.</div></div>`;
  }
  return `<div class="card"><h2>Current state</h2><div class="next">${esc(s.nextAction)}</div></div>`;
}
function renderDetail(detail) {
  const s = detail.status;
  const config = s.build?.agentConfig || {};
  document.getElementById('main').innerHTML = `
    <div class="topbar">
      <div>
        <h1>${esc(planName(s.planDoc))}</h1>
        <div class="subtle" style="margin-top:5px">${esc(s.runId)}</div>
      </div>
      <span class="pill ${esc(detail.uiLane)}">${esc(laneLabel(detail.uiLane))}</span>
    </div>
    <div class="grid">
      <div>${controlPanel(detail)}</div>
      <div class="card">
        <h2>Run</h2>
        <div class="kv">
          <div class="k">Status</div><div>${esc(s.publicStatus)}</div>
          <div class="k">Step</div><div>${esc(s.publicPhase)}</div>
          <div class="k">Scope</div><div>${esc(s.currentScopeNumber)}</div>
          <div class="k">Health</div><div>${esc(s.health?.classification)} · ${esc(s.health?.reason)}</div>
          <div class="k">Findings</div><div>${esc(s.findings?.openBlocking)} blocking, ${esc(s.findings?.openNonBlocking)} non-blocking</div>
        </div>
        <h2 style="margin-top:18px">Models</h2>
        <div class="models">
          <div class="model"><div class="role">Planner</div><div>${modelLabel(config.planner)}</div></div>
          <div class="model"><div class="role">Coder</div><div>${modelLabel(config.coder)}</div></div>
          <div class="model"><div class="role">Reviewer</div><div>${modelLabel(config.reviewer)}</div></div>
        </div>
        <h2 style="margin-top:18px">Next action</h2>
        <div class="next">${esc(s.nextAction)}</div>
      </div>
    </div>
    <div class="tabs">
      ${['progress','plan','review','recovery','narrative','changes','usage'].map(t => '<button class="tab ' + (selectedTab === t ? 'active' : '') + '" onclick="loadTab(\'' + t + '\')">' + esc(t) + '</button>').join('')}
    </div>
    <div class="card artifact"><pre id="artifact">Loading...</pre></div>
  `;
}
function useGuidanceOption(index) {
  const option = (window.__nealGuidanceOptions || [])[index];
  const field = document.getElementById('guidance');
  if (field && option) field.value = option.message || option.description || '';
}
async function postAction(action, body = {}) {
  if (!selectedRun) return;
  try {
    await api('/api/runs/' + encodeURIComponent(selectedRun) + '/actions/' + action, {
      method:'POST', body:JSON.stringify(body)
    });
    lastDetailSignature = '';
    await refreshDetail(true);
  } catch (error) {
    alert(error.message);
  }
}
function resumeRun() { return postAction('resume'); }
function sendGuidance() {
  const message = document.getElementById('guidance')?.value.trim();
  if (!message) return alert('Enter guidance first.');
  return postAction('guidance', {message});
}
function shadowAccept() {
  const note = document.getElementById('validation-note')?.value.trim() || 'private validation passed via Neal UI';
  return postAction('shadow-accept', {note});
}
function shadowFeedback() {
  const feedback = document.getElementById('feedback')?.value.trim();
  if (!feedback) return alert('Paste sanitized feedback first.');
  if (!confirm('Send this text to the Shadow run as sanitized private-validation feedback?')) return;
  return postAction('shadow-feedback', {feedback});
}
async function loadTab(tab, quiet = false) {
  if (!selectedRun) return;
  selectedTab = tab;
  document.querySelectorAll('.tab').forEach(el => el.classList.toggle('active', el.textContent === tab));
  const out = document.getElementById('artifact');
  if (!out) return;
  if (!quiet) out.textContent = 'Loading...';
  try {
    if (tab === 'changes' || tab === 'usage') {
      const data = await api('/api/runs/' + encodeURIComponent(selectedRun) + '/' + tab);
      out.textContent = JSON.stringify(data, null, 2);
      return;
    }
    const data = await api('/api/runs/' + encodeURIComponent(selectedRun) + '/artifacts/' + tab);
    out.textContent = data.content || '(empty)';
  } catch (error) {
    out.textContent = error.message;
  }
}
refreshRuns();
runsTimer = setInterval(refreshRuns, 2500);
detailTimer = setInterval(() => refreshDetail(false), 2500);
</script>
</body>
</html>`;
}
