// Interview Assistant — renderer
let settings = { groqKey: '', model: 'openai/gpt-oss-120b', language: 'en', autoAnswer: true };
let resumeText = '';
let session = null; // { mode, company, role, jd, startedAt, qa: [], transcript: [] }
let liveSeconds = 0, liveTimerId = null;
let recognition = null, micStream = null, tabStream = null, mediaRecorder = null;
let mock = { topic: '', idx: 0, questions: [], answers: [] };

const $ = (id) => document.getElementById(id);
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const isDemo = () => !settings.groqKey;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function setModeBadge() {
  const b = $('modeBadge');
  if (isDemo()) { b.textContent = 'DEMO MODE'; b.className = 'badge demo'; }
  else { b.textContent = 'GROQ LIVE'; b.className = 'badge live'; }
}
function showView(name) {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
}
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

async function loadSettings() {
  settings = await window.api.settingsGet();
  $('setKey').value = settings.groqKey || '';
  $('setModel').value = settings.model || 'openai/gpt-oss-120b';
  $('setLang').value = settings.language || 'en';
  $('autoAnswer').checked = settings.autoAnswer !== false;
  setModeBadge();
  refreshSaved();
}
$('btnSaveSettings').addEventListener('click', async () => {
  settings = { groqKey: $('setKey').value.trim(), model: $('setModel').value, language: $('setLang').value, autoAnswer: $('autoAnswer').checked };
  await window.api.settingsSave(settings);
  setModeBadge();
  $('setStatus').textContent = isDemo() ? 'Saved. No key → Demo Mode (canned answers).' : 'Saved. Groq key set — live AI answers enabled.';
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

// ---- Sessions ----
function startSession(kind) {
  session = {
    mode: $('sessMode').value, company: $('sessCompany').value.trim(), role: $('sessRole').value.trim(),
    jd: $('sessJD').value.trim(), language: $('sessLang').value,
    startedAt: new Date().toISOString(), qa: [], transcript: [],
  };
  liveSeconds = 0;
  $('liveMeta').textContent = `${session.mode === 'interview' ? '🎯 Interview' : '📞 Regular call'} · ${session.company || '—'} · ${session.role || '—'} · started ${new Date().toLocaleTimeString()} · ${isDemo() ? 'Demo Mode' : 'Groq live'}`;
  $('notesCard').hidden = true;
  clearInterval(liveTimerId);
  liveTimerId = setInterval(() => { liveSeconds++; $('liveTimer').textContent = fmt(liveSeconds); }, 1000);
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

// ---- Live: question -> answer ----
function addTranscript(text, isQ) {
  if (!session) startSession('live');
  session.transcript.push({ t: new Date().toISOString(), text, isQ: !!isQ });
  const p = document.createElement('p');
  p.className = isQ ? 'q' : '';
  p.textContent = (isQ ? '❓ ' : '') + text;
  $('transcript').appendChild(p);
  $('transcript').scrollTop = $('transcript').scrollHeight;
}

async function answerQuestion(question) {
  addTranscript(question, true);
  $('ansSource').textContent = '…thinking';
  $('answerBox').textContent = 'Generating answer…';
  $('answerDetail').textContent = '';
  let result;
  if (isDemo()) {
    result = window.demoAnswer(question);
  } else {
    const sys = `You are a discreet real-time interview assistant. The candidate is in a live ${session?.mode || 'interview'} for ${session?.role || 'a role'} at ${session?.company || 'a company'}. Resume:\n${resumeText.slice(0, 6000)}\n\nJob description / instructions:\n${(session?.jd || '').slice(0, 8000)}\n\nGive a concise speakable answer first (2-4 sentences), then a fuller version. If it is a coding question, give approach + complexity + short code. If system design, end with a small text flowchart. Answer in ${session?.language || 'en'}.`;
    const r = await window.api.groqChat({ key: settings.groqKey, model: settings.model, messages: [{ role: 'system', content: sys }, { role: 'user', content: question }] });
    if (r.ok) {
      const parts = r.text.split(/\n\n+/);
      result = { short: parts[0] || r.text, detailed: parts.slice(1).join('\n\n'), source: `Groq · ${settings.model}` };
    } else {
      result = { short: `Groq error: ${r.error}. Falling back to Demo Mode.`, detailed: window.demoAnswer(question).detailed, source: 'Demo fallback' };
    }
  }
  $('answerBox').textContent = result.short;
  $('answerDetail').textContent = result.detailed || '';
  $('ansSource').textContent = `— ${result.source}`;
  session.qa.push({ q: question, short: result.short, detailed: result.detailed, at: new Date().toISOString() });
}
$('btnAsk').addEventListener('click', () => { const q = $('qInput').value.trim(); if (q) { $('qInput').value = ''; answerQuestion(q); } });
$('qInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnAsk').click(); });
document.querySelectorAll('.demo-q').forEach((b) => b.addEventListener('click', () => answerQuestion(b.dataset.q)));

// Mic: browser speech recognition (Chrome) as a no-key transcription path
$('btnMic').addEventListener('click', async () => {
  if (recognition) { recognition.stop(); recognition = null; $('btnMic').textContent = '🎙️ Mic: off'; return; }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      recognition = new SR(); recognition.continuous = true; recognition.interimResults = true;
      recognition.lang = (session?.language || 'en') === 'hi' ? 'hi-IN' : 'en-US';
      recognition.onresult = (e) => {
        const last = e.results[e.results.length - 1];
        if (last.isFinal) { const text = last[0].transcript.trim(); addTranscript(text, window.isQuestion(text)); if (window.isQuestion(text) && $('autoAnswer').checked) answerQuestion(text); }
      };
      recognition.start();
      $('btnMic').textContent = '🎙️ Mic: listening… (click to stop)';
    } else {
      addTranscript('Speech recognition not available in this build — type the question, or add a Groq key and use tab-audio Whisper.', false);
      micStream.getTracks().forEach((t) => t.stop());
    }
  } catch (err) { addTranscript(`Mic error: ${err.message}. Allow microphone access and retry.`, false); }
});

// Tab audio: capture a Meet / Zoom browser tab (audio only), Whisper via Groq when key set
$('btnTabAudio').addEventListener('click', async () => {
  try {
    tabStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    addTranscript('Tab capture started — share the Google Meet / Zoom tab (tick “Share audio”). Video is used only to pick the tab; it is never uploaded.', false);
    if (!settings.groqKey) { addTranscript('No Groq key: tab audio cannot be transcribed yet. Add a key in Settings, or use Mic / type the question.', false); return; }
    mediaRecorder = new MediaRecorder(tabStream, { mimeType: 'audio/webm' });
    mediaRecorder.ondataavailable = async (e) => {
      if (!e.data.size) return;
      const b64 = await e.data.arrayBuffer().then((b) => { let s = ''; const u = new Uint8Array(b); for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(s); });
      const r = await window.api.groqTranscribe({ key: settings.groqKey, base64: b64, mime: 'audio/webm' });
      if (r.ok && r.text.trim()) { const t = r.text.trim(); addTranscript(t, window.isQuestion(t)); if (window.isQuestion(t) && $('autoAnswer').checked) answerQuestion(t); }
    };
    mediaRecorder.start(8000); // 8-second Whisper chunks
    tabStream.getVideoTracks()[0]?.addEventListener('ended', () => { mediaRecorder?.stop(); addTranscript('Tab capture stopped.', false); });
  } catch (err) { addTranscript(`Tab capture cancelled / failed: ${err.message}`, false); }
});

// Screenshot (code problems on screen)
$('btnShot').addEventListener('click', async () => {
  const sources = await window.api.captureSources();
  if (!sources.length) return;
  $('shotBox').innerHTML = `<p class="muted small">Latest screen (${esc(sources[0].name)}). Type the problem text under it and press Answer — screenshots are kept locally, never uploaded.</p><img src="${sources[0].thumbnail}" />`;
});

// End session -> AI notes
$('btnEnd').addEventListener('click', async () => {
  clearInterval(liveTimerId);
  recognition?.stop(); recognition = null;
  mediaRecorder?.stop(); tabStream?.getTracks().forEach((t) => t.stop()); micStream?.getTracks().forEach((t) => t.stop());
  $('btnMic').textContent = '🎙️ Mic: off';
  if (!session) return;
  const qs = session.qa.map((x) => x.q);
  let notes;
  if (!isDemo() && qs.length) {
    const r = await window.api.groqChat({ key: settings.groqKey, model: settings.model, messages: [{ role: 'user', content: `Summarise this interview in bullets: key points discussed, decisions, action items / follow-ups.\nQuestions:\n${qs.join('\n')}\nTranscript:\n${session.transcript.map((t) => t.text).join('\n').slice(0, 6000)}` }] });
    notes = r.ok ? r.text : `Questions asked (${qs.length}):\n- ${qs.join('\n- ')}\n\nDuration: ${fmt(liveSeconds)}.`;
  } else {
    notes = qs.length
      ? `Key points:\n- ${qs.length} question(s) answered in ${fmt(liveSeconds)}.\n- ${qs.map((q) => `Q: ${q}`).join('\n- ')}\n\nAction items:\n- Review any answer you were unsure about and revise it before the next round.\n- Save the job description and re-run a mock on the weakest topic.`
      : 'No questions were asked in this session.';
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

// ---- Mock interview ----
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
$('btnMockStart').addEventListener('click', startMock);
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
  if (isDemo()) {
    const good = a.length > 120;
    $('mockFeedback').innerHTML = `<p><b>Demo feedback:</b> ${good ? 'Good length and structure. Add one concrete project example with a number to make it stronger.' : 'Too short — aim for 3–4 sentences: point, evidence, result. Add a real example.'}</p><p class="muted small">Add a Groq key in Settings for detailed, question-specific feedback.</p>`;
  } else {
    const r = await window.api.groqChat({ key: settings.groqKey, model: settings.model, messages: [{ role: 'user', content: `You are an interviewer. Question: ${q}\nCandidate answer: ${a}\nGive a score out of 10, 2 strengths, 2 improvements, and a model answer in 3-4 sentences.` }] });
    $('mockFeedback').innerHTML = r.ok ? `<pre style="white-space:pre-wrap;font-family:inherit">${esc(r.text)}</pre>` : `<p>Groq error: ${esc(r.error)}</p>`;
  }
});
$('btnMockEnd').addEventListener('click', async () => {
  clearInterval(mock.timerId);
  if ($('mockA').value.trim()) mock.answers.push({ q: mock.questions[mock.idx], a: $('mockA').value.trim() });
  $('mockFeedback').innerHTML += `<p><b>Mock finished:</b> ${mock.answers.length} answer(s) in topic “${esc(mock.topic)}”. Practice the weakest one again tomorrow.</p>`;
  if (session) { session.qa = mock.answers.map((x) => ({ q: x.q, short: x.a, detailed: '' })); await window.api.sessionsSave({ ...session, mode: 'mock', company: mock.topic, role: 'Mock Interview' }); refreshSaved(); }
  $('btnMockNext').disabled = true; $('btnMockEnd').disabled = true;
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
  $('bankList').innerHTML = BANK[$('bankCompany').value].map((q) => `<p>• <a href="#" data-q="${esc(q)}" style="color:#93c5fd">${esc(q)}</a></p>`).join('');
  $('bankList').querySelectorAll('a').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); showView('live'); $('qInput').value = a.dataset.q; answerQuestion(a.dataset.q); }));
}
$('bankCompany').addEventListener('change', renderBank);
renderBank();

loadSettings();
