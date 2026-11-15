# Interview Assistant — Desktop App (Windows / macOS)

A Parakeet-AI-style real-time interview helper for the person **giving** the
interview. During a Google Meet / Zoom call it listens to the interviewer's
audio, detects the question, and shows a suggested answer in a small,
discreet, always-on-top window.

> ⚠️ **Use only where live assistance is permitted.** Check the interviewer's
> / company's rules first. This app is built for mock interviews, practice,
> sales calls, and meetings where AI help is allowed — not for breaking
> interview rules.

## What it does

- **Live session** — Interview mode (uses your resume) or Regular-call mode
- **Audio** — microphone (browser speech recognition, no key needed) and
  Google Meet / Zoom **browser-tab audio** via screen/tab capture, transcribed
  with Groq Whisper when a key is set
- **Auto Answer** — detects questions in the live transcript (question mark /
  interrogative start) and shows a short speakable answer + a detailed version
- **Code help** — screenshot button captures the current screen; type the
  problem text and get approach + complexity + code
- **System design** — answers end with a small text flowchart
- **AI Notes** — key points, decisions and action items after the call
- **Saved sessions** — stored locally as JSON in the app's `userData` folder
- **Mock Interview** — AI interviewer asks 5 questions on a topic, evaluates
  your answers, saves the mock
- **Question Bank** — company-wise sample questions (Google, Amazon,
  Microsoft, Flipkart, TCS/Infosys, GenAI roles)
- **Pricing screen** — Parakeet-style plans, display only, no real payment

## Privacy / screen-share — read this

- The window is **frameless, always-on-top, minimisable to the tray**, with
  `setContentProtection(true)` in Electron. On Windows that sets
  `WDA_EXCLUDEFROMCAPTURE`, on macOS it excludes the window from normal
  screen capture / screen-share.
- **That is not invisibility.** It does **not** hide the app from Task Manager
  / Activity Monitor, and it does **not** defeat proctoring or
  interview-detection software (several vendors specifically detect these
  tools). The in-app UI says this plainly — do not rely on it to hide.
- Hotkeys: `Ctrl+Shift+I` show/hide · `Ctrl+Shift+P` toggle Private mode ·
  `Ctrl+Shift+M` minimise. (Cmd instead of Ctrl on macOS.)

## Run it (Windows — primary)

```bat
npm install
npm start
```

On first run the app opens as a small floating window. Use **Settings** to
add your Groq key (see below), then **Home → Start live session**.

## Add a Groq API key (for real AI answers)

1. Go to https://console.groq.com → API Keys → create a free key.
2. In the app: **Settings → Groq API key → paste → Save settings**.
3. The key is stored only in the app's local `userData/settings.json` on your
   machine. It is **never** in the code, never committed (see `.gitignore`),
   and never sent anywhere except api.groq.com.

Default model: `openai/gpt-oss-120b`. Transcription: Groq Whisper
`whisper-large-v3-turbo`.

**Without a key the app runs in Demo Mode:** answers come from a local
question bank (DSA, GenAI/RAG, HR, system design, SQL, Python). The whole
flow — start session → question → answer → notes → save — works without a
key, so you can test it end to end.

## Capturing Meet / Zoom audio

Working path (no extra software):

1. Join the call **in Chrome** (Google Meet web, or Zoom web client).
2. In the app, Live view → **Capture Meet / Zoom tab audio** → pick the
   browser tab and tick **“Share audio”**.
3. With a Groq key set, audio is transcribed in ~8-second chunks by Whisper;
   detected questions trigger an answer automatically.

**Known limit — Zoom desktop app:** Electron / the browser cannot capture
another app's audio directly. Capturing the **Zoom desktop app's** audio
needs a virtual audio driver (e.g. VB-Audio Virtual Cable on Windows, or
BlackHole on macOS): route Zoom's speaker output through the virtual cable
and set that cable as the app's mic input. That is not built in yet — use
the browser-tab path above, which works today.

## Build the Windows installer (.exe)

This Linux VM cannot reliably produce a signed Windows `.exe`, so the
installer is built by GitHub Actions:

1. Push this folder to a GitHub repo.
2. **Actions → Build Windows installer** runs on `windows-latest` and builds
   with `electron-builder` (NSIS).
3. Download the artifact: `Interview-Assistant-Setup-<version>.exe` from the
   run's Artifacts, or the release asset if you tag a release.

Locally (on a Windows / Mac machine):

```bat
npm run dist:win     :: Windows NSIS installer -> dist/
npm run dist:mac     :: macOS .dmg -> dist/
npm run dist         :: current platform
```

## Project layout

```
src/
  main.js            Electron main process: frameless overlay, tray,
                     global hotkeys, content protection, Groq + Whisper IPC,
                     resume parsing, local session storage
  preload.js         Secure contextBridge API for the renderer
  renderer/
    index.html       Dashboard / Live / Mock / Question Bank / Pricing / Settings
    styles.css
    renderer.js      Session flow, mic + tab audio, Auto Answer, notes, mock
    demo-bank.js     Demo Mode canned answers (no key needed)
    icon.png         Tray / app icon
.github/workflows/build.yml   Windows + macOS builds on GitHub Actions
```

## What is NOT done yet

- True system-audio capture from the Zoom **desktop** app (needs a virtual
  audio driver — see above).
- Real payments / subscriptions (Pricing is display-only).
- Native installers built on this VM (use GitHub Actions — see above).
- Voice-interviewer speech in Mock mode (questions are text; answers are
  typed or spoken via the mic transcript path).
