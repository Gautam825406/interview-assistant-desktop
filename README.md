# Interview Assistant — Desktop App (Windows / macOS) — SaaS client

A real-time interview helper for the person **giving** the
interview. During a Google Meet / Zoom call it listens to the interviewer's
audio, detects the question, and shows a suggested answer in a small,
discreet, always-on-top window.

This is the **SaaS client** (v0.2.0): users sign up / log in, subscribe via
Cashfree, and use the app. All AI runs on the service backend — **no API
keys live in this app, and there is no Demo Mode**. The service owner sets
provider keys (Groq / OpenAI / Gemini / Claude) and prices in the Admin
panel; end users just use the app.

> ⚠️ **Use only where live assistance is permitted.** Check the interviewer's
> / company's rules first. This app is built for mock interviews, practice,
> sales calls, and meetings where AI help is allowed — not for breaking
> interview rules.

## What it does

- **Auth first** — Login / Signup on launch. JWT stored in the app's
  `userData/settings.json`. 401 returns to the login screen. No app use
  without login.
- **Transparent glass window** — frameless, always-on-top overlay with a
  frosted-glass UI (`transparent: true`, `backgroundColor: '#00000000'`).
  Toggle transparent / solid in Settings (or the tray menu); toggling
  rebuilds the window.
- **Live session** — Interview mode (uses your resume) or Regular-call mode.
  Start calls `POST /api/sessions/start`; the free plan is capped at
  10 sessions × 10 min, paid plans are unlimited. A 402 shows an upgrade
  prompt that links to Pricing.
- **Audio** — microphone, Google Meet / Zoom **browser-tab audio**, and
  system audio (Zoom desktop app via screen loopback), all transcribed by
  the backend (`POST /api/ai/transcribe`, Whisper, ~5-second standalone
  chunks — the chunking fix from v0.1 still applies).
- **Auto Answer** — detects questions in the live transcript and shows a
  short speakable answer + a detailed version via `POST /api/ai/chat`,
  grounded in your resume + JD.
- **Screenshot** — captures the screen, the backend reads the question
  (`POST /api/ai/vision`) and answers it — no typing needed.
- **AI Notes** — key points, decisions and action items after the call
  (via the backend).
- **Saved sessions** — stored locally as JSON in the app's `userData` folder.
- **Mock Interview** — `POST /api/mocks/start` first (free plan: 1 mock),
  then the backend evaluates each answer.
- **Question Bank** — company-wise sample questions (Google, Amazon,
  Microsoft, Flipkart, TCS/Infosys, GenAI roles).
- **Pricing** — plans from `GET /api/plans`. Subscribe opens a Cashfree
  checkout window (Cashfree JS SDK, prod/sandbox per the backend's mode);
  after paying, “Verify my plan” calls `GET /api/subscriptions/verify` and
  the app polls `GET /api/subscriptions/mine` for activation. The Cashfree
  webhook activates the subscription server-side even if the window closes.
- **Admin panel** (admin role only) — overview cards (users, paying users,
  active subs, revenue, AI calls today, free users), users table with
  role change, grant-access action, subscriptions + payments tables, plans
  editor (price / limits / features / active), provider keys form
  (password inputs, keys shown masked, blank = keep current).

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

## Run it

```bat
npm install
npm start
```

On first run the app shows the **Login / Signup** screen. The backend must
be reachable (default `https://interview-assistant-api.onrender.com`,
overridable in Settings → API base URL). The first account registered on
the service becomes the Admin.

## Capturing Meet / Zoom audio

Working path (no extra software):

1. Join the call **in Chrome** (Google Meet web, or Zoom web client).
2. In the app, Live view → **Capture Meet / Zoom tab audio** → pick the
   browser tab and tick **“Share audio”**.
3. Audio is transcribed in ~5-second chunks by the backend; detected
   questions trigger an answer automatically.

**Known limit — Zoom desktop app:** Electron / the browser cannot capture
another app's audio directly. Capturing the **Zoom desktop app's** audio
needs a virtual audio driver (e.g. VB-Audio Virtual Cable on Windows, or
BlackHole on macOS): route Zoom's speaker output through the virtual cable
and set that cable as the app's mic input. The in-app **System audio**
button tries screen loopback first, which works on some machines.

## Build the Windows installer (.exe)

This Linux VM cannot reliably produce a signed Windows `.exe`, so the
installer is built by GitHub Actions:

1. Push this folder to a GitHub repo.
2. **Actions → Build Windows installer** runs on `windows-latest` and builds
   with `electron-builder` (NSIS).
3. Download the artifact: `Interview-Assistant-Setup-<version>.exe` from the
   run's Artifacts.

Locally (on a Windows / Mac machine):

```bat
npm run dist:win     :: Windows NSIS installer -> dist/
npm run dist:mac     :: macOS .dmg -> dist/
npm run dist         :: current platform
```

## Project layout

```
src/
  main.js            Electron main: transparent overlay, tray, hotkeys,
                     content protection, backend API proxy (Bearer in main),
                     auth, checkout window, resume parsing, local sessions
  preload.js         Secure contextBridge API for the renderer
  renderer/
    index.html       Auth / Dashboard / Live / Mock / Bank / Pricing / Admin / Settings
    styles.css       Glassmorphism UI (transparent window + solid mode)
    renderer.js      Auth, plan-gated sessions, audio engine, Auto Answer,
                     screenshot, notes, mock, pricing + checkout, admin panel
    checkout.js      Cashfree JS SDK checkout + verify
    checkout.html    Checkout window shell
    icon.png         Tray / app icon
.github/workflows/build.yml   Windows + macOS builds on GitHub Actions
```

## What is NOT done yet

- True system-audio capture from the Zoom **desktop** app (needs a virtual
  audio driver — see above).
- In-app Cashfree SDK is loaded from Cashfree's CDN at checkout time; if
  the CDN is unreachable the checkout window shows the error and the user
  can retry. No offline fallback.
- Voice-interviewer speech in Mock mode (questions are text; answers are
  typed or spoken via the mic transcript path).
- Native installers built on this VM (use GitHub Actions — see above).
