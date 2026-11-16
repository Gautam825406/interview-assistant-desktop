// Compact live overlay — display only. The main window is the engine
// (audio capture, transcription, answering) and streams every update
// here via 'live:update'. This window never talks to the backend and
// never names a top-level helper `api` — that would collide with the
// preload bridge `window.api` and kill the whole script.
const $ = (id) => document.getElementById(id);
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let startedAt = null;

// Own timer from the session start (no per-second IPC from the engine).
setInterval(() => {
  if (startedAt) $('liveTimer2').textContent = fmt(Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
}, 1000);

function renderLive(payload) {
  if (!payload) return;
  if (payload.startedAt) startedAt = payload.startedAt;
  if (payload.meta) $('liveMeta2').textContent = payload.meta;
  // Answer (plain text — the engine already split short / detailed).
  const ans = payload.answer || {};
  if (ans.short) $('liveAnswer').textContent = ans.short;
  $('liveDetail').textContent = ans.detail || '';
  $('liveAnsSource').textContent = ans.source || '';
  // Transcript — latest lines, questions highlighted, auto-scrolled.
  const lines = payload.transcript || [];
  if (lines.length) {
    $('liveTranscript').innerHTML = lines.map((t) => `<p class="${t.isQ ? 'q' : ''}">${t.isQ ? '❓ ' : ''}${esc(t.text)}</p>`).join('');
    $('liveTranscript').scrollTop = $('liveTranscript').scrollHeight;
  }
  // Status lines (audio state, screenshot step, one-off notes).
  if (payload.audioStatus) $('liveStatus').textContent = payload.audioStatus;
  if (payload.shotNote !== undefined) $('liveShotNote').textContent = payload.shotNote || '';
  if (payload.note) $('liveStatus').textContent = payload.note;
}

if (window.api?.onLiveUpdate) window.api.onLiveUpdate(renderLive);

$('btnLiveShot').addEventListener('click', () => window.api.liveScreenshot());
$('btnLiveAnswer').addEventListener('click', () => window.api.liveGetAnswer());
$('btnLiveEnd').addEventListener('click', () => window.api.liveEnd());
$('btnLiveHide').addEventListener('click', () => window.api.liveHide());
$('btnLiveClose').addEventListener('click', () => window.api.liveEnd());
