// Interview Assistant — renderer
let settings = { groqKey: '', model: 'openai/gpt-oss-120b', language: 'en', autoAnswer: true };
let resumeText = '';
let session = null; // { mode, company, role, jd, startedAt, qa: [], transcript: [] }
let liveSeconds = 0, liveTimerId = null;
let recognition = null, micStream = null, tabStream = null, mediaRecorder = null;
let micRecorder = null;
let sysStream = null, sysRecorder = null;
let whisperBusy = false, whisperQueue = [], lastWhisperText = '', noKeyWarned = false, whisperErrorShown = false;
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

// ---------- audio engine: any source -> Whisper transcription ----------
// Electron's Chromium has NO SpeechRecognition (no Google speech service),
// so the mic cannot use it here at all. All audio goes through Groq
// Whisper in 5-second chunks (free Groq key in Settings). SpeechRecognition
// is kept only as a bonus fast path if this Chromium ever provides it.
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
    if (!settings.groqKey) {
      if (!noKeyWarned) { noKeyWarned = true; addTranscript('Audio needs a free Groq key for transcription — add it in Settings (console.groq.com → API Keys), then restart capture.', false); }
      continue;
    }
    const r = await window.api.groqTranscribe({ key: settings.groqKey, base64: await blobToBase64(blob), mime: mime || 'audio/webm' });
    if (!r.ok) {
      // Don't flood the transcript with the same error every 5 seconds.
      if (!whisperErrorShown) { whisperErrorShown = true; addTranscript(`Transcription error: ${r.error}`, false); }
      else audioStatus(`⚠️ Transcription error: ${r.error}`);
      continue;
    }
    const t = (r.text || '').trim();
    if (!t || t.length < 2 || t === lastWhisperText) continue; // skip silence / repeats
    lastWhisperText = t;
    addTranscript(`${label}: ${t}`, window.isQuestion(t));
    audioStatus(`🎧 Last heard ${new Date().toLocaleTimeString()} — ${label}`);
    if (window.isQuestion(t) && $('autoAnswer').checked) answerQuestion(t);
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

// Mic: SpeechRecognition if present, otherwise Whisper (the normal case in Electron)
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
        if (last.isFinal) { const text = last[0].transcript.trim(); if (text) { addTranscript(text, window.isQuestion(text)); if (window.isQuestion(text) && $('autoAnswer').checked) answerQuestion(text); } }
      };
      recognition.onend = () => { if (micStream) { try { recognition.start(); } catch {} } }; // Chrome stops after pauses
      recognition.onerror = (e) => { if (e.error === 'not-allowed') { addTranscript('Mic blocked — allow microphone access and retry.', false); stopAllAudio(); } };
      recognition.start();
      $('btnMic').textContent = '🎙️ Mic: listening… (click to stop)';
      audioStatus('🎙️ Mic on — listening…');
    } else {
      // Electron has no SpeechRecognition — this is the expected path here.
      if (!settings.groqKey) { addTranscript('Mic transcription needs a free Groq key in Settings — Electron has no built-in speech recognition. Add the key, then start the mic again.', false); micStream.getTracks().forEach((t) => t.stop()); micStream = null; return; }
      micRecorder = startWhisperRecorder(micStream, 'You');
      if (!micRecorder) { addTranscript('Mic recorder could not start in this build.', false); return; }
      $('btnMic').textContent = '🎙️ Mic: listening (Whisper)… (click to stop)';
      addTranscript('Mic listening (Whisper)… speak and the transcript will appear in ~5 second chunks.', false);
      audioStatus('🎙️ Mic on (Whisper) — listening…');
    }
  } catch (err) { addTranscript(`Mic error: ${err.message}. Allow microphone access and retry.`, false); }
});

// Tab audio: capture a Meet / Zoom browser tab, transcribe it with Whisper
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
    if (!settings.groqKey) { addTranscript('No Groq key: tab audio cannot be transcribed yet. Add a key in Settings, then restart capture.', false); return; }
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
  if (!settings.groqKey) { addTranscript('System audio needs a Groq key for transcription — add it in Settings first.', false); return; }
  try {
    const sources = await window.api.captureSources();
    const screen = sources.find((s) => s.id.startsWith('screen:'));
    if (!screen) { addTranscript('No screen source found for system audio.', false); return; }
    sysStream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: screen.id } },
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: screen.id, maxWidth: 1, maxHeight: 1 } },
    });
    if (!sysStream.getAudioTracks().length) {
      addTranscript('System audio loopback gave no audio track on this machine — use the Meet/Zoom tab capture instead, or a virtual audio cable (see README).', false);
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

// Screenshot: capture the screen, READ the question in it with Groq vision,
// then answer it — no typing needed.
$('btnShot').addEventListener('click', async () => {
  if (!settings.groqKey) {
    $('shotBox').innerHTML = '<p class="muted small">Screenshot reading needs a Groq key in Settings — add it, then tap Screenshot again. Without a key, type the problem in the question box instead.</p>';
    return;
  }
  $('shotBox').innerHTML = '<p class="muted small">📸 Capturing screen…</p>';
  try {
    const sources = await window.api.captureSources();
    if (!sources.length) { $('shotBox').innerHTML = '<p class="muted small">No screen found to capture.</p>'; return; }
    const shot = sources.find((s) => s.id.startsWith('screen:')) || sources[0];
    $('shotBox').innerHTML = `<img src="${shot.thumbnail}" /><p class="muted small">📸 Reading the screenshot…</p>`;
    const r = await window.api.groqVision({ key: settings.groqKey, image: shot.thumbnail });
    if (!r.ok) { $('shotBox').innerHTML += `<p class="muted small">Could not read the screenshot: ${esc(r.error)}</p>`; return; }
    const q = (r.text || '').trim();
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

// End session -> AI notes
$('btnEnd').addEventListener('click', async () => {
  clearInterval(liveTimerId);
  stopAllAudio();
  audioStatus('Session ended.');
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
