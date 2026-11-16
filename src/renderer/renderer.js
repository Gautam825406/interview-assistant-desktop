// Interview Assistant — renderer (SaaS client)
//
// All AI goes through the backend (POST /api/ai/*). No provider keys live
// here and there is no Demo Mode: the backend enforces the user's plan
// (402 = limit reached -> upgrade prompt) and routes to the provider the
// service owner configured in the Admin panel.
const DEFAULT_API_BASE = 'https://interview-assistant-api-s0sx.onrender.com';

let settings = { apiBase: DEFAULT_API_BASE, token: '', user: null, language: 'en', autoAnswer: true, transparent: true };
let me = null; // {user, subscription, usage} from GET /api/auth/me
let plans = [];
let aiStatus = null;
let resumeText = '';
let session = null; // { mode, company, role, jd, startedAt, qa: [], transcript: [], backendStarted }
let liveSeconds = 0, liveTimerId = null;
let recognition = null, micStream = null, tabStream = null, mediaRecorder = null;
let micRecorder = null;
let sysStream = null, sysRecorder = null;
let whisperBusy = false, whisperQueue = [], lastWhisperText = '', noKeyWarned = false, whisperErrorShown = false, planLimitShown = false;
let mock = { topic: '', idx: 0, questions: [], answers: [] };

const $ = (id) => document.getElementById(id);
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const isAdmin = () => me?.user?.role === 'admin';
const money = (amount, currency) => {
  const sym = currency === 'INR' ? '₹' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
  return `${sym}${Number(amount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};
// Local question detector (was in demo-bank.js) — pure heuristic, no AI.
function isQuestion(text) {
  const t = (text || '').trim();
  if (!t) return false;
  if (t.endsWith('?')) return true;
  return /^(what|why|how|when|where|who|which|can you|could you|tell me|explain|describe|do you|have you|is it|are you|would you)\b/i.test(t) && t.split(/\s+/).length >= 4;
}

// ---------- API client (main attaches the Bearer token) ----------
async function api(path, opts = {}) {
  const r = await window.api.apiCall(path, opts);
  if (r.status === 401) { doLogout(true); throw new Error('Session expired — please log in again.'); }
  return r;
}
function apiError(r) {
  return r?.data?.error || r?.data?.message || r?.data?.detail || ('Request failed (HTTP ' + (r?.status ?? '?') + ')');
}

// ---------- views ----------
function showView(name) {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  if (name === 'admin' && isAdmin()) loadAdmin();
  if (name === 'pricing') loadPlans();
}
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

// ---------- auth ----------
function showAuth() {
  $('authView').hidden = false;
  $('app').hidden = true;
  $('authError').textContent = '';
}
function enterApp(data) {
  me = data;
  $('authView').hidden = true;
  $('app').hidden = false;
  $('tabAdmin').hidden = !isAdmin();
  renderAccount();
  loadPlans();
  loadAiStatus();
  refreshSaved();
  if (isAdmin()) loadAdmin();
}
async function doLogout(silent) {
  await window.api.authLogout();
  me = null;
  if (!silent) showAuth(); else showAuth();
}
$('tabLogin').addEventListener('click', () => {
  $('tabLogin').classList.add('active'); $('tabSignup').classList.remove('active');
  $('loginForm').hidden = false; $('signupForm').hidden = true; $('authError').textContent = '';
});
$('tabSignup').addEventListener('click', () => {
  $('tabSignup').classList.add('active'); $('tabLogin').classList.remove('active');
  $('signupForm').hidden = false; $('loginForm').hidden = true; $('authError').textContent = '';
});
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('loginForm').querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Signing in…';
  $('authError').textContent = 'Contacting the service — the free server can take up to a minute to wake up. Please wait…';
  try {
    const r = await window.api.authLogin($('loginEmail').value.trim(), $('loginPass').value);
    $('authError').textContent = '';
    if (r.status !== 200 || !r.data?.token) { $('authError').textContent = apiError(r); return; }
    const m = await window.api.apiCall('/api/auth/me', {});
    if (m.status === 200 && m.data?.user) enterApp(m.data);
    else $('authError').textContent = 'Logged in, but could not load your account — please try again.';
  } finally { btn.disabled = false; btn.textContent = 'Log in →'; }
});
$('signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pass = $('signupPass').value;
  if (pass.length < 6) { $('authError').textContent = 'Password must be at least 6 characters.'; return; }
  const btn = $('signupForm').querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Creating account…';
  $('authError').textContent = 'Contacting the service — the free server can take up to a minute to wake up. Please wait…';
  try {
    const r = await window.api.authSignup($('signupName').value.trim(), $('signupEmail').value.trim(), pass);
    $('authError').textContent = '';
    if (r.status !== 200 || !r.data?.token) { $('authError').textContent = apiError(r); return; }
    const m = await window.api.apiCall('/api/auth/me', {});
    if (m.status === 200 && m.data?.user) enterApp(m.data);
    else $('authError').textContent = 'Account created, but could not load your profile — please log in.';
  } finally { btn.disabled = false; btn.textContent = 'Create account →'; }
});
$('btnLogout').addEventListener('click', () => doLogout());

// ---------- account / plan display ----------
function renderAccount() {
  if (!me) return;
  const u = me.user, usage = me.usage || {}, sub = me.subscription;
  $('helloName').textContent = `Welcome, ${u.name || u.email}`;
  $('accountLine').textContent = `${u.email} · ${isAdmin() ? 'Admin' : 'Member'} · Plan: ${(u.plan_slug || 'free').toUpperCase()}`;
  $('planBadge').textContent = (u.plan_slug || 'free').toUpperCase();
  $('statPlan').textContent = (u.plan_slug || 'free').replace(/^\w/, (c) => c.toUpperCase());
  $('statSessions').textContent = usage.sessions_limit == null ? `${usage.sessions_used ?? 0} / ∞` : `${usage.sessions_used ?? 0} / ${usage.sessions_limit}`;
  $('statMocks').textContent = usage.mock_limit == null ? `${usage.mocks_used ?? 0} / ∞` : `${usage.mocks_used ?? 0} / ${usage.mock_limit}`;
  $('subLine').textContent = sub?.expires_at
    ? `Subscription active until ${new Date(sub.expires_at).toLocaleDateString()} (${sub.plan_slug}).`
    : (u.plan_slug && u.plan_slug !== 'free' ? 'Paid plan, no active subscription record — check Pricing.' : 'Free plan — upgrade in Pricing for unlimited sessions and mocks.');
  $('currentPlanLine').textContent = `You are on the ${(u.plan_slug || 'free').toUpperCase()} plan.` + (sub?.expires_at ? ` Renews/expires ${new Date(sub.expires_at).toLocaleDateString()}.` : '');
  $('settingsAccount').textContent = `Signed in as ${u.name || ''} (${u.email}) — ${isAdmin() ? 'Admin' : 'Member'}.`;
}
async function refreshMe() {
  try { const r = await api('/api/auth/me', {}); if (r.status === 200) { me = r.data; renderAccount(); } } catch {}
}
async function loadAiStatus() {
  try {
    const r = await api('/api/ai/status', {});
    if (r.status === 200) {
      aiStatus = r.data;
      const b = $('aiBadge');
      if (r.data.configured) { b.textContent = `AI · ${r.data.provider || 'ready'}`; b.className = 'badge ai-ok'; }
      else { b.textContent = 'AI not set up'; b.className = 'badge ai-off'; b.title = 'The service owner has not added an AI key yet.'; }
    }
  } catch { $('aiBadge').textContent = 'AI…'; }
}
function showUpgrade(message) {
  const b = $('upgradeBanner');
  b.innerHTML = `<b>⬆️ ${esc(message || 'Your plan limit is reached.')}</b><br/><span class="muted">Upgrade for unlimited sessions and mocks.</span> <button class="btn primary" id="btnGoPricing">View plans →</button>`;
  b.hidden = false;
  $('btnGoPricing').addEventListener('click', () => showView('pricing'));
}

// ---------- settings ----------
async function loadSettings() {
  settings = await window.api.settingsGet();
  document.body.classList.toggle('solid', settings.transparent === false);
  $('setApiBase').value = settings.apiBase || DEFAULT_API_BASE;
  $('setLang').value = settings.language || 'en';
  $('setTransparent').checked = settings.transparent !== false;
  $('autoAnswer').checked = settings.autoAnswer !== false;
  $('sessLang').value = settings.language || 'en';
}
$('btnSaveSettings').addEventListener('click', async () => {
  const transparent = $('setTransparent').checked;
  const changedTransparency = transparent !== (settings.transparent !== false);
  settings = { ...settings, apiBase: $('setApiBase').value.trim() || DEFAULT_API_BASE, language: $('setLang').value, autoAnswer: $('autoAnswer').checked, transparent };
  await window.api.settingsSave(settings);
  $('setStatus').textContent = 'Saved.' + (changedTransparency ? ' Rebuilding the window for the new transparency mode…' : '');
  if (changedTransparency) await window.api.setTransparent(transparent);
});
$('autoAnswer').addEventListener('change', async () => {
  settings.autoAnswer = $('autoAnswer').checked;
  await window.api.settingsSave(settings);
});
$('btnPrivate').addEventListener('click', async () => {
  const on = await window.api.togglePrivate();
  $('privateBadge').style.display = on ? '' : 'none';
  $('privateBadge').textContent = on ? '🔒 Private' : '👁 Visible';
});
window.api.onPrivateMode((on) => { $('privateBadge').style.display = on ? '' : 'none'; });
$('btnMin').addEventListener('click', () => window.api.minimise());
$('btnHide').addEventListener('click', () => window.api.hide());
$('btnQuit').addEventListener('click', () => window.api.quit());
window.api.onHotkeyMinimise(() => window.api.minimise());

// ---- Resume ----
$('btnResume').addEventListener('click', async () => {
  const r = await window.api.pickResume();
  if (!r) return;
  if (r.ok) { resumeText = r.text; $('resumeName').textContent = `Loaded: ${r.path.split(/[\\/]/).pop()} (${resumeText.length} chars)`; }
  else { $('resumeName').textContent = `Could not parse PDF: ${r.error || 'unknown error'} — paste text into Job description instead.`; }
});

// ---- Sessions (local history) ----
function startLocalSession(kind) {
  session = {
    mode: $('sessMode').value, company: $('sessCompany').value.trim(), role: $('sessRole').value.trim(),
    jd: $('sessJD').value.trim(), language: $('sessLang').value,
    startedAt: new Date().toISOString(), qa: [], transcript: [], backendStarted: false,
  };
  liveSeconds = 0;
  $('liveMeta').textContent = `${session.mode === 'interview' ? '🎯 Interview' : '📞 Regular call'} · ${session.company || '—'} · ${session.role || '—'} · started ${new Date().toLocaleTimeString()}`;
  $('notesCard').hidden = true;
  $('upgradeBanner').hidden = true;
  clearInterval(liveTimerId);
  liveTimerId = setInterval(() => { liveSeconds++; $('liveTimer').textContent = fmt(liveSeconds); }, 1000);
}
// Gate: one backend session-start per live session / mock. 402 = plan limit.
async function ensureBackendSession(kind) {
  if (session?.backendStarted) return true;
  const path = kind === 'mock' ? '/api/mocks/start' : '/api/sessions/start';
  let r;
  try { r = await api(path, { method: 'POST', body: {} }); }
  catch (err) { addTranscript(err.message, false); return false; }
  if (r.status === 402) { showUpgrade(r.data?.message || 'Your plan limit is reached.'); return false; }
  if (r.status !== 200) { addTranscript('Could not start a session: ' + apiError(r), false); return false; }
  if (session) session.backendStarted = true;
  refreshMe();
  return true;
}
async function startSession(kind) {
  if (!session) startLocalSession(kind);
  const ok = await ensureBackendSession(kind);
  if (!ok) { if (kind === 'mock') { /* stay on dashboard; upgrade banner is on Live */ showView('pricing'); } return; }
  showView(kind === 'mock' ? 'mock' : 'live');
  if (kind === 'mock') startMock();
}
$('btnStartLive').addEventListener('click', () => startSession('live'));
$('btnStartMock').addEventListener('click', () => startSession('mock'));

async function refreshSaved() {
  const list = await window.api.sessionsList();
  $('sessCount').textContent = `(${list.length})`;
  $('savedList').innerHTML = list.length ? '' : '<p class="muted">No sessions saved yet.</p>';
  list.slice(0, 10).forEach((s) => {
    const div = document.createElement('div');
    div.className = 'saved-item';
    div.innerHTML = `<span><b>${esc(s.company || 'Session')}</b> · ${esc(s.role || '')} · ${s.qa?.length || 0} Q&amp;A · ${new Date(s.startedAt || s.savedAt).toLocaleString()}</span>`;
    const del = document.createElement('button'); del.textContent = 'Delete';
    del.onclick = async () => { await window.api.sessionsDelete(s.id); refreshSaved(); };
    div.appendChild(del); $('savedList').appendChild(div);
  });
}

// ---- Live: question -> answer (via backend /api/ai/chat) ----
function addTranscript(text, isQ) {
  if (!session) startLocalSession('live');
  session.transcript.push({ t: new Date().toISOString(), text, isQ: !!isQ });
  const p = document.createElement('p');
  p.className = isQ ? 'q' : '';
  p.textContent = (isQ ? '❓ ' : '') + text;
  $('transcript').appendChild(p);
  $('transcript').scrollTop = $('transcript').scrollHeight;
}

async function answerQuestion(question) {
  if (!session) startLocalSession('live');
  const ok = await ensureBackendSession('live');
  if (!ok) return;
  addTranscript(question, true);
  $('ansSource').textContent = '…thinking';
  $('answerBox').textContent = 'Generating answer…';
  $('answerDetail').textContent = '';
  const sys = `You are a discreet real-time interview assistant. The candidate is in a live ${session?.mode || 'interview'} for ${session?.role || 'a role'} at ${session?.company || 'a company'}. Resume:\n${resumeText.slice(0, 6000)}\n\nJob description / instructions:\n${(session?.jd || '').slice(0, 8000)}\n\nGive a concise speakable answer first (2-4 sentences), then a fuller version. If it is a coding question, give approach + complexity + short code. If system design, end with a small text flowchart. Answer in ${session?.language || 'en'}.`;
  let r;
  try {
    r = await api('/api/ai/chat', { method: 'POST', body: { messages: [{ role: 'system', content: sys }, { role: 'user', content: question }], temperature: 0.4, max_tokens: 1200 } });
  } catch (err) { $('answerBox').textContent = err.message; $('ansSource').textContent = ''; return; }
  if (r.status === 402) { showUpgrade(r.data?.message); $('answerBox').textContent = 'Plan limit reached — upgrade to continue.'; return; }
  if (r.status === 503) { $('answerBox').textContent = 'The service owner has not added an AI key yet — please try again later.'; $('ansSource').textContent = ''; return; }
  if (r.status !== 200 || !r.data?.text) { $('answerBox').textContent = 'Answer failed: ' + apiError(r); $('ansSource').textContent = ''; return; }
  const parts = r.data.text.split(/\n\n+/);
  const result = { short: parts[0] || r.data.text, detailed: parts.slice(1).join('\n\n'), source: `${r.data.provider || 'AI'} · ${r.data.model || ''}` };
  $('answerBox').textContent = result.short;
  $('answerDetail').textContent = result.detailed || '';
  $('ansSource').textContent = `— ${result.source}`;
  session.qa.push({ q: question, short: result.short, detailed: result.detailed, at: new Date().toISOString() });
}
$('btnAsk').addEventListener('click', () => { const q = $('qInput').value.trim(); if (q) { $('qInput').value = ''; answerQuestion(q); } });
$('qInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnAsk').click(); });
document.querySelectorAll('.demo-q').forEach((b) => b.addEventListener('click', () => answerQuestion(b.dataset.q)));

// ---------- audio engine: any source -> backend transcription ----------
// Electron's Chromium has NO SpeechRecognition (no Google speech service),
// so the mic cannot use it here at all. All audio goes to the backend
// /api/ai/transcribe in 5-second chunks (Whisper on the server side).
// SpeechRecognition is kept only as a bonus fast path if this Chromium
// ever provides it.
function audioStatus(text) { const el = $('audioStatus'); if (el) el.textContent = text; }
function langCode() { return ({ en: 'en', hi: 'hi', hinglish: 'hi' })[session?.language || settings.language] || 'en'; }
function pickMimeType() {
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', '']) {
    if (!m) return '';
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch {}
  }
  return '';
}
function blobToBase64(blob) {
  return blob.arrayBuffer().then((b) => { let s = ''; const u = new Uint8Array(b); for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(s); });
}
async function pumpWhisperQueue() {
  if (whisperBusy) return;
  whisperBusy = true;
  while (whisperQueue.length) {
    const { blob, label, mime } = whisperQueue.shift();
    let r;
    try { r = await window.api.transcribe(await blobToBase64(blob), mime || 'audio/webm'); }
    catch (err) { if (!whisperErrorShown) { whisperErrorShown = true; addTranscript(`Transcription error: ${err.message}`, false); } continue; }
    if (r.status === 402) {
      if (!planLimitShown) { planLimitShown = true; showUpgrade(r.data?.message); }
      continue;
    }
    if (r.status === 503) {
      if (!noKeyWarned) { noKeyWarned = true; addTranscript('Transcription is unavailable right now — the service owner has not added an AI key yet.', false); }
      continue;
    }
    if (r.status !== 200 || !r.data?.text) {
      // Don't flood the transcript with the same error every 5 seconds.
      if (!whisperErrorShown) { whisperErrorShown = true; addTranscript(`Transcription error: ${apiError(r)}`, false); }
      else audioStatus(`⚠️ Transcription error: ${apiError(r)}`);
      continue;
    }
    const t = (r.data.text || '').trim();
    if (!t || t.length < 2 || t === lastWhisperText) continue; // skip silence / repeats
    lastWhisperText = t;
    addTranscript(`${label}: ${t}`, isQuestion(t));
    audioStatus(`🎧 Last heard ${new Date().toLocaleTimeString()} — ${label}`);
    if (isQuestion(t) && $('autoAnswer').checked) answerQuestion(t);
  }
  whisperBusy = false;
}
// Record in ~5 second cycles: stop the recorder, send that complete file,
// then start a fresh recorder. Using start(5000) timeslices instead gives
// chunks WITHOUT the file header after the first one, and Whisper rejects
// every one of them as "not a valid media file".
function startWhisperRecorder(stream, label) {
  // Record AUDIO ONLY — recording the whole display stream (video+audio)
  // as "audio/webm" produced unusable files, which is why tab audio
  // transcribed nothing before.
  const audioOnly = new MediaStream(stream.getAudioTracks());
  if (!audioOnly.getAudioTracks().length) return null;
  const mime = pickMimeType();
  whisperErrorShown = false;
  const ctrl = {
    _stopped: false, _rec: null, _timer: null,
    stop() {
      this._stopped = true;
      clearTimeout(this._timer);
      try { if (this._rec && this._rec.state !== 'inactive') this._rec.stop(); } catch {}
    },
  };
  const startOne = () => {
    if (ctrl._stopped) return;
    let rec;
    try { rec = new MediaRecorder(audioOnly, mime ? { mimeType: mime } : undefined); } catch { return; }
    ctrl._rec = rec;
    rec.ondataavailable = (e) => { if (e.data && e.data.size > 1000) { whisperQueue.push({ blob: e.data, label, mime: rec.mimeType }); pumpWhisperQueue(); } };
    rec.onerror = () => { audioStatus(`⚠️ ${label} recorder error — restart capture.`); };
    rec.onstop = () => { if (!ctrl._stopped) startOne(); };
    try { rec.start(); } catch { return; }
    ctrl._timer = setTimeout(() => { try { if (rec.state === 'recording') rec.stop(); } catch {} }, 5000);
  };
  startOne();
  return ctrl._rec ? ctrl : null;
}
function stopRecorder(rec) { try { if (rec && typeof rec.stop === 'function') rec.stop(); } catch {} }
function stopAllAudio() {
  recognition?.stop(); recognition = null;
  stopRecorder(mediaRecorder); mediaRecorder = null;
  stopRecorder(micRecorder); micRecorder = null;
  stopRecorder(sysRecorder); sysRecorder = null;
  tabStream?.getTracks().forEach((t) => t.stop()); tabStream = null;
  micStream?.getTracks().forEach((t) => t.stop()); micStream = null;
  sysStream?.getTracks().forEach((t) => t.stop()); sysStream = null;
  $('btnMic').textContent = '🎙️ Mic: off';
  $('btnTabAudio').textContent = '🖥️ Capture Meet / Zoom tab audio';
  $('btnSysAudio').textContent = '🔊 System audio (Zoom app)';
}

// Mic: SpeechRecognition if present, otherwise Whisper via the backend
$('btnMic').addEventListener('click', async () => {
  if (recognition || micRecorder) { recognition?.stop(); recognition = null; stopRecorder(micRecorder); micRecorder = null; micStream?.getTracks().forEach((t) => t.stop()); micStream = null; $('btnMic').textContent = '🎙️ Mic: off'; audioStatus('Mic stopped.'); return; }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      recognition = new SR(); recognition.continuous = true; recognition.interimResults = true;
      recognition.lang = (session?.language || 'en') === 'hi' ? 'hi-IN' : 'en-US';
      recognition.onresult = (e) => {
        const last = e.results[e.results.length - 1];
        if (last.isFinal) { const text = last[0].transcript.trim(); if (text) { addTranscript(text, isQuestion(text)); if (isQuestion(text) && $('autoAnswer').checked) answerQuestion(text); } }
      };
      recognition.onend = () => { if (micStream) { try { recognition.start(); } catch {} } }; // Chrome stops after pauses
      recognition.onerror = (e) => { if (e.error === 'not-allowed') { addTranscript('Mic blocked — allow microphone access and retry.', false); stopAllAudio(); } };
      recognition.start();
      $('btnMic').textContent = '🎙️ Mic: listening… (click to stop)';
      audioStatus('🎙️ Mic on — listening…');
    } else {
      // Electron has no SpeechRecognition — this is the expected path here.
      micRecorder = startWhisperRecorder(micStream, 'You');
      if (!micRecorder) { addTranscript('Mic recorder could not start in this build.', false); return; }
      $('btnMic').textContent = '🎙️ Mic: listening… (click to stop)';
      addTranscript('Mic listening… speak and the transcript will appear in ~5 second chunks.', false);
      audioStatus('🎙️ Mic on — listening…');
    }
  } catch (err) { addTranscript(`Mic error: ${err.message}. Allow microphone access and retry.`, false); }
});

// Tab audio: capture a Meet / Zoom browser tab, transcribe it via the backend
$('btnTabAudio').addEventListener('click', async () => {
  if (tabStream) { stopRecorder(mediaRecorder); mediaRecorder = null; tabStream.getTracks().forEach((t) => t.stop()); tabStream = null; $('btnTabAudio').textContent = '🖥️ Capture Meet / Zoom tab audio'; audioStatus('Tab audio stopped.'); return; }
  try {
    tabStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const audioTracks = tabStream.getAudioTracks();
    if (!audioTracks.length) {
      addTranscript('This capture has NO audio track — pick the Meet/Zoom tab again and tick “Share audio”. (If the tab has no sound, there is nothing to transcribe.)', false);
      tabStream.getTracks().forEach((t) => t.stop()); tabStream = null;
      return;
    }
    addTranscript('Tab capture started — share the Google Meet / Zoom tab (tick “Share audio”). Video is used only to pick the tab; it is never uploaded.', false);
    mediaRecorder = startWhisperRecorder(tabStream, 'Interviewer');
    if (!mediaRecorder) { addTranscript('Tab audio recorder could not start in this build.', false); return; }
    $('btnTabAudio').textContent = '🖥️ Tab audio live… (click to stop)';
    audioStatus('🔊 Tab audio live — transcribing the interviewer…');
    tabStream.getVideoTracks()[0]?.addEventListener('ended', () => { stopRecorder(mediaRecorder); mediaRecorder = null; tabStream = null; $('btnTabAudio').textContent = '🖥️ Capture Meet / Zoom tab audio'; addTranscript('Tab capture stopped.', false); });
  } catch (err) { addTranscript(`Tab capture cancelled / failed: ${err.message}`, false); }
});

// System audio: whole-computer sound (Zoom desktop app) via screen loopback
$('btnSysAudio').addEventListener('click', async () => {
  if (sysStream) { stopRecorder(sysRecorder); sysRecorder = null; sysStream.getTracks().forEach((t) => t.stop()); sysStream = null; $('btnSysAudio').textContent = '🔊 System audio (Zoom app)'; audioStatus('System audio stopped.'); return; }
  try {
    const sources = await window.api.captureSources();
    const screen = sources.find((s) => s.id.startsWith('screen:'));
    if (!screen) { addTranscript('No screen source found for system audio.', false); return; }
    sysStream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: screen.id } },
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: screen.id, maxWidth: 1, maxHeight: 1 } },
    });
    if (!sysStream.getAudioTracks().length) {
      addTranscript('System audio loopback gave no audio track on this machine — use the Meet/Zoom tab capture instead, or a virtual audio cable.', false);
      sysStream.getTracks().forEach((t) => t.stop()); sysStream = null;
      return;
    }
    sysRecorder = startWhisperRecorder(sysStream, 'Interviewer');
    if (!sysRecorder) { addTranscript('System audio recorder could not start in this build.', false); return; }
    $('btnSysAudio').textContent = '🔊 System audio live… (click to stop)';
    addTranscript('System audio live — the Zoom app’s sound is being transcribed in ~5 second chunks.', false);
    audioStatus('🔊 System audio live — transcribing…');
  } catch (err) { addTranscript(`System audio failed: ${err.message}. On this machine use the Meet/Zoom tab capture instead.`, false); }
});

// Screenshot: capture the screen, READ the question in it via /api/ai/vision,
// then answer it — no typing needed.
$('btnShot').addEventListener('click', async () => {
  $('shotBox').innerHTML = '<p class="muted small">📸 Capturing screen…</p>';
  try {
    const sources = await window.api.captureSources();
    if (!sources.length) { $('shotBox').innerHTML = '<p class="muted small">No screen found to capture.</p>'; return; }
    const shot = sources.find((s) => s.id.startsWith('screen:')) || sources[0];
    $('shotBox').innerHTML = `<img src="${shot.thumbnail}" /><p class="muted small">📸 Reading the screenshot…</p>`;
    let r;
    try { r = await api('/api/ai/vision', { method: 'POST', body: { image: shot.thumbnail } }); }
    catch (err) { $('shotBox').innerHTML += `<p class="muted small">${esc(err.message)}</p>`; return; }
    if (r.status === 402) { showUpgrade(r.data?.message); $('shotBox').innerHTML += '<p class="muted small">Plan limit reached — upgrade to continue.</p>'; return; }
    if (r.status === 503) { $('shotBox').innerHTML += '<p class="muted small">Screenshot reading is unavailable — the service owner has not added an AI key yet.</p>'; return; }
    if (r.status !== 200 || !r.data?.text) { $('shotBox').innerHTML += `<p class="muted small">Could not read the screenshot: ${esc(apiError(r))}</p>`; return; }
    const q = (r.data.text || '').trim();
    if (!q || /^NO QUESTION FOUND/i.test(q)) {
      $('shotBox').innerHTML += '<p class="muted small">No question found in the screenshot — make sure the problem is visible on screen, then try again.</p>';
      return;
    }
    $('shotBox').innerHTML += `<p><b>Read from screen:</b> ${esc(q)}</p>`;
    answerQuestion(q);
  } catch (err) {
    $('shotBox').innerHTML = `<p class="muted small">Screenshot failed: ${esc(err.message)}</p>`;
  }
});

// End session -> AI notes (via backend)
$('btnEnd').addEventListener('click', async () => {
  clearInterval(liveTimerId);
  stopAllAudio();
  audioStatus('Session ended.');
  if (!session) return;
  const qs = session.qa.map((x) => x.q);
  let notes;
  if (qs.length) {
    let r = null;
    try { r = await api('/api/ai/chat', { method: 'POST', body: { messages: [{ role: 'user', content: `Summarise this interview in bullets: key points discussed, decisions, action items / follow-ups.\nQuestions:\n${qs.join('\n')}\nTranscript:\n${session.transcript.map((t) => t.text).join('\n').slice(0, 6000)}` }], temperature: 0.3, max_tokens: 800 } }); } catch {}
    notes = (r && r.status === 200 && r.data?.text) ? r.data.text : `Questions asked (${qs.length}):\n- ${qs.join('\n- ')}\n\nDuration: ${fmt(liveSeconds)}.`;
  } else {
    notes = 'No questions were asked in this session.';
  }
  $('notesBox').innerHTML = `<pre style="white-space:pre-wrap;font-family:inherit">${esc(notes)}</pre>`;
  $('notesCard').hidden = false;
  session.notes = notes; session.durationSec = liveSeconds;
});
$('btnSaveSession').addEventListener('click', async () => {
  if (!session) return;
  await window.api.sessionsSave(session);
  $('btnSaveSession').textContent = '✓ Saved';
  setTimeout(() => { $('btnSaveSession').textContent = '💾 Save session'; }, 2000);
  refreshSaved();
});

// ---- Mock interview (gate first, then backend chat per answer) ----
const MOCK_QS = {
  'GenAI / RAG': ['Explain RAG end-to-end, and where it can fail.', 'What is the difference between fine-tuning and RAG? When would you pick each?', 'How would you evaluate a RAG system? Name the metrics.', 'What is hallucination, and how do you reduce it in production?', 'Explain embeddings and why chunk size matters.'],
  'DSA': ['How would you solve Two Sum, and what is the complexity?', 'Reverse a linked list — explain your approach.', 'How do you detect a cycle in a graph?', 'Explain binary search and when it breaks.', 'Design a LRU cache — what data structures and why?'],
  'HR / Behavioural': ['Tell me about yourself.', 'Why should we hire you for this role?', 'Tell me about a time you solved a hard problem.', 'What is your biggest weakness, and what are you doing about it?', 'Where do you see yourself in 5 years?'],
  'System Design': ['Design a URL shortener.', 'Design a chat system like WhatsApp.', 'How would you design a rate limiter?', 'Design a news feed. How do you handle fan-out?', 'Design a file storage service like Google Drive.'],
  'Python + FastAPI': ['What is the GIL, and how does it affect Python concurrency?', 'How does FastAPI validate requests?', 'Explain decorators with an example.', 'Sync vs async endpoints in FastAPI — when does it matter?', 'How would you structure a FastAPI project for production?'],
  'SQL': ['What is the difference between INNER and LEFT JOIN?', 'How do indexes work, and when do they hurt?', 'Explain normalisation — 1NF to 3NF.', 'Write a query to find the second-highest salary.', 'What is a deadlock, and how do you avoid it?'],
};
function startMock() {
  mock = { topic: $('mockTopic').value, idx: 0, questions: [...MOCK_QS[$('mockTopic').value]], answers: [] };
  $('mockNum').textContent = '1';
  $('mockQ').textContent = mock.questions[0];
  $('mockFeedback').innerHTML = '';
  $('btnMockNext').disabled = false; $('btnMockEnd').disabled = false; $('btnMockEval').disabled = false;
  let s = 0; clearInterval(mock.timerId);
  mock.timerId = setInterval(() => { s++; $('mockTimer').textContent = fmt(s); }, 1000);
}
$('btnMockStart').addEventListener('click', () => startSession('mock'));
$('btnMockNext').addEventListener('click', () => {
  if ($('mockA').value.trim()) mock.answers.push({ q: mock.questions[mock.idx], a: $('mockA').value.trim() });
  mock.idx++;
  if (mock.idx >= mock.questions.length) { $('mockQ').textContent = 'That was the last question — press “Finish & feedback”.'; $('btnMockNext').disabled = true; return; }
  $('mockNum').textContent = String(mock.idx + 1);
  $('mockQ').textContent = mock.questions[mock.idx];
  $('mockA').value = '';
});
$('btnMockEval').addEventListener('click', async () => {
  const q = mock.questions[mock.idx], a = $('mockA').value.trim();
  if (!a) { $('mockFeedback').textContent = 'Type your answer first.'; return; }
  $('mockFeedback').textContent = 'Evaluating…';
  let r;
  try {
    r = await api('/api/ai/chat', { method: 'POST', body: { messages: [{ role: 'user', content: `You are an interviewer. Question: ${q}\nCandidate answer: ${a}\nGive a score out of 10, 2 strengths, 2 improvements, and a model answer in 3-4 sentences.` }], temperature: 0.4, max_tokens: 1000 } });
  } catch (err) { $('mockFeedback').textContent = err.message; return; }
  if (r.status === 402) { showUpgrade(r.data?.message); $('mockFeedback').textContent = 'Plan limit reached — upgrade to continue.'; return; }
  $('mockFeedback').innerHTML = (r.status === 200 && r.data?.text)
    ? `<pre style="white-space:pre-wrap;font-family:inherit">${esc(r.data.text)}</pre>`
    : `<p>Evaluation failed: ${esc(apiError(r))}</p>`;
});
$('btnMockEnd').addEventListener('click', async () => {
  clearInterval(mock.timerId);
  if ($('mockA').value.trim()) mock.answers.push({ q: mock.questions[mock.idx], a: $('mockA').value.trim() });
  $('mockFeedback').innerHTML += `<p><b>Mock finished:</b> ${mock.answers.length} answer(s) in topic “${esc(mock.topic)}”. Practice the weakest one again tomorrow.</p>`;
  if (session) { session.qa = mock.answers.map((x) => ({ q: x.q, short: x.a, detailed: '' })); await window.api.sessionsSave({ ...session, mode: 'mock', company: mock.topic, role: 'Mock Interview' }); refreshSaved(); }
  $('btnMockNext').disabled = true; $('btnMockEnd').disabled = true;
  refreshMe();
});

// ---- Question bank ----
const BANK = {
  Google: ['Tell me about yourself.', 'Design a URL shortener.', 'How would you solve Two Sum?', 'Explain how Google Search ranking works at a high level.', 'Why Google?'],
  Amazon: ['Tell me about a time you took ownership.', 'Explain the Leadership Principles with an example.', 'Design a recommendation system.', 'How do you handle a disagreeing teammate?'],
  Microsoft: ['Explain OOP with a real example.', 'Design a chat application.', 'What is the difference between a process and a thread?', 'Why Microsoft?'],
  Flipkart: ['Design a cart / checkout flow for scale.', 'Explain caching and where you would use it.', 'Tell me about a project you are proud of.'],
  'TCS / Infosys': ['Explain SDLC.', 'What is the difference between SQL and NoSQL?', 'Write a program to reverse a string.', 'Tell me about yourself.'],
  'GenAI roles': ['Explain RAG and its eval metrics.', 'LangChain vs LangGraph — when to use which?', 'How do you stop an LLM from hallucinating?', 'What is prompt injection, and how do you defend against it?'],
};
$('bankCompany').innerHTML = Object.keys(BANK).map((c) => `<option>${c}</option>`).join('');
function renderBank() {
  $('bankList').innerHTML = BANK[$('bankCompany').value].map((q) => `<p>• <a href="#" data-q="${esc(q)}" style="color:#c7d2fe">${esc(q)}</a></p>`).join('');
  $('bankList').querySelectorAll('a').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); showView('live'); $('qInput').value = a.dataset.q; answerQuestion(a.dataset.q); }));
}
$('bankCompany').addEventListener('change', renderBank);
renderBank();

// ---- Pricing (from GET /api/plans) ----
function planLimits(p) {
  if (!p) return '';
  if (p.slug === 'free' || (p.sessions_limit != null && p.mock_limit != null)) {
    return `${p.sessions_limit ?? '—'} sessions × ${p.minutes_per_session ?? '—'} min · ${p.mock_limit ?? '—'} mock`;
  }
  return 'Unlimited sessions · Unlimited mocks';
}
async function loadPlans() {
  try {
    const r = await window.api.apiCall('/api/plans', {});
    if (r.status === 200 && Array.isArray(r.data)) { plans = r.data; renderPlans(); }
    else $('plansList').innerHTML = '<p class="muted">Could not load plans: ' + esc(apiError(r)) + '</p>';
  } catch (err) { $('plansList').innerHTML = '<p class="muted">Could not load plans: ' + esc(err.message) + '</p>'; }
}
function renderPlans() {
  const current = me?.user?.plan_slug || 'free';
  $('plansList').innerHTML = '';
  plans.forEach((p) => {
    const div = document.createElement('div');
    div.className = 'plan' + (p.slug === 'monthly' ? ' hot' : '') + (p.slug === current ? ' current' : '');
    const feats = Array.isArray(p.features) ? p.features : [];
    div.innerHTML = `<h3>${esc(p.name)}</h3><p class="price">${money(p.price, p.currency)}${p.slug === 'yearly' ? '<span>/yr</span>' : p.slug === 'weekly' ? '<span>/week</span>' : p.slug === 'monthly' ? '<span>/mo</span>' : ''}</p><p class="muted small">${esc(planLimits(p))}${p.duration_days ? ` · ${p.duration_days} days` : ''}</p>${feats.length ? `<ul>${feats.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}`;
    const btn = document.createElement('button');
    btn.className = 'btn ' + (p.slug === current ? 'secondary' : 'primary');
    btn.style.width = '100%';
    if (p.slug === current) { btn.textContent = '✓ Current plan'; btn.disabled = true; }
    else if (p.slug === 'free') { btn.textContent = 'Free plan'; btn.disabled = true; }
    else { btn.textContent = 'Subscribe →'; btn.addEventListener('click', () => subscribe(p)); }
    div.appendChild(btn);
    $('plansList').appendChild(div);
  });
}
async function subscribe(p) {
  $('planStatus').textContent = 'Creating a secure checkout…';
  let r;
  try { r = await api('/api/subscriptions/checkout', { method: 'POST', body: { plan_slug: p.slug } }); }
  catch (err) { $('planStatus').textContent = err.message; return; }
  if (r.status !== 200 || !r.data?.payment_session_id) { $('planStatus').textContent = 'Checkout failed: ' + apiError(r); return; }
  $('planStatus').textContent = 'Checkout opened — complete the payment, then your plan activates automatically.';
  await window.api.openCheckout({ paymentSessionId: r.data.payment_session_id, mode: r.data.mode || 'SANDBOX', orderId: r.data.order_id || r.data.cf_order_id });
  pollSubscription();
}
let pollTimer = null;
function pollSubscription() {
  clearInterval(pollTimer);
  let tries = 0;
  pollTimer = setInterval(async () => {
    tries++;
    try {
      const r = await api('/api/subscriptions/mine', {});
      if (r.status === 200 && r.data && r.data.status === 'active') {
        clearInterval(pollTimer);
        await refreshMe(); loadPlans();
        $('planStatus').textContent = '✅ Payment confirmed — welcome to the ' + (r.data.plan_slug || 'paid') + ' plan!';
      }
    } catch {}
    if (tries >= 24) clearInterval(pollTimer); // ~2 minutes
  }, 5000);
}
$('btnRefreshPlan').addEventListener('click', async () => {
  $('planStatus').textContent = 'Checking…';
  await refreshMe(); loadPlans();
  $('planStatus').textContent = 'Plan refreshed — you are on ' + ((me?.user?.plan_slug || 'free').toUpperCase()) + '.';
});
$('btnCancelPlan').addEventListener('click', async () => {
  let r;
  try { r = await api('/api/subscriptions/cancel', { method: 'POST', body: {} }); }
  catch (err) { $('planStatus').textContent = err.message; return; }
  if (r.status === 200) { $('planStatus').textContent = 'Subscription cancelled — you keep access until it expires.'; await refreshMe(); loadPlans(); }
  else $('planStatus').textContent = 'Cancel failed: ' + apiError(r);
});

// ---- Admin panel (role admin only) ----
async function loadAdmin() {
  if (!isAdmin()) return;
  try {
    const o = await api('/api/admin/overview', {});
    if (o.status === 200) {
      const d = o.data;
      $('adminOverview').innerHTML = `
        <div class="stat"><b>${d.users_total ?? '—'}</b><span>Users</span></div>
        <div class="stat"><b>${d.paying_users ?? '—'}</b><span>Paying users</span></div>
        <div class="stat"><b>${d.active_subscriptions ?? '—'}</b><span>Active subs</span></div>
        <div class="stat"><b>${money(d.revenue_total ?? 0, 'USD')}</b><span>Revenue</span></div>
        <div class="stat"><b>${d.ai_calls_today ?? '—'}</b><span>AI calls today</span></div>
        <div class="stat"><b>${d.free_users ?? '—'}</b><span>Free users</span></div>`;
    }
  } catch {}
  let users = [];
  try {
    const u = await api('/api/admin/users', {});
    if (u.status === 200 && Array.isArray(u.data)) {
      users = u.data;
      $('adminUsers').innerHTML = users.map((x) => `<tr>
        <td>${esc(x.name || '')}<br/><span class="muted">${new Date(x.created_at).toLocaleDateString()}</span></td>
        <td>${esc(x.email)}</td>
        <td><span class="pill ${x.role === 'admin' ? 'info' : ''}">${esc(x.role)}</span></td>
        <td>${esc(x.plan_slug || 'free')}<br/><span class="muted">${x.subscription?.status ? esc(x.subscription.status) : ''}</span></td>
        <td>${x.sessions_used ?? 0} sess · ${x.mocks_used ?? 0} mocks</td>
        <td>${x.subscription?.expires_at ? new Date(x.subscription.expires_at).toLocaleDateString() : '—'}</td>
        <td><button class="btn ghost" data-role="${x.id}|${x.role === 'admin' ? 'user' : 'admin'}">${x.role === 'admin' ? 'Make user' : 'Make admin'}</button></td>
      </tr>`).join('') || '<tr><td colspan="7" class="muted">No users yet.</td></tr>';
      $('adminUsers').querySelectorAll('[data-role]').forEach((b) => b.addEventListener('click', async () => {
        const [id, role] = b.dataset.role.split('|');
        const r = await api(`/api/admin/users/${id}`, { method: 'PATCH', body: { role } });
        if (r.status === 200) loadAdmin(); else $('grantStatus').textContent = 'Role change failed: ' + apiError(r);
      }));
      $('grantUser').innerHTML = users.map((x) => `<option value="${x.id}">${esc(x.name || x.email)} (${esc(x.email)})</option>`).join('');
    }
  } catch {}
  try {
    const s = await api('/api/admin/subscriptions', {});
    if (s.status === 200 && Array.isArray(s.data)) {
      $('adminSubs').innerHTML = s.data.slice(0, 50).map((x) => `<tr>
        <td>${esc(x.user_email || x.email || ('#' + x.user_id))}</td>
        <td>${esc(x.plan_slug)}</td>
        <td><span class="pill ${x.status === 'active' ? 'ok' : x.status === 'expired' ? 'warn' : 'bad'}">${esc(x.status)}</span></td>
        <td>${money(x.amount, x.currency)}</td>
        <td>${x.starts_at ? new Date(x.starts_at).toLocaleDateString() : '—'}</td>
        <td>${x.expires_at ? new Date(x.expires_at).toLocaleDateString() : '—'}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">No subscriptions yet.</td></tr>';
    }
  } catch {}
  try {
    const p = await api('/api/admin/payments', {});
    if (p.status === 200 && Array.isArray(p.data)) {
      $('adminPayments').innerHTML = p.data.slice(0, 50).map((x) => `<tr>
        <td>${esc(x.cf_order_id || '')}<br/><span class="muted">${esc(x.cf_payment_id || '')}</span></td>
        <td>${esc(x.plan_slug)}</td>
        <td>${money(x.amount, x.currency)}</td>
        <td><span class="pill ${x.status === 'success' ? 'ok' : x.status === 'pending' ? 'warn' : 'bad'}">${esc(x.status)}</span></td>
        <td>${x.created_at ? new Date(x.created_at).toLocaleString() : '—'}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="muted">No payments yet.</td></tr>';
    }
  } catch {}
  // Plans editor
  try {
    const pl = await api('/api/admin/plans', {});
    if (pl.status === 200 && Array.isArray(pl.data)) {
      $('adminPlans').innerHTML = '';
      $('grantPlan').innerHTML = pl.data.map((x) => `<option value="${x.slug}">${esc(x.name)}</option>`).join('');
      pl.data.forEach((p) => {
        const div = document.createElement('div');
        div.className = 'plan';
        div.style.marginBottom = '8px';
        div.innerHTML = `
          <div class="row">
            <label style="flex:2">Name <input data-f="name" value="${esc(p.name)}" /></label>
            <label style="flex:1">Price <input data-f="price" type="number" step="0.01" value="${p.price}" /></label>
            <label style="flex:1">Currency <input data-f="currency" value="${esc(p.currency || 'USD')}" /></label>
          </div>
          <div class="row">
            <label style="flex:1">Days <input data-f="duration_days" type="number" value="${p.duration_days ?? ''}" /></label>
            <label style="flex:1">Sessions <input data-f="sessions_limit" type="number" placeholder="blank = ∞" value="${p.sessions_limit ?? ''}" /></label>
            <label style="flex:1">Min/session <input data-f="minutes_per_session" type="number" placeholder="blank = ∞" value="${p.minutes_per_session ?? ''}" /></label>
            <label style="flex:1">Mocks <input data-f="mock_limit" type="number" placeholder="blank = ∞" value="${p.mock_limit ?? ''}" /></label>
          </div>
          <label>Features (comma separated) <input data-f="features" value="${esc(Array.isArray(p.features) ? p.features.join(', ') : '')}" /></label>
          <div class="row">
            <label class="switch"><input type="checkbox" data-f="active" ${p.active ? 'checked' : ''} /> Active</label>
            <span class="muted small">slug: ${esc(p.slug)}</span>
            <button class="btn primary">Save plan</button>
          </div>`;
        div.querySelector('button').addEventListener('click', async () => {
          const get = (f) => div.querySelector(`[data-f="${f}"]`);
          const numOrNull = (v) => (v === '' || v == null ? null : Number(v));
          const body = {
            name: get('name').value.trim(),
            price: Number(get('price').value || 0),
            currency: get('currency').value.trim() || 'USD',
            duration_days: numOrNull(get('duration_days').value),
            sessions_limit: numOrNull(get('sessions_limit').value),
            minutes_per_session: numOrNull(get('minutes_per_session').value),
            mock_limit: numOrNull(get('mock_limit').value),
            features: get('features').value.split(',').map((x) => x.trim()).filter(Boolean),
            active: get('active').checked,
          };
          const r = await api(`/api/admin/plans/${encodeURIComponent(p.slug)}`, { method: 'PUT', body });
          $('planEditStatus').textContent = r.status === 200 ? `Plan “${p.slug}” saved.` : 'Save failed: ' + apiError(r);
          if (r.status === 200) { loadPlans(); }
        });
        $('adminPlans').appendChild(div);
      });
    }
  } catch {}
  // Provider keys (masked) + models
  try {
    const pr = await api('/api/admin/providers', {});
    if (pr.status === 200) {
      const d = pr.data;
      $('provDefault').value = d.default_provider || 'groq';
      const masked = d.keys_masked || {};
      const labels = { groq: 'Groq', openai: 'ChatGPT (OpenAI)', gemini: 'Gemini (Google)', claude: 'Claude (Anthropic)' };
      $('provKeys').innerHTML = Object.keys(labels).map((k) => `
        <label>${labels[k]} API key <span class="muted">${masked[k] ? 'currently set (…' + esc(masked[k]) + ')' : 'not set'}</span>
          <input id="provKey_${k}" type="password" placeholder="Leave blank to keep current" autocomplete="off" /></label>`).join('');
      const models = d.models || {};
      $('provModels').innerHTML = Object.keys(models).length
        ? '<h3>Models</h3>' + Object.keys(models).map((k) => `
          <label>${esc(k)} <input id="provModel_${k}" value="${esc(models[k])}" /></label>`).join('')
        : '';
    }
  } catch {}
}
$('btnGrant').addEventListener('click', async () => {
  const userId = $('grantUser').value;
  const plan = $('grantPlan').value;
  const days = Number($('grantDays').value || 0);
  if (!userId || !plan) { $('grantStatus').textContent = 'Pick a user and a plan.'; return; }
  const r = await api(`/api/admin/users/${encodeURIComponent(userId)}/grant`, { method: 'POST', body: { plan_slug: plan, days: days || undefined } });
  $('grantStatus').textContent = r.status === 200 ? `Granted ${plan} access.` : 'Grant failed: ' + apiError(r);
  if (r.status === 200) loadAdmin();
});
$('btnNewPlan').addEventListener('click', async () => {
  const slug = $('newPlanSlug').value.trim();
  if (!slug) { $('planEditStatus').textContent = 'Slug is required.'; return; }
  const body = {
    slug, name: $('newPlanName').value.trim() || slug,
    price: Number($('newPlanPrice').value || 0), currency: 'USD',
    duration_days: Number($('newPlanDays').value || 0),
    sessions_limit: null, minutes_per_session: null, mock_limit: null,
    features: [], active: true, sort_order: plans.length + 1,
  };
  const r = await api('/api/admin/plans', { method: 'POST', body });
  $('planEditStatus').textContent = r.status === 200 || r.status === 201 ? `Plan “${slug}” created.` : 'Create failed: ' + apiError(r);
  if (r.status === 200 || r.status === 201) { $('newPlanSlug').value = ''; $('newPlanName').value = ''; $('newPlanPrice').value = ''; $('newPlanDays').value = ''; loadAdmin(); loadPlans(); }
});
$('btnSaveProviders').addEventListener('click', async () => {
  const body = { default_provider: $('provDefault').value };
  ['groq', 'openai', 'gemini', 'claude'].forEach((k) => {
    const el = $('provKey_' + k);
    if (el && el.value.trim()) body[k + '_key'] = el.value.trim();
  });
  document.querySelectorAll('#provModels input').forEach((el) => {
    const key = el.id.replace('provModel_', '');
    if (el.value.trim()) body[key] = el.value.trim();
  });
  const r = await api('/api/admin/providers', { method: 'PUT', body });
  $('provStatus').textContent = r.status === 200 ? 'Provider settings saved.' : 'Save failed: ' + apiError(r);
  if (r.status === 200) loadAiStatus();
});

// ---- Boot: settings, then auth (token -> /api/auth/me) ----
(async function boot() {
  await loadSettings();
  try {
    const m = await window.api.apiCall('/api/auth/me', {});
    if (m.status === 200 && m.data?.user) { enterApp(m.data); return; }
  } catch {}
  showAuth();
})();
