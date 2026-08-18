# Overlay Player

A floating, always-on-top AI assistant that sits above whatever else you are
doing. Ask a question, read the answer, get back to work — without switching
away from the app you're in. One codebase: a Next.js app (UI **and** backend
API) rendered inside an Electron window. Built for macOS first, packages for
Windows from the same source.

Single user by design — no accounts, no auth, no server of your own. Your keys
and settings live in files inside the app's own data directory.

## Quick start

```bash
npm install
npm run dev
```

`npm run dev` starts `next dev` on port 3000 and opens the Electron overlay once
the server is up. Paste an API key in the 🔑 panel and ask a question.

## What it does

- **Bring your own key** for **Claude**, **ChatGPT**, or **Gemini** — whichever
  you have. Switch providers from the key panel at any time.
- **Streams answers** token by token, with a stop button mid-answer.
- **Ask by voice** — `⌘⌥S` records the default microphone, transcribes it, and
  sends the question without you typing. See [Speech to text](#speech-to-text).
- **`⌘⇧A` from any app** reveals the overlay with the caret already in the
  question box.
- **Always on top**, above every app including full-screen VS Code, Chrome and
  Safari. On macOS the window is backed by an `NSPanel` (`type: 'panel'`), which
  is what allows it to float over another app's full-screen Space — a plain
  always-on-top window cannot. The pin is re-applied on show, on blur, and on
  any display change, because macOS quietly drops it in all three cases.
- **Present on every Space**, and `⌘⇧M` jumps it to whichever monitor your
  cursor is on. A window only ever lives on one physical display at a time, so
  multi-monitor is an explicit move rather than automatic.
- **Always excluded from screen capture** — the window is left out of screen
  shares, recordings and screenshots, with no toggle to switch it off. See
  [Screen-capture exclusion](#screen-capture-exclusion) for what that does and
  does not cover.
- **See-through** — opacity starts at 95% so whatever is behind the overlay
  stays readable. The slider goes from 20% to fully opaque.
- **Click-through mode** — the window goes ghost and your clicks land on the app
  underneath.
- **Frameless and draggable** by its toolbar; resize from the bottom-right grip.
- **Tray icon** to show/hide/quit, since the window has no title bar.
- Remembers window position, size, opacity, and your provider choice.

### Models

The model name is a free-text field per provider, so you can point it at
anything your account can use rather than waiting for this app to add it. Leave
it blank to use the provider's default.

`OPENAI_BASE_URL` redirects the ChatGPT provider at any OpenAI-compatible
endpoint — a local model server, Azure OpenAI, OpenRouter.

### Shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘⇧A` / `Ctrl+Shift+A` | Show the overlay and focus the question box |
| `⌘⇧Y` / `Ctrl+Shift+Y` | Show / hide the overlay |
| `⌘⇧C` / `Ctrl+Shift+C` | Toggle click-through |
| `⌘⌥S` / `Ctrl+Alt+S` | Start / stop dictation |
| `⌘⇧M` / `Ctrl+Shift+M` | Move the overlay to the screen your cursor is on |
| `⌘⇧↑` / `⌘⇧↓` | Opacity up / down |
| `⌘⇧←` / `⌘⇧→` | Nudge the window left / right |
| `Enter` | Send · `Shift+Enter` for a newline |

## Speech to text

Press `⌘⌥S` from any app, or the mic button in the composer, and the overlay
records until you press it again. The take is transcribed and sent as your next
question — no typing.

Recording uses `getUserMedia` with no device filter, so it follows whatever the
OS has set as the **default input**: the built-in laptop microphone unless you
have selected something else system-wide. The microphone is released after every
take rather than held open between questions.

**Dictation needs a ChatGPT key**, even if answers come from Claude or Gemini.
Of the three providers, OpenAI's transcription endpoint is the only one that
accepts the recorder's WebM/Opus audio directly — Gemini's inline-audio input
takes wav/mp3/ogg/flac but not WebM, and Claude has no audio input at all.
`OPENAI_TRANSCRIBE_MODEL` overrides the model (default `whisper-1`), and
`OPENAI_BASE_URL` points it at a local Whisper server if you would rather not
send audio anywhere.

macOS asks for microphone permission the first time. If you refuse it, the grant
lives in System Settings › Privacy & Security › Microphone.

> **The mic indicator is not hidden.** While recording, macOS shows its orange
> dot in the menu bar and Control Center. The overlay window is excluded from
> screen capture; that indicator is not, and it is plainly visible to anyone
> watching a share of your full screen. Recording other people may also need
> their consent depending on where you are.

## Screen-capture exclusion

The overlay asks the OS window server to leave it out of captures
(`setContentProtection`), which is the same mechanism password managers use to
keep a vault out of a recording. It is **always on**: there is deliberately no
toggle, no tray item and no shortcut, so it cannot be switched off by accident.
The flag is re-asserted whenever the window is shown, loses focus, or the
display configuration changes, because macOS drops native window flags in all
three cases.

- **macOS** — `NSWindowSharingNone`. Honoured by ScreenCaptureKit and the older
  CGWindowList path, which is what Zoom, Meet, Teams, Slack, QuickTime and `⌘⇧5`
  all capture through.
- **Windows** — `WDA_EXCLUDEFROMCAPTURE` on Windows 10 2004 and later, where the
  window is simply absent. Older builds can only black the region out, which is
  more conspicuous than leaving it visible.

This is a window-server flag, not magic. Anything capturing outside that path
still sees the overlay: a phone camera pointed at your screen, an HDMI capture
box, a remote-control tool that mirrors the framebuffer at driver level, or a
proctoring agent that reads the window list rather than the pixels. Verify it on
your own machine before relying on it — press `⌘⇧5`, take a screenshot, and see
whether the overlay is in the image.

Worth stating plainly: hiding the window from a capture does not hide the app
from the machine. Any process that enumerates running applications — which is
what interview-proctoring and exam-lockdown software is built to do — still sees
it by name.

## About your API keys

Keys are stored in `keys.json` in the app's data directory, written with
owner-only permissions (`0600`), separate from `settings.json`. They are read
server-side to call the provider and are **never** sent to the renderer — the UI
only ever learns *whether* a key is set, not what it is.

This is plaintext on disk: the same trust model as `~/.netrc` or any CLI config
file. Anything running as your user account can read it. Don't put a key here
you wouldn't put in a dotfile. Alternatively, set `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, or `GEMINI_API_KEY` in the environment and the app will use
those instead, writing nothing to disk.

## How it fits together

```
electron/main.js       Overlay window, tray, global shortcuts, boots the server
electron/preload.js    The only bridge to the renderer (contextIsolation on)
src/app/               Next.js App Router — the UI
src/app/api/chat/      Streams a reply from the selected provider
src/app/api/keys/      Stores API keys; reports presence, never values
src/app/api/settings/  Window and provider preferences
src/app/api/transcribe/ Speech to text for the dictation button
src/lib/chat.ts        Per-provider streaming
src/lib/providers.ts   Provider registry and defaults
src/lib/secrets.ts     Key storage (0600, server-side only)
src/lib/settings.ts    Settings shape + defaults, shared by client and server
src/lib/store.ts       JSON persistence in the app's data directory
src/lib/transcribe.ts  Audio -> text via OpenAI's transcription endpoint
src/lib/useDictation.ts Microphone capture in the renderer
scripts/               Icon generation + standalone server assembly
```

`src/lib/settings.ts` is deliberately free of Node imports: the client shares it
with the server, and importing `store.ts` from a client component would drag
`node:fs` into the browser bundle and fail the build.

**In development**, Electron attaches to `next dev` on port 3000.

**In production**, `next build` runs with `output: 'standalone'`, producing a
self-contained `server.js`. `scripts/prepare-server.mjs` combines it with the
static assets, electron-builder ships it as `resources/server`, and
`electron/main.js` boots it on a free port using Electron's own bundled Node —
so users never need Node installed.

State lives in Electron's `userData` directory, passed to the server as
`APP_DATA_DIR`:

- macOS — `~/Library/Application Support/Overlay Player/`
- Windows — `%APPDATA%\Overlay Player\`

## Building installers

```bash
npm run dist:mac    # .dmg + .zip (arm64 + x64) → release/
npm run dist:win    # NSIS installer (x64 + arm64) → release/
```

Mac builds are unsigned (`identity: null` in `electron-builder.yml`), which is
fine for personal use — on first launch, right-click the app and choose *Open*.
To ship signed builds, drop that line and set `CSC_LINK` / `CSC_KEY_PASSWORD`.

Cross-building a Windows installer from macOS works for the NSIS target but
needs Wine; the reliable route is to run `npm run dist:win` on Windows (or in
CI on a `windows-latest` runner).

## Troubleshooting

**The overlay never appears and the terminal prints an Electron API error.**
VS Code's integrated terminal exports `ELECTRON_RUN_AS_NODE=1`, which makes the
Electron binary boot as plain Node. `npm run dev` and `npm start` both launch
through `scripts/start-electron.mjs`, which strips it — use those rather than
calling `electron .` directly.

**A packaged build opens to a blank window.** That means the bundled server
could not start. `npm run build` fails loudly if the standalone payload is
incomplete; if you change the packaging config, note that electron-builder
refuses to copy a `node_modules` directory sitting at the root of an
`extraResources` source, which is why the payload is nested under
`.electron-resources/payload/server`.

## Notes and limits

- Global shortcuts are system-wide; if another app already owns one, Electron
  logs a warning at startup and that single shortcut is skipped.
- Conversations are held in memory only — closing the overlay clears the thread.
